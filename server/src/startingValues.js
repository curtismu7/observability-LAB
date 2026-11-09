// Live starting values for the Searches that ask you to type something: the newest user, agent key, tool, app, client and ids in the real
// indexes, found by READ-ONLY lookups with the same read key and loopback URL as the SIEM source. Each lookup is one fixed search (size 1,
// newest first, one field); no request carries text from the browser. A lookup that fails is skipped, so one index the key cannot read
// costs only its own boxes. The static OBS_SEARCH_DEFAULTS still fill anything not found here.
import { cleanStartingValue } from './config.js';

export const LIMITS = { timeoutMs: 4000, maxBytes: 100_000 };
export const TTL_MS = 5 * 60 * 1000;
const SIEM = 'siem'; // the configured SIEM index (ping-siem-events-v2 by default)
export const LOOKUPS = {
  'priv-user': { index: SIEM, field: 'Data.User' },
  'priv-agent-key': { index: SIEM, field: 'Data.AgentKey' },
  'priv-tool': { index: SIEM, field: 'Data.Target' },
  'priv-app': { index: SIEM, field: 'Data.App' },
  'priv-console-admin': { index: SIEM, field: 'User.Name', filter: { privilege_event_kind: 'console' } },
  'all-user': { index: 'ping-logs-*', field: 'user' },
  'pf-client': { index: 'ping-logs-*', field: 'client_id', filter: { ping_product: 'pingfederate' } },
  'p1-user': { index: 'ping-logs-*', field: 'user', filter: { ping_product: 'pingone' } },
  'pe-actor-id': { index: 'pingone-events', field: 'actorId', filter: { actorType: 'USER' } },
};

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

async function one(spec, { baseUrl, apiKey, siemIndex, timeField, fetchFn }) {
  const index = spec.index === SIEM ? siemIndex : spec.index;
  const time = spec.index === SIEM ? timeField : '@timestamp';
  const filters = [{ range: { [time]: { gte: 'now-30d' } } }, { exists: { field: spec.field } }];
  if (spec.filter) filters.push({ term: spec.filter });
  const body = { size: 1, track_total_hits: false, sort: [{ [time]: { order: 'desc', unmapped_type: 'date' } }], _source: [spec.field], query: { bool: { filter: filters } } };
  const res = await fetchFn(`${baseUrl}/${encodeURIComponent(index)}/_search`, {
    method: 'POST', redirect: 'error', body: JSON.stringify(body), signal: AbortSignal.timeout(LIMITS.timeoutMs),
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `ApiKey ${apiKey}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > LIMITS.maxBytes) throw new Error('too large');
  const hit = JSON.parse(text)?.hits?.hits?.[0]?._source;
  return cleanStartingValue(getPath(hit, spec.field) ?? hit?.[spec.field]);
}

// -> { values: { searchId: value }, failed: [searchId] }. Never throws.
export async function latestValues({ baseUrl, apiKey, siemIndex, timeField, fetchFn = fetch }) {
  const ids = Object.keys(LOOKUPS);
  const settled = await Promise.allSettled(ids.map((id) => one(LOOKUPS[id], { baseUrl, apiKey, siemIndex, timeField, fetchFn })));
  const values = {}; const failed = [];
  settled.forEach((r, i) => { if (r.status === 'fulfilled' && r.value) values[ids[i]] = r.value; else failed.push(ids[i]); });
  return { values, failed };
}
