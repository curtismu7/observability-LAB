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

// The Kibana links for the same events: Discover, the dashboard, five saved searches, seven ready-made KQL queries, and the other Kibana
// pages (overview and all-products dashboards, Discover on all Ping logs, detection rules and their monitoring). The origin comes
// from a setting (default the usual port-forward); these are anchors only, the lab never calls Kibana. `Index` is the source index,
// `privilege_event_kind` is console or runtime, and the privilege.* names are Kibana runtime fields over `Data` (defined in Kibana).
export const KIBANA_DATA_VIEW = 'privilege-logs';
export const KIBANA_DASHBOARD_ID = 'privilege-logs-dashboard';
export const KIBANA_PING_DATA_VIEW = 'ping-logs';
// More Kibana pages, each a path on the same origin. `discoverView` means Discover on that data view over the same 30 days.
export const KIBANA_LINKS = [
  { id: 'privilege-overview', title: 'Privilege overview', description: 'Dashboard: policy denials, AI Guard denials, approval holds and decisions per day.', path: '/app/dashboards#/view/privilege-overview' },
  { id: 'ping-logs-dashboard', title: 'Ping logs (all products)', description: 'Dashboard: PingFederate, PingGateway, the Privilege gateway and the Privilege SIEM together.', path: '/app/dashboards#/view/ping-logs-dashboard' },
  { id: 'ping-logs-discover', title: 'Discover on Ping logs (all products)', description: 'Every product\'s lines in one Discover view (data view ping-logs), last 30 days.', discoverView: KIBANA_PING_DATA_VIEW },
  { id: 'security-rules', title: 'Security detection rules', description: 'The detection rules that watch these logs.', path: '/app/security/rules' },
  { id: 'rule-monitoring', title: 'Detection rule monitoring', description: "Dashboard: the detection rules' run health (Elastic's built-in rule monitoring dashboard).", path: '/app/dashboards#/view/security-detection-rule-monitoring-default' },
];
export const KIBANA_SAVED_SEARCHES = [
  { id: 'privilege-all', title: 'All Privilege events' },
  { id: 'privilege-runtime', title: 'Runtime events' },
  { id: 'privilege-console', title: 'Console changes' },
  { id: 'privilege-decisions', title: 'Policy decisions' },
  { id: 'privilege-aiguard', title: 'AI Guard' },
];
export const KIBANA_QUERIES = [
  { id: 'runtime', title: 'All runtime', kql: 'privilege_event_kind : "runtime"' },
  { id: 'console', title: 'All console', kql: 'privilege_event_kind : "console"' },
  { id: 'decisions', title: 'Decisions', kql: 'Index : "policy-decision-log"', note: 'Requirement 9: every policy decision.' },
  { id: 'runtime-decisions', title: 'Runtime with a decision', kql: 'privilege_event_kind : "runtime" and Index : "policy-decision-log"' },
  { id: 'denials-holds', title: 'Denials and holds', kql: 'Index : "policy-decision-log" and privilege.decision : ("deny" or "hitl")', note: 'Policy decisions only: AI Guard denials are separate (the AI Guard query). A hold can appear as more than one document; the Privilege overview dashboard counts each hold once by request id.' },
  { id: 'aiguard', title: 'AI Guard', kql: 'privilege_event_kind : "runtime" and Index : "aiguard-log"', note: 'A query on a field only AI Guard events have, such as privilege.client : *, empties the decision panels on the dashboard, by design.' },
  { id: 'gateway-http', title: 'Gateway HTTP', kql: 'Index : "proxy-audit-log"' },
];
export const KIBANA_FIELD_NOTES = [
  '`privilege_event_kind` is console or runtime; `Index` is the source index.',
  'The privilege.* fields (user, agent_key, tool, decision, reason, app, event, principal_kind, client, category) are Kibana runtime fields over `Data`.',
];
// Kibana keeps the state in the URL as Rison: a string is single-quoted, with ! written !! and a quote written !'. Encoded so the whole link is safe to paste.
export const rison = (s) => `'${s.replace(/!/g, '!!').replace(/'/g, "!'")}'`;

export function kibanaFrom(env = process.env) {
  const configured = env.PRIVILEGE_KIBANA_URL ? plainOrigin(env.PRIVILEGE_KIBANA_URL, { loopbackOnly: false }) : null;
  const origin = configured || SIEM_DEFAULTS.kibana;
  const viewOf = (id) => `dataSource:(dataViewId:'${id}',type:dataView)`;
  const view = viewOf(KIBANA_DATA_VIEW);
  const time = '_g=(time:(from:now-30d,to:now))';
  const discover = `${origin}/app/discover#/?_a=(${view})&${time}`;
  return {
    url: origin,
    deepLink: discover,
    discover,
    dashboard: `${origin}/app/dashboards#/view/${KIBANA_DASHBOARD_ID}`,
    savedSearches: KIBANA_SAVED_SEARCHES.map((s) => ({ ...s, url: `${origin}/app/discover#/view/${s.id}` })),
    queries: KIBANA_QUERIES.map((qy) => ({ ...qy, runUrl: `${origin}/app/discover#/?_a=(${view},query:(language:kuery,query:${encodeURIComponent(rison(qy.kql))}))&${time}` })),
    links: KIBANA_LINKS.map(({ path, discoverView, ...l }) => ({ ...l, url: discoverView ? `${origin}/app/discover#/?_a=(${viewOf(discoverView)})&${time}` : `${origin}${path}` })),
    fieldNotes: KIBANA_FIELD_NOTES,
    portForward: KIBANA_PORT_FORWARD,
    settingValid: !env.PRIVILEGE_KIBANA_URL || configured !== null,
  };
}
