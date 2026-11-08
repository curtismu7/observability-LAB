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
