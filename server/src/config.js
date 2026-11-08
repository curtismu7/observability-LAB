// Deployment configuration: the Mock/Real toggle (rule 19). Mock is the only fully-offline mode and the default.
// Real (owner-run) reads logs from ONE Loki you point it at, read-only (GET query_range). That Loki must be on
// loopback (for example the AI-DEMO2 observability profile publishes it on 127.0.0.1:3100): the lab's netguard
// refuses every non-loopback socket, so a remote Loki is reported as "not configured" with the reason, never reached.
import { isLoopbackHost } from './safety.js';

// The Loki base URL if Real is usable, else null. Only the PRESENCE and validity are ever reported, never a credential.
export function lokiUrlFrom(env = process.env) {
  const raw = env.OBS_LOKI_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
    if (!isLoopbackHost(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
}

// Why Real is unavailable, in words the toggle's tooltip can show. null when it is available.
export function realProblemFrom(env = process.env) {
  if (!env.OBS_LOKI_URL) return 'Real needs OBS_LOKI_URL (a loopback Loki, e.g. http://127.0.0.1:3100), or the Privilege SIEM settings, in the settings file. Mock keeps working.';
  return lokiUrlFrom(env) ? null : 'OBS_LOKI_URL must be a plain http(s) URL on loopback (127.0.0.1 or localhost) with no credentials and no path. Mock keeps working.';
}
export const realAvailableFrom = (env = process.env) => lokiUrlFrom(env) !== null || siemFrom(env) !== null;

// The launch mode. Default: Real if configured, else Mock. The runtime mode (POST /api/mode) starts from this.
export function modeFrom(env = process.env) {
  if (env.MODE === undefined || env.MODE === '') return realAvailableFrom(env) ? 'real' : 'mock';
  const m = env.MODE;
  if (m !== 'mock' && m !== 'real') throw new Error(`MODE=${String(m).slice(0, 20)} is not available: this app has mock and real modes`);
  if (m === 'real' && !realAvailableFrom(env)) throw new Error('MODE=real requested but neither OBS_LOKI_URL nor the Privilege SIEM settings are usable (they must be loopback URLs)');
  return m;
}

// ---- Privilege SIEM (Elasticsearch): a second Real source, read-only, loopback only, and a link to Kibana for the same events. ----
// The lab never creates or manages a credential: the owner supplies a read key limited to the one index. Only whether a setting is
// present and valid is ever reported, never its value.
export const SIEM_DEFAULTS = { index: 'ping-siem-events-v2', timeField: '@timestamp', kibana: 'http://localhost:5601' };
export const SIEM_SERVICE = 'privilege-siem';
export const KIBANA_PORT_FORWARD = 'kubectl --context us -n ping-devops-curtismuir port-forward svc/kibana-siem 5601:5601';
export const ES_PORT_FORWARD = 'kubectl --context us -n ping-devops-curtismuir port-forward svc/elasticsearch-siem 9200:9200';
const INDEX = /^[a-z0-9][a-z0-9._-]{0,60}$/;
const FIELD = /^[A-Za-z@_][A-Za-z0-9@_.-]{0,40}$/;
const KEY = /^[A-Za-z0-9+/=_:-]{8,512}$/;

function plainOrigin(raw, { loopbackOnly }) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
    if (loopbackOnly && !isLoopbackHost(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
}

// The SIEM settings if Real can read it, else null. The key is returned only to the client that sends it as a header.
export function siemFrom(env = process.env) {
  const url = env.PRIVILEGE_SIEM_URL ? plainOrigin(env.PRIVILEGE_SIEM_URL, { loopbackOnly: true }) : null;
  const index = env.PRIVILEGE_SIEM_INDEX || SIEM_DEFAULTS.index;
  const timeField = env.PRIVILEGE_SIEM_TIME_FIELD || SIEM_DEFAULTS.timeField;
  const apiKey = String(env.PRIVILEGE_SIEM_READ_APIKEY || '').replace(/^ApiKey\s+/i, '').trim();
  if (!url || !INDEX.test(index) || !FIELD.test(timeField) || !KEY.test(apiKey)) return null;
  return { url, index, timeField, apiKey };
}

// Why the SIEM source is unavailable, in words an operator can act on. null when it is usable.
export function siemProblemFrom(env = process.env) {
  if (!env.PRIVILEGE_SIEM_URL) return `Set PRIVILEGE_SIEM_URL to a loopback Elasticsearch (a port-forward: ${ES_PORT_FORWARD}), plus PRIVILEGE_SIEM_READ_APIKEY (a read key limited to the index; the owner creates it).`;
  if (!plainOrigin(env.PRIVILEGE_SIEM_URL, { loopbackOnly: true })) return 'PRIVILEGE_SIEM_URL must be a plain http(s) URL on loopback (127.0.0.1 or localhost) with no credentials and no path.';
  if (!INDEX.test(env.PRIVILEGE_SIEM_INDEX || SIEM_DEFAULTS.index)) return 'PRIVILEGE_SIEM_INDEX is not a valid index name.';
  if (!FIELD.test(env.PRIVILEGE_SIEM_TIME_FIELD || SIEM_DEFAULTS.timeField)) return 'PRIVILEGE_SIEM_TIME_FIELD is not a valid field name.';
  if (!env.PRIVILEGE_SIEM_READ_APIKEY) return 'Set PRIVILEGE_SIEM_READ_APIKEY (a read key limited to the index; the owner creates it, this lab never does).';
  return siemFrom(env) ? null : 'PRIVILEGE_SIEM_READ_APIKEY does not look like an Elasticsearch API key (8 to 512 characters of A-Z a-z 0-9 + / = _ : -).';
}

// The Kibana link for the same events. The origin comes from a setting (default the usual port-forward); it is an anchor only: the
// lab never calls it. Returns the link, the port-forward command, and whether the configured origin was usable.
export function kibanaFrom(env = process.env) {
  const configured = env.PRIVILEGE_KIBANA_URL ? plainOrigin(env.PRIVILEGE_KIBANA_URL, { loopbackOnly: false }) : null;
  const origin = configured || SIEM_DEFAULTS.kibana;
  return {
    url: origin,
    deepLink: `${origin}/app/discover#/?_a=(dataSource:(dataViewId:'privilege-logs',type:dataView))&_g=(time:(from:now-30d,to:now))`,
    portForward: KIBANA_PORT_FORWARD,
    settingValid: !env.PRIVILEGE_KIBANA_URL || configured !== null,
  };
}
