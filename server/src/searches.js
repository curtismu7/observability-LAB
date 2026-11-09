// The Searches tab: Kibana searches that answer one question each, plus the Rison and Discover-link helpers the Kibana panel uses too.
// Pure (no imports, no I/O): the server's config.js and the web app both import this file, so the links are built by ONE helper. The
// lab never calls Kibana; these are anchors and text. A typed value is put inside a KQL quoted string with `\` and `"` escaped, so it
// is always a single value, never more query.

// Kibana keeps the state in the URL as Rison: a string is single-quoted, with ! written !! and a quote written !'. Encoded so the whole link is safe to paste.
export const rison = (s) => `'${s.replace(/!/g, '!!').replace(/'/g, "!'")}'`;
export const DISCOVER_TIME = '_g=(time:(from:now-30d,to:now))';
const viewOf = (id) => `dataSource:(dataViewId:'${id}',type:dataView)`;
// Discover on one data view over the last 30 days, with a KQL query when one is given.
export function discoverUrl(origin, dataView, kql) {
  const query = kql === undefined ? '' : `,query:(language:kuery,query:${encodeURIComponent(rison(kql))})`;
  return `${origin}/app/discover#/?_a=(${viewOf(dataView)}${query})&${DISCOVER_TIME}`;
}

// Discover in ES|QL mode, with the query filled in and the last 24 hours. ES|QL reads an index directly, so no data view is needed.
export function esqlUrl(origin, esql, from = 'now-24h') {
  return `${origin}/app/discover#/?_g=(time:(from:${from},to:now))&_a=(query:(esql:${encodeURIComponent(rison(esql))}))`;
}

export const MAX_INPUT = 200;
export class SearchInputError extends Error {}
// A typed value as a KQL quoted string. Empty (after trimming), too long, or with control characters: refused.
export function kqlString(value) {
  const v = String(value ?? '').trim();
  if (!v) throw new SearchInputError('Type a value first.');
  if (v.length > MAX_INPUT) throw new SearchInputError(`At most ${MAX_INPUT} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) throw new SearchInputError('Control characters are not allowed.');
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
// The search's KQL with its one input put in. A search without an input returns its KQL as written.
export function buildKql(search, value) {
  if (!search.input) return search.kql;
  const quoted = kqlString(value);
  return search.kql.replace('{value}', () => quoted); // a function, so `$&` in the value is not a replacement pattern
}
export function searchRunUrl(origin, search, value) {
  return discoverUrl(origin, search.dataView, buildKql(search, value));
}

export const PRIVILEGE_VIEW = 'privilege-logs';
export const PING_VIEW = 'ping-logs';
const P = PRIVILEGE_VIEW; const ALL = PING_VIEW;
const text = (label, placeholder) => ({ kind: 'text', label, placeholder });
const select = (label, options) => ({ kind: 'select', label, options });
export const PRODUCTS = ['pingfederate', 'pinggateway', 'privilege-gateway', 'privilege', 'pingone'];
// The ping_component values the Elasticsearch pipeline writes for PingOne events (from the event type), with readable labels.
// A select option is a plain value or { value, label }; the value goes into the KQL, the label is what the list shows.
export const PINGONE_SERVICES = [
  { value: 'sso', label: 'SSO' },
  { value: 'mfa', label: 'MFA' },
  { value: 'davinci', label: 'DaVinci' },
  { value: 'authorize', label: 'Authorize (P1AZ)' },
  { value: 'protect', label: 'Protect' },
  { value: 'verify', label: 'Verify' },
  { value: 'credentials', label: 'Credentials' },
  { value: 'directory', label: 'Directory' },
  { value: 'governance', label: 'Governance (access requests, agreements)' },
  { value: 'provisioning', label: 'Provisioning' },
  { value: 'admin-config', label: 'Admin config' },
  { value: 'other', label: 'Other' },
];
export const optionOf = (o) => (typeof o === 'string' ? { value: o, label: o } : o);

// `{value}` marks where the input goes (quoted and escaped by kqlString). Every search was run against the real index over 30 days
// before it shipped (counts in the PR that added this tab); the PingOne group has no data until PingOne forwarding is live.
export const SEARCH_GROUPS = [
  {
    id: 'privilege', title: 'Privilege', note: 'Data view privilege-logs. The privilege.* fields are Kibana runtime fields over Data.',
    searches: [
      { id: 'priv-user', title: 'Everything one user did', question: 'What did this person do, through every agent and tool?', dataView: P, kql: 'privilege.user : {value}', input: text('User', 'user id') },
      { id: 'priv-agent-key', title: "One agent key's calls", question: 'What did this agent key call, and what was decided?', dataView: P, kql: 'privilege.agent_key : {value}', input: text('Agent key', 'agent key name') },
      { id: 'priv-tool', title: 'Calls to one tool', question: 'Who called this tool?', dataView: P, kql: 'privilege.tool : {value}', input: text('Tool', 'tool name') },
      { id: 'priv-app', title: 'Calls to one app', question: 'What went to this app?', dataView: P, kql: 'privilege.app : {value}', input: text('App', 'app name') },
      { id: 'priv-denials', title: 'Policy denials', question: 'Which calls did policy deny?', dataView: P, kql: 'Index : "policy-decision-log" and privilege.decision : "deny"' },
      { id: 'priv-holds', title: 'Approval holds', question: 'Which calls waited for a person to approve?', dataView: P, kql: 'privilege.event : "policy_approval_required"' },
      { id: 'priv-released', title: 'Approvals released', question: 'Which held calls were approved and let through?', dataView: P, kql: 'privilege.event : "policy_approval_released"' },
      { id: 'priv-aiguard-blocks', title: 'AI Guard blocks', question: 'Which prompts did AI Guard deny?', dataView: P, kql: 'Index : "aiguard-log" and Data.Event : "llm_policy_denied"' },
      { id: 'priv-missing-agent-key', title: 'Decisions missing the agent key', question: 'Which policy decisions cannot be tied to an agent key?', dataView: P, kql: 'Index : "policy-decision-log" and not privilege.agent_key : *' },
      { id: 'priv-console-admin', title: 'Console changes by one admin', question: 'What did this admin change in the console?', dataView: P, kql: 'privilege_event_kind : "console" and User.Name : {value}', input: text('Admin', 'admin user name') },
    ],
  },
  {
    id: 'all', title: 'All Ping products', note: 'Data view ping-logs (every product). noise marks known-harmless lines.',
    searches: [
      { id: 'all-user', title: 'One user across products', question: 'Where did this user show up, in any product?', dataView: ALL, kql: 'ping.user : {value}', input: text('User', 'user id') },
      { id: 'all-errors', title: 'All real errors', question: 'What is actually failing right now?', dataView: ALL, kql: 'ping.is_error : true and not noise : true' },
      { id: 'all-errors-product', title: 'Errors for one product', question: 'What is failing in this product?', dataView: ALL, kql: 'ping_product : {value} and ping.is_error : true and not noise : true', input: select('Product', PRODUCTS) },
    ],
  },
  {
    id: 'pingfederate', title: 'PingFederate', note: 'Data view ping-logs.',
    searches: [
      { id: 'pf-failed', title: 'Failed sign-ins', question: 'Which sign-ins failed?', dataView: ALL, kql: 'ping_product : "pingfederate" and ping.outcome : "failure"' },
      { id: 'pf-client', title: 'Token requests for one client', question: 'What did this OAuth client ask for?', dataView: ALL, kql: 'ping_product : "pingfederate" and client_id : {value}', input: text('Client', 'client id') },
      { id: 'pf-admin', title: 'Admin changes', question: 'Who changed PingFederate configuration?', dataView: ALL, kql: 'ping_product : "pingfederate" and event_kind : "admin"' },
    ],
  },
  {
    id: 'pinggateway', title: 'PingGateway', note: 'Data view ping-logs.',
    searches: [
      { id: 'pg-errors', title: 'Errors', question: 'What is failing at the gateway?', dataView: ALL, kql: 'ping_product : "pinggateway" and ping.is_error : true and not noise : true' },
    ],
  },
  {
    id: 'pingone', title: 'PingOne webhooks', note: 'Data view ping-logs. Data appears once PingOne forwarding is live.', pending: true,
    searches: [
      { id: 'p1-all', title: 'All events', question: 'What has PingOne sent?', dataView: ALL, kql: 'ping_product : "pingone"' },
      { id: 'p1-service', title: 'One service', question: 'What did this PingOne service report?', dataView: ALL, kql: 'ping_product : "pingone" and ping_component : {value}', input: select('PingOne service', PINGONE_SERVICES) },
      { id: 'p1-failures', title: 'Failures', question: 'What failed in PingOne?', dataView: ALL, kql: 'ping_product : "pingone" and ping.outcome : "failure"' },
      { id: 'p1-user', title: 'One user', question: 'What did PingOne record for this user?', dataView: ALL, kql: 'ping_product : "pingone" and ping.user : {value}', input: text('User', 'user id') },
    ],
  },
];
export const SECURITY_ALERTS_PATH = '/app/security/alerts';

// ES|QL searches on the pingone-events index, the one pingone-events-LAB forwards each PingOne event to (fields: @timestamp, eventType,
// actorId, status, correlationId; the original event is under raw). No input: each is a fixed query.
export const ESQL_INDEX = 'pingone-events';
export const ESQL_SEARCHES = [
  { id: 'pe-latest', title: 'Latest events', question: 'What has PingOne just sent?', esql: `FROM ${ESQL_INDEX} | SORT @timestamp DESC | LIMIT 50` },
  { id: 'pe-failed', title: 'Failures', question: 'Which events failed?', esql: `FROM ${ESQL_INDEX} | WHERE status == "FAILED" | SORT @timestamp DESC | LIMIT 50` },
  { id: 'pe-by-type', title: 'Events by type', question: 'Which event types arrive, and how many?', esql: `FROM ${ESQL_INDEX} | STATS events = COUNT(*) BY eventType | SORT events DESC` },
];

// ---- The PingOne events filter builder: pick values, get the ES|QL. Every choice is a list; the two typed values are put in as ONE quoted
// string (a backslash and a quote escaped, control characters refused), so a typed value can never become more query. The lists show the
// event types, results and sources seen so far on pingone-events; a type not listed is still reachable through its "All ... events" choice.
const FAMILIES = [
  ['DAVINCI_INTERACTION', 'DaVinci'], ['DECISION_ENDPOINT', 'Decision endpoint'], ['DEVICE_AUTHENTICATION', 'MFA (device)'], ['FLOW', 'Sign-in flow'],
  ['PASSWORD', 'Password'], ['RISK_EVALUATION', 'Risk'], ['SESSION', 'Session'], ['USER', 'User'],
];
const TYPE_LABELS = {
  'DAVINCI_INTERACTION.START_INTERACTION': 'a flow started', 'DAVINCI_INTERACTION.RECEIVE_REQUEST': 'request received',
  'DAVINCI_INTERACTION.SEND_RESPONSE': 'response sent', 'DAVINCI_INTERACTION.SEND_ERROR_RESPONSE': 'error response sent',
  'DECISION_ENDPOINT.DECISION_REQUEST_EVALUATED': 'request evaluated',
  'DEVICE_AUTHENTICATION.CHALLENGED': 'device challenged', 'DEVICE_AUTHENTICATION.SUCCEEDED': 'device approved',
  'FLOW.CREATED': 'started', 'FLOW.UPDATED': 'updated', 'FLOW.DELETED': 'ended',
  'PASSWORD.CHECK_SUCCEEDED': 'accepted', 'PASSWORD.CHECK_FAILED': 'rejected',
  'RISK_EVALUATION.CREATED': 'created', 'RISK_EVALUATION.UPDATED': 'updated', 'RISK_EVALUATION.STAGING_CREATED': 'staged', 'RISK_EVALUATION.COMPLETED': 'completed',
  'SESSION.CREATED': 'created', 'SESSION.UPDATED': 'updated', 'SESSION.DELETED': 'ended',
  'USER.ACCESS_ALLOWED': 'access allowed', 'USER.ACCESS_DENIED': 'access denied', 'USER.UPDATED': 'updated',
};
// Groups for the Event type list: "All <family> events" (eventType LIKE "FAMILY.*") then each type of that family.
export const PE_TYPE_GROUPS = FAMILIES.map(([family, name]) => ({
  label: name,
  options: [
    { value: `family:${family}`, label: `All ${name} events` },
    ...Object.keys(TYPE_LABELS).filter((t) => t.startsWith(`${family}.`)).map((t) => ({ value: t, label: `${name}: ${TYPE_LABELS[t]} (${t})` })),
  ],
}));
const peTypeValues = new Set(PE_TYPE_GROUPS.flatMap((g) => g.options.map((o) => o.value)));
export const PE_STATUSES = [
  { value: 'SUCCESS', label: 'Succeeded (SUCCESS)' }, { value: 'FAILED', label: 'Failed (FAILED)' },
  { value: 'SIGN_ON_REQUIRED', label: 'Sign-on required (SIGN_ON_REQUIRED)' }, { value: 'USERNAME_PASSWORD_REQUIRED', label: 'Password required (USERNAME_PASSWORD_REQUIRED)' },
  { value: 'MFA_REQUIRED', label: 'MFA required (MFA_REQUIRED)' }, { value: 'HIGH', label: 'High risk (HIGH)' },
];
export const PE_ACTOR_TYPES = [{ value: 'USER', label: 'A person (USER)' }, { value: 'CLIENT', label: 'An application (CLIENT)' }];
export const PE_VIA = [{ value: 'webhook', label: 'PingOne pushed it (webhook)' }, { value: 'pull', label: 'The lab asked PingOne (pull)' }];
export const PE_RANGES = [
  { value: 'now-15m', label: 'Last 15 minutes' }, { value: 'now-1h', label: 'Last hour' }, { value: 'now-24h', label: 'Last 24 hours' },
  { value: 'now-7d', label: 'Last 7 days' }, { value: 'now-30d', label: 'Last 30 days' },
];
export const PE_SHOW = [
  { value: 'events', label: 'The events themselves' }, { value: 'by-type', label: 'How many of each event type' },
  { value: 'by-status', label: 'How many of each result' }, { value: 'by-actor', label: 'How many per user or application' },
  { value: 'by-hour', label: 'How many per hour' },
];
export const PE_LIMITS = [10, 50, 100, 500];
export const PE_ORDERS = [{ value: 'desc', label: 'Newest first' }, { value: 'asc', label: 'Oldest first' }];
export const PE_COLUMNS = '@timestamp, eventType, status, actorType, actorId, correlationId, resource, via';
export const PE_DEFAULTS = { type: '', status: '', actorType: '', via: '', actorId: '', correlationId: '', range: 'now-24h', show: 'events', limit: 50, order: 'desc' };
// A typed value as an ES|QL string literal. Empty (after trimming): no filter. Too long or with control characters: refused.
export function esqlString(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (v.length > MAX_INPUT) throw new SearchInputError(`At most ${MAX_INPUT} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) throw new SearchInputError('Control characters are not allowed.');
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
const known = (list, v, what) => {
  if (!list.some((o) => (typeof o === 'object' ? o.value : o) === v)) throw new SearchInputError(`Pick ${what} from the list.`);
  return v;
};
// The ES|QL for a set of filter choices. Unknown list values are refused, so only the typed fields carry free text.
export function buildEventsEsql(choices = {}) {
  const o = { ...PE_DEFAULTS, ...choices };
  const where = [];
  if (o.type) {
    known([...peTypeValues], o.type, 'an event type');
    where.push(o.type.startsWith('family:') ? `eventType LIKE "${o.type.slice(7)}.*"` : `eventType == "${o.type}"`);
  }
  if (o.status) where.push(`status == "${known(PE_STATUSES, o.status, 'a result')}"`);
  if (o.actorType) where.push(`actorType == "${known(PE_ACTOR_TYPES, o.actorType, 'who')}"`);
  if (o.via) where.push(`via == "${known(PE_VIA, o.via, 'a source')}"`);
  const actor = esqlString(o.actorId); if (actor) where.push(`actorId == ${actor}`);
  const corr = esqlString(o.correlationId); if (corr) where.push(`correlationId == ${corr}`);
  known(PE_RANGES, o.range, 'a time range'); known(PE_SHOW, o.show, 'what to show'); known(PE_ORDERS, o.order, 'an order');
  if (!PE_LIMITS.includes(Number(o.limit))) throw new SearchInputError('Pick how many from the list.');
  if (o.show === 'by-actor') where.push('actorId IS NOT NULL');
  const tail = {
    events: `SORT @timestamp ${o.order.toUpperCase()} | LIMIT ${Number(o.limit)} | KEEP ${PE_COLUMNS}`,
    'by-type': 'STATS events = COUNT(*) BY eventType | SORT events DESC',
    'by-status': 'STATS events = COUNT(*) BY status | SORT events DESC',
    'by-actor': 'STATS events = COUNT(*) BY actorId | SORT events DESC | LIMIT 20',
    'by-hour': 'STATS events = COUNT(*) BY hour = BUCKET(@timestamp, 1 hour) | SORT hour',
  }[o.show];
  return ['FROM pingone-events', ...(where.length ? [`WHERE ${where.join(' AND ')}`] : []), tail].join(' | ');
}
