// Real mode: a READ-ONLY Loki client. GET /loki/api/v1/query_range only, against the one loopback origin from OBS_LOKI_URL.
// The query text sent is rebuilt from the parsed LogQL-lite query (never the raw user string). No redirects, a timeout, a body cap.
// Uses globalThis.fetch at call time so the netguard (loopback-only) always applies.
import { formatQuery } from './logql.js';
import { productOfService } from './logStore.js';

export const LIMITS = { timeoutMs: 5000, maxBytes: 2_000_000, maxEntries: 1000 };

export class LokiError extends Error {
  constructor(code, detail, status = 502) { super(detail); this.code = code; this.detail = detail; this.status = status; }
}

const LEVEL = /\blevel=(debug|info|warn|warning|error|fatal)\b/i;
const LEVEL_WORD = /\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/; // upper-case log-level words only, so prose such as "no error" never counts
const ANSI = /\u001b\[[0-9;]*m/g;
const NORMAL = { trace: 'debug', warning: 'warn', fatal: 'error' };

// Level, most trustworthy first: an explicit `level` label, then what the line itself says (level=x, or a word like ERROR in
// the first 300 characters with colour codes removed), then Loki's own `detected_level` guess, then unknown. detected_level
// comes last because Loki guesses it: a colourised ERROR gateway line came back as "info".
export function levelOf(labels, line) {
  const head = line.slice(0, 300).replace(ANSI, '');
  const found = labels.level || LEVEL.exec(head)?.[1] || LEVEL_WORD.exec(head)?.[1] || labels.detected_level || 'unknown';
  const lower = String(found).toLowerCase();
  return NORMAL[lower] || lower;
}
const TRACE = /\b(?:trace_id|traceparent|traceId)["=: ]+(?:00-)?([0-9a-f]{32})/i;

export function mapStreams(streams, limit) {
  const rows = [];
  for (const s of Array.isArray(streams) ? streams : []) {
    const labels = s && typeof s.stream === 'object' && s.stream ? s.stream : {};
    for (const v of Array.isArray(s?.values) ? s.values : []) {
      if (!Array.isArray(v) || typeof v[0] !== 'string' || typeof v[1] !== 'string') continue;
      const ms = Math.floor(Number(BigInt(v[0].replace(/\D/g, '') || '0') / 1_000_000n));
      const service = typeof labels.service === 'string' ? labels.service : '';
      const level = levelOf(labels, v[1]);
      rows.push({
        id: `loki-${v[0]}`, ts: ms, product: productOfService(service), source: String(labels.source || labels.stream || 'loki'), level,
        message: v[1].slice(0, 4000), traceId: TRACE.exec(v[1])?.[1] || null, service, labels: Object.fromEntries(Object.entries(labels).map(([k, val]) => [k, String(val)])),
      });
    }
  }
  rows.sort((a, b) => b.ts - a.ts);
  return rows.slice(0, limit);
}

export function createLokiClient({ baseUrl }) {
  return {
    baseUrl,
    async queryRange({ query, now, sinceMs = 30 * 60_000, limit = 200, traceparent }) {
      const lim = Math.min(Math.max(1, limit), LIMITS.maxEntries);
      const params = new URLSearchParams({ query: formatQuery(query), limit: String(lim), direction: 'backward', start: String((now - sinceMs) * 1_000_000), end: String(now * 1_000_000) });
      const path = `/loki/api/v1/query_range?${params}`;
      const request = { method: 'GET', path, host: new URL(baseUrl).host };
      let res;
      try {
        res = await fetch(baseUrl + path, { method: 'GET', redirect: 'error', headers: { accept: 'application/json', ...(traceparent ? { traceparent } : {}) }, signal: AbortSignal.timeout(LIMITS.timeoutMs) });
      } catch (e) {
        throw new LokiError('loki_unreachable', `Could not reach Loki at ${new URL(baseUrl).host}: ${String(e.name === 'TimeoutError' ? 'timed out' : e.cause?.code || e.message).slice(0, 80)}`);
      }
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > LIMITS.maxBytes) throw new LokiError('loki_too_large', 'Loki answered with more data than this lab will read; narrow the query.');
      const chunks = []; let size = 0;
      for await (const c of res.body ?? []) {
        size += c.length;
        if (size > LIMITS.maxBytes) throw new LokiError('loki_too_large', 'Loki answered with more data than this lab will read; narrow the query.');
        chunks.push(c);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (!res.ok) throw new LokiError('loki_error', `Loki answered HTTP ${res.status}: ${text.slice(0, 160).replace(/[\u0000-\u001f]/g, ' ')}`);
      let body;
      try { body = JSON.parse(text); } catch { throw new LokiError('loki_bad_response', 'Loki did not answer with JSON.'); }
      if (body?.status !== 'success' || body?.data?.resultType !== 'streams') throw new LokiError('loki_bad_response', 'Loki answered with something other than log streams.');
      const entries = mapStreams(body.data.result, lim);
      return { entries, truncated: entries.length >= lim, request, response: { status: res.status, bytes: size, streams: body.data.result.length } };
    },
  };
}
