// Real mode, second source: a READ-ONLY client for the Privilege SIEM Elasticsearch index. One request shape only: POST /<index>/_search
// (Elasticsearch's search needs a body, so it is a POST; it changes nothing) against the one loopback origin from PRIVILEGE_SIEM_URL.
// The body is built here from the parsed query window, never from user text. No redirects, a timeout, a body cap. The read key is sent as
// a header and is never logged, returned or echoed; the documents are scrubbed again here even though the keys are masked upstream.
import { matchesQuery } from './logql.js';
import { SIEM_SERVICE } from './config.js';
import { productOfService } from './logStore.js';

export const LIMITS = { timeoutMs: 8000, maxBytes: 2_000_000, maxHits: 500, maxMessage: 4000, maxDepth: 8, maxString: 500 };

export class SiemError extends Error {
  constructor(code, detail, status = 502) { super(detail); this.code = code; this.detail = detail; this.status = status; }
}

const SECRET_KEY = /(secret|token|password|passwd|authorization|api[-_]?key|private[-_]?key|credential)/i;
const AGENT_KEY = /agent[-_]?key/i;
const LOOKS_MASKED = /(\*|…|\.\.\.)/;

// Values under secret-looking keys never reach the page. AgentKey is the one key name the events are known to carry; it is shown
// only if it already looks masked, otherwise cut to a short prefix.
export function scrub(value, key = '', depth = 0) {
  if (depth > LIMITS.maxDepth) return '<too deep>';
  if (key && SECRET_KEY.test(key)) return '<redacted>';
  if (typeof value === 'string') {
    if (key && AGENT_KEY.test(key) && !LOOKS_MASKED.test(value)) return `${value.slice(0, 4)}…`;
    return value.length > LIMITS.maxString ? `${value.slice(0, LIMITS.maxString)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, key, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 80).map(([k, v]) => [k, scrub(v, k, depth + 1)]));
  return value;
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
// A refusal is worth the eye: Data.Decision (policy-decision-log) or Decision, when it says deny, block or reject.
export const levelOfDoc = (src) => (/deny|denied|block|reject/i.test(String(getPath(src, 'Data.Decision') ?? src?.Decision ?? '')) ? 'warn' : 'info');
const KINDS = new Set(['console', 'runtime']);

export function mapHits(hits, timeField) {
  const rows = [];
  for (const h of Array.isArray(hits) ? hits : []) {
    const src = h && typeof h._source === 'object' && h._source ? h._source : null;
    if (!src) continue;
    const ts = Date.parse(getPath(src, timeField) ?? src.time ?? src.timestamp ?? '');
    if (!Number.isFinite(ts)) continue;
    const kind = KINDS.has(src.privilege_event_kind) ? src.privilege_event_kind : 'unknown';
    const index = String(src.Index || h._index || 'unknown').slice(0, 60);
    const level = levelOfDoc(src);
    rows.push({
      id: `siem-${String(h._id || ts).slice(0, 60)}`, ts, product: productOfService(SIEM_SERVICE), source: index, level,
      message: JSON.stringify(scrub(src)).slice(0, LIMITS.maxMessage), traceId: null, service: SIEM_SERVICE,
      labels: { service: SIEM_SERVICE, kind, index, level },
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  return rows;
}

export function createSiemClient({ baseUrl, index, apiKey, timeField }) {
  return {
    baseUrl, index,
    async search({ q, now, sinceMs, limit = 200 }) {
      const size = Math.min(LIMITS.maxHits, Math.max(limit * 3, 100));
      const body = {
        size, track_total_hits: false,
        sort: [{ [timeField]: { order: 'desc', unmapped_type: 'date' } }],
        query: { bool: { filter: [{ range: { [timeField]: { gte: now - sinceMs, lte: now, format: 'epoch_millis' } } }] } },
      };
      const path = `/${index}/_search`;
      const request = { method: 'POST', path, host: new URL(baseUrl).host };
      let res;
      try {
        res = await fetch(baseUrl + path, {
          method: 'POST', redirect: 'error', body: JSON.stringify(body), signal: AbortSignal.timeout(LIMITS.timeoutMs),
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `ApiKey ${apiKey}` },
        });
      } catch (e) {
        throw new SiemError('siem_unreachable', `Could not reach the SIEM Elasticsearch at ${new URL(baseUrl).host}: ${String(e.name === 'TimeoutError' ? 'timed out' : e.cause?.code || e.message).slice(0, 80)}`);
      }
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > LIMITS.maxBytes) throw new SiemError('siem_too_large', 'The SIEM answered with more data than this lab will read; narrow the window.');
      const chunks = []; let bytes = 0;
      for await (const c of res.body ?? []) {
        bytes += c.length;
        if (bytes > LIMITS.maxBytes) throw new SiemError('siem_too_large', 'The SIEM answered with more data than this lab will read; narrow the window.');
        chunks.push(c);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (res.status === 401 || res.status === 403) throw new SiemError('siem_unauthorized', `Elasticsearch refused the read credential (HTTP ${res.status}). Check PRIVILEGE_SIEM_READ_APIKEY and that it may read the index.`);
      if (!res.ok) throw new SiemError('siem_error', `Elasticsearch answered HTTP ${res.status}: ${text.slice(0, 160).replace(/[\u0000-\u001f]/g, ' ')}`);
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new SiemError('siem_bad_response', 'Elasticsearch did not answer with JSON.'); }
      if (!Array.isArray(parsed?.hits?.hits)) throw new SiemError('siem_bad_response', 'Elasticsearch answered with something other than search hits.');
      const all = mapHits(parsed.hits.hits, timeField);
      const entries = all.filter((e) => matchesQuery(q, e)).slice(0, limit);
      return { entries, truncated: parsed.hits.hits.length >= size || entries.length >= limit, request, response: { status: res.status, bytes, hits: parsed.hits.hits.length } };
    },
  };
}
