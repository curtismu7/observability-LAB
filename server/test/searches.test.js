import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEARCH_GROUPS, SearchInputError, buildKql, discoverUrl, kqlString, rison, searchRunUrl, MAX_INPUT, PINGONE_SERVICES, PRODUCTS, optionOf } from '../src/searches.js';
import { kibanaFrom, labLinksFrom, rison as configRison, siemFrom } from '../src/config.js';
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
