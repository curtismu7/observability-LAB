import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESQL_SEARCHES, PE_ACTOR_TYPES, PE_COLUMNS, PE_LIMITS, PE_RANGES, PE_SHOW, PE_STATUSES, PE_TYPE_GROUPS, PE_VIA, SEARCH_GROUPS, SearchInputError, buildEventsEsql, esqlString, esqlUrl, buildKql, discoverUrl, kqlString, rison, searchRunUrl, MAX_INPUT, PINGONE_SERVICES, PRODUCTS, optionOf } from '../src/searches.js';
import { kibanaFrom, labLinksFrom, rison as configRison, searchDefaultsFrom, siemFrom } from '../src/config.js';
import { withServer } from './helpers.js';
import { createApp } from '../src/app.js';

const all = SEARCH_GROUPS.flatMap((g) => g.searches);
const byId = (id) => all.find((s) => s.id === id);

test('a typed value becomes ONE KQL quoted string: quotes and backslashes are escaped', () => {
  assert.equal(kqlString('alice'), '"alice"');
  assert.equal(kqlString('  alice  '), '"alice"', 'trimmed');
  assert.equal(kqlString('a"b'), '"a\\"b"');
  assert.equal(kqlString('a\\b'), '"a\\\\b"');
  assert.equal(kqlString('x\\" or privilege.user : *'), '"x\\\\\\" or privilege.user : *"', 'a backslash before a quote cannot close the string');
  assert.equal(buildKql(byId('priv-user'), 'x" or not privilege.user : "y'), 'privilege.user : "x\\" or not privilege.user : \\"y"');
});

test('a value with $& or $1 is put in literally (no replacement patterns)', () => {
  assert.equal(buildKql(byId('priv-tool'), '$&$1$`'), 'privilege.tool : "$&$1$`"');
});

test('empty, blank, too long or control-character input is refused', () => {
  for (const bad of ['', '   ', undefined, null, 'x'.repeat(MAX_INPUT + 1), 'a\nb', 'a\u0000b', 'a\u007fb']) {
    assert.throws(() => buildKql(byId('priv-user'), bad), SearchInputError, JSON.stringify(bad));
  }
  assert.doesNotThrow(() => buildKql(byId('priv-user'), 'x'.repeat(MAX_INPUT)));
});

test('a search without an input keeps its KQL as written, and ignores any value', () => {
  assert.equal(buildKql(byId('priv-denials'), ''), 'Index : "policy-decision-log" and privilege.decision : "deny"');
  assert.equal(buildKql(byId('all-errors'), 'ignored'), 'ping.is_error : true and not noise : true');
});

test('the catalog: every group the tab promises, unique ids, one {value} per input search, known data views', () => {
  assert.deepEqual(SEARCH_GROUPS.map((g) => g.id), ['privilege', 'all', 'pingfederate', 'pinggateway', 'pingone']);
  assert.equal(new Set(all.map((s) => s.id)).size, all.length);
  for (const s of all) {
    assert.ok(['privilege-logs', 'ping-logs'].includes(s.dataView), s.id);
    assert.ok(s.title && s.question, s.id);
    const holes = s.kql.split('{value}').length - 1;
    assert.equal(holes, s.input ? 1 : 0, s.id);
  }
  assert.equal(SEARCH_GROUPS.find((g) => g.id === 'privilege').searches.length, 10);
  assert.ok(SEARCH_GROUPS.find((g) => g.id === 'pingone').pending, 'PingOne is labelled as waiting for forwarding');
  assert.deepEqual(byId('p1-service').input.options, PINGONE_SERVICES);
  assert.deepEqual(byId('all-errors-product').input.options, PRODUCTS);
  for (const s of all.filter((x) => x.input?.kind === 'select')) for (const o of s.input.options) assert.doesNotThrow(() => buildKql(s, optionOf(o).value));
});

test('PingOne service select: the ping_component values the Elasticsearch pipeline writes, with readable labels', () => {
  assert.deepEqual(PINGONE_SERVICES.map((o) => o.value), ['sso', 'mfa', 'davinci', 'authorize', 'protect', 'verify', 'credentials', 'directory', 'governance', 'provisioning', 'admin-config', 'other']);
  assert.deepEqual(PINGONE_SERVICES.map((o) => o.label), ['SSO', 'MFA', 'DaVinci', 'Authorize (P1AZ)', 'Protect', 'Verify', 'Credentials', 'Directory', 'Governance (access requests, agreements)', 'Provisioning', 'Admin config', 'Other']);
  assert.equal(buildKql(byId('p1-service'), 'admin-config'), 'ping_product : "pingone" and ping_component : "admin-config"');
  assert.deepEqual(optionOf('pingfederate'), { value: 'pingfederate', label: 'pingfederate' });
});

test('Run in Discover: same Rison helper and origin as the Kibana panel, the data view, 30 days', () => {
  assert.equal(configRison, rison, 'config.js re-exports the one helper');
  const url = searchRunUrl('https://kibana.example:5601', byId('priv-agent-key'), "it's!");
  assert.ok(url.startsWith("https://kibana.example:5601/app/discover#/?_a=(dataSource:(dataViewId:'privilege-logs',type:dataView),query:(language:kuery,query:"));
  assert.ok(url.endsWith('&_g=(time:(from:now-30d,to:now))'));
  const q = decodeURIComponent(/query:\(language:kuery,query:([^)]*)\)\)/.exec(url)[1]);
  assert.equal(q, `'privilege.agent_key : "it!'s!!"'`);
  assert.ok(!/[\s"<>]/.test(url), 'the link has nothing that needs more encoding');
  const k = kibanaFrom({});
  assert.equal(k.queries[0].runUrl, discoverUrl(k.url, 'privilege-logs', k.queries[0].kql));
  assert.equal(k.securityAlerts, 'http://localhost:5601/app/security/alerts');
  assert.equal(kibanaFrom({ PRIVILEGE_KIBANA_URL: 'https://kibana.example:5601' }).securityAlerts, 'https://kibana.example:5601/app/security/alerts');
});

test('lab links: loopback origins only, defaults otherwise, said out loud', () => {
  assert.deepEqual(labLinksFrom({}), { privilegeLogging: { url: 'http://127.0.0.1:7801/#privilege', settingValid: true }, fieldNotes: { url: 'http://127.0.0.1:7804', settingValid: true } });
  const set = labLinksFrom({ PRIVILEGE_LOGGING_LAB_URL: 'http://localhost:7901/', FIELD_NOTES_URL: 'http://127.0.0.1:7904' });
  assert.equal(set.privilegeLogging.url, 'http://localhost:7901/#privilege');
  assert.equal(set.fieldNotes.url, 'http://127.0.0.1:7904');
  for (const bad of ['https://lab.example', 'javascript:alert(1)', 'http://u:p@127.0.0.1:7801', 'http://127.0.0.1:7801/path', 'http://host.docker.internal:7801']) {
    const l = labLinksFrom({ PRIVILEGE_LOGGING_LAB_URL: bad, FIELD_NOTES_URL: bad });
    assert.equal(l.privilegeLogging.url, 'http://127.0.0.1:7801/#privilege', bad);
    assert.equal(l.privilegeLogging.settingValid, false, bad);
    assert.equal(l.fieldNotes.url, 'http://127.0.0.1:7804', bad);
    assert.equal(l.fieldNotes.settingValid, false, bad);
  }
});

test('the SIEM URL stays loopback only: the Docker host name is refused (the forwarder makes it 127.0.0.1 inside the lab)', () => {
  const key = 'FAKEKEYFAKEKEYFAKEKEY';
  assert.equal(siemFrom({ PRIVILEGE_SIEM_URL: 'http://host.docker.internal:9200', PRIVILEGE_SIEM_READ_APIKEY: key }), null);
  assert.equal(siemFrom({ PRIVILEGE_SIEM_URL: 'http://127.0.0.1:9200', PRIVILEGE_SIEM_READ_APIKEY: key })?.url, 'http://127.0.0.1:9200');
  assert.equal(siemFrom({ PRIVILEGE_SIEM_URL: '', PRIVILEGE_SIEM_READ_APIKEY: key }), null, 'empty = off');
  assert.equal(siemFrom({ PRIVILEGE_SIEM_URL: 'http://127.0.0.1:9200', PRIVILEGE_SIEM_INDEX: '', PRIVILEGE_SIEM_READ_APIKEY: key })?.index, 'ping-siem-events-v2', 'an empty index from compose means the default');
});

test('/api/info carries the lab links and never the read key', async () => {
  const key = 'placeholder'.repeat(3);
  const app = createApp({ env: { PRIVILEGE_SIEM_URL: 'http://127.0.0.1:9', PRIVILEGE_SIEM_READ_APIKEY: key, FIELD_NOTES_URL: 'http://127.0.0.1:7904' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/info`);
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.ok(!text.includes(key));
    const j = JSON.parse(text);
    assert.equal(j.labLinks.fieldNotes.url, 'http://127.0.0.1:7904');
    assert.equal(j.siem.kibana.securityAlerts, 'http://localhost:5601/app/security/alerts');
  } finally { server.close(); }
});

test('ES|QL links: Discover on the origin, the query as one Rison string in _a, last 24 hours; every search reads only pingone-events', () => {
  assert.equal(esqlUrl('http://localhost:5601', 'FROM pingone-events | LIMIT 5'),
    "http://localhost:5601/app/discover#/?_g=(time:(from:now-24h,to:now))&_a=(query:(esql:" + encodeURIComponent("'FROM pingone-events | LIMIT 5'") + "))");
  assert.ok(esqlUrl('http://k', "x'y!z").endsWith("esql:'x!'y!!z'))"), 'a quote and a bang are Rison-escaped');
  assert.equal(new Set(ESQL_SEARCHES.map((s) => s.id)).size, ESQL_SEARCHES.length);
  for (const s of ESQL_SEARCHES) {
    assert.ok(s.title && s.question, s.id);
    assert.match(s.esql, /^FROM pingone-events( \||$)/, s.id);
    assert.ok(!all.some((x) => x.id === s.id), 'ids do not clash with the KQL searches');
  }
});

const COLS = PE_COLUMNS;
test('filter builder: no choices is the latest 50 events with readable columns', () => {
  assert.equal(buildEventsEsql(), `FROM pingone-events | SORT @timestamp DESC | LIMIT 50 | KEEP ${COLS}`);
  assert.equal(buildEventsEsql({}), buildEventsEsql());
});

test('filter builder: each choice adds one condition, joined with AND, in a fixed order', () => {
  assert.equal(buildEventsEsql({ type: 'SESSION.UPDATED' }), `FROM pingone-events | WHERE eventType == "SESSION.UPDATED" | SORT @timestamp DESC | LIMIT 50 | KEEP ${COLS}`);
  assert.match(buildEventsEsql({ type: 'family:SESSION' }), /WHERE eventType LIKE "SESSION\.\*" \|/);
  assert.match(buildEventsEsql({ status: 'FAILED', actorType: 'USER', via: 'pull' }), /WHERE status == "FAILED" AND actorType == "USER" AND via == "pull" \|/);
  assert.match(buildEventsEsql({ actorId: ' u-1 ', correlationId: 'c-1' }), /WHERE actorId == "u-1" AND correlationId == "c-1" \|/);
  assert.match(buildEventsEsql({ order: 'asc', limit: 10 }), /SORT @timestamp ASC \| LIMIT 10 \|/);
  assert.equal(buildEventsEsql({ actorId: '   ' }), buildEventsEsql(), 'a blank typed value is no filter');
});

test('filter builder: the counting views group, sort, and ignore order and row count', () => {
  assert.equal(buildEventsEsql({ show: 'by-type' }), 'FROM pingone-events | STATS events = COUNT(*) BY eventType | SORT events DESC');
  assert.equal(buildEventsEsql({ show: 'by-status', status: 'FAILED', limit: 500 }), 'FROM pingone-events | WHERE status == "FAILED" | STATS events = COUNT(*) BY status | SORT events DESC');
  assert.match(buildEventsEsql({ show: 'by-actor' }), /WHERE actorId IS NOT NULL \| STATS events = COUNT\(\*\) BY actorId \| SORT events DESC \| LIMIT 20$/);
  assert.match(buildEventsEsql({ show: 'by-hour' }), /BY hour = BUCKET\(@timestamp, 1 hour\) \| SORT hour$/);
});

test('filter builder: a typed value is ONE string, so it can never become more query', () => {
  assert.equal(esqlString('a"b'), '"a\\"b"');
  assert.equal(esqlString('a\\b'), '"a\\\\b"');
  const evil = 'x" OR true | DROP eventType | WHERE "1"=="1';
  const q = buildEventsEsql({ actorId: evil });
  assert.equal(q, `FROM pingone-events | WHERE actorId == "x\\" OR true | DROP eventType | WHERE \\"1\\"==\\"1" | SORT @timestamp DESC | LIMIT 50 | KEEP ${COLS}`);
  assert.equal(q.split('\n').length, 1);
  for (const bad of ['a\nb', 'a\u0000b', 'a\u007fb', 'x'.repeat(MAX_INPUT + 1)]) assert.throws(() => buildEventsEsql({ correlationId: bad }), SearchInputError, JSON.stringify(bad).slice(0, 20));
});

test('filter builder: a value that is not in a list is refused, never put into the query', () => {
  for (const bad of [{ type: 'SESSION.UPDATED" | DROP x' }, { type: 'family:SESSION.*' }, { status: 'x' }, { actorType: 'x' }, { via: 'x' }, { range: 'now-1y' }, { show: 'x' }, { order: 'up' }, { limit: 7 }, { limit: '50; DROP' }]) {
    assert.throws(() => buildEventsEsql(bad), SearchInputError, JSON.stringify(bad));
  }
});

test('filter builder: every choice in every list builds a query that names only pingone-events', () => {
  const types = PE_TYPE_GROUPS.flatMap((g) => g.options.map((o) => o.value));
  assert.ok(types.length > 20);
  for (const v of types) assert.match(buildEventsEsql({ type: v }), /^FROM pingone-events \| WHERE eventType (==|LIKE) "[A-Z_.*]+" \|/, v);
  for (const o of PE_STATUSES) assert.doesNotThrow(() => buildEventsEsql({ status: o.value }));
  for (const o of PE_ACTOR_TYPES) assert.doesNotThrow(() => buildEventsEsql({ actorType: o.value }));
  for (const o of PE_VIA) assert.doesNotThrow(() => buildEventsEsql({ via: o.value }));
  for (const o of PE_RANGES) assert.doesNotThrow(() => buildEventsEsql({ range: o.value }));
  for (const o of PE_SHOW) assert.doesNotThrow(() => buildEventsEsql({ show: o.value }));
  for (const n of PE_LIMITS) assert.doesNotThrow(() => buildEventsEsql({ limit: n }));
  for (const g of PE_TYPE_GROUPS) assert.ok(g.options[0].value.startsWith('family:'), 'each group starts with its All-events choice');
});

test('ES|QL link: the time range is the one the form chose', () => {
  assert.ok(esqlUrl('http://k', 'FROM a', 'now-7d').includes('_g=(time:(from:now-7d,to:now))'));
  assert.ok(esqlUrl('http://k', 'FROM a').includes('_g=(time:(from:now-24h,to:now))'));
});

test('searchDefaultsFrom: starting values come from OBS_SEARCH_DEFAULTS; anything malformed is dropped, never thrown', () => {
  assert.deepEqual(searchDefaultsFrom({}), {});
  assert.deepEqual(searchDefaultsFrom({ OBS_SEARCH_DEFAULTS: '{"priv-user":" u-1 ","priv-tool":"SearchIndexTool"}' }), { 'priv-user': 'u-1', 'priv-tool': 'SearchIndexTool' });
  for (const bad of ['not json', '[]', '"x"', 'null', '{"priv-user": 5}', '{"priv-user": ""}', '{"Bad Id": "x"}', '{"__proto__": "x"}', `{"priv-user": "${'a'.repeat(201)}"}`, '{"priv-user": "a\\nb"}']) {
    assert.deepEqual(searchDefaultsFrom({ OBS_SEARCH_DEFAULTS: bad }), {}, bad);
  }
  assert.deepEqual(searchDefaultsFrom({ OBS_SEARCH_DEFAULTS: '{"priv-user":"ok","pf-client":7}' }), { 'priv-user': 'ok' }, 'one bad value does not cost the good ones');
});

test('GET /api/info carries the starting values (and an empty object when none are set)', async () => {
  await withServer(async (url) => { assert.deepEqual((await (await fetch(`${url}/api/info`)).json()).searchDefaults, {}); });
  await withServer(async (url) => { assert.deepEqual((await (await fetch(`${url}/api/info`)).json()).searchDefaults, { 'priv-user': 'u-1' }); }, { env: { OBS_SEARCH_DEFAULTS: '{"priv-user":"u-1"}' } });
});
