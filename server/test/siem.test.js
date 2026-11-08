import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { KIBANA_PORT_FORWARD, kibanaFrom, realAvailableFrom, siemFrom, siemProblemFrom } from '../src/config.js';
import { parseQuery } from '../src/logql.js';
import { LIMITS, SiemError, createSiemClient, scrub } from '../src/siemClient.js';
import { post, withServer } from './helpers.js';

const T = { timeout: 20_000 };
const KEY = 'FAKEKEYFAKEKEYFAKEKEY';
const q = (text) => parseQuery(text);
const hit = (id, over = {}, ageMs = 60_000) => ({
  _id: id, _index: 'ping-siem-events-v2',
  _source: { '@timestamp': new Date(Date.now() - ageMs).toISOString(), Index: 'policy-decision-log', privilege_event_kind: 'runtime', Data: { User: '<user-id>', AgentKey: 'FAKEFAKEFAKEFAKE', Target: 'get_weather', Decision: 'Allow', Reason: 'ok', PolicyIDs: ['p1'] }, ...over },
});

async function fakeEs(handler) {
  const requests = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { requests.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${srv.address().port}`, requests, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}
const ok = (hits) => (_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ hits: { hits } })); };

test('settings: the SIEM needs a loopback URL and a read key; every reason is in words and never contains the key', T, () => {
  assert.equal(siemFrom({}), null);
  assert.equal(siemFrom({ PRIVILEGE_SIEM_URL: 'http://127.0.0.1:9200' }), null, 'no key, no source');
  const s = siemFrom({ PRIVILEGE_SIEM_URL: 'http://127.0.0.1:9200', PRIVILEGE_SIEM_READ_APIKEY: `ApiKey ${KEY}` });
  assert.deepEqual({ ...s, apiKey: '<set>' }, { url: 'http://127.0.0.1:9200', index: 'ping-siem-events-v2', timeField: '@timestamp', apiKey: '<set>' });
  assert.equal(s.apiKey, KEY, 'an ApiKey prefix is accepted and stripped');
  for (const url of ['http://es.example:9200', 'http://u:p@127.0.0.1:9200', 'http://127.0.0.1:9200/x', 'ftp://127.0.0.1', 'nope']) {
    const env = { PRIVILEGE_SIEM_URL: url, PRIVILEGE_SIEM_READ_APIKEY: KEY };
    assert.equal(siemFrom(env), null, url);
    assert.ok(siemProblemFrom(env) && !siemProblemFrom(env).includes(KEY));
  }
  assert.equal(siemFrom({ PRIVILEGE_SIEM_URL: 'http://localhost:9200', PRIVILEGE_SIEM_READ_APIKEY: KEY, PRIVILEGE_SIEM_INDEX: 'Bad Index' }), null);
  assert.equal(siemFrom({ PRIVILEGE_SIEM_URL: 'http://localhost:9200', PRIVILEGE_SIEM_READ_APIKEY: 'short' }), null);
  assert.match(siemProblemFrom({}), /PRIVILEGE_SIEM_URL/);
  assert.equal(siemProblemFrom({ PRIVILEGE_SIEM_URL: 'http://127.0.0.1:9200', PRIVILEGE_SIEM_READ_APIKEY: KEY }), null);
  assert.equal(realAvailableFrom({ PRIVILEGE_SIEM_URL: 'http://127.0.0.1:9200', PRIVILEGE_SIEM_READ_APIKEY: KEY }), true, 'the SIEM alone makes Real usable');
});

test('Kibana link: default origin, a setting overrides it, a bad one falls back, and the port-forward is shown', T, () => {
  const d = kibanaFrom({});
  assert.equal(d.url, 'http://localhost:5601');
  assert.ok(d.deepLink.startsWith('http://localhost:5601/app/discover#/?_a=(dataSource:(dataViewId:\'privilege-logs\',type:dataView))'));
  assert.ok(d.deepLink.includes('from:now-30d'));
  assert.equal(d.portForward, KIBANA_PORT_FORWARD);
  assert.equal(kibanaFrom({ PRIVILEGE_KIBANA_URL: 'https://kibana.example:5601' }).url, 'https://kibana.example:5601');
  const bad = kibanaFrom({ PRIVILEGE_KIBANA_URL: 'javascript:alert(1)' });
  assert.equal(bad.url, 'http://localhost:5601');
  assert.equal(bad.settingValid, false);
  assert.equal(kibanaFrom({ PRIVILEGE_KIBANA_URL: 'http://u:p@host:5601' }).url, 'http://localhost:5601', 'credentials in the URL are refused');
});

test('scrub: secret-looking keys are redacted at any depth and an unmasked AgentKey is cut to a prefix', T, () => {
  const out = scrub({ Data: { AgentKey: 'FAKEFAKEFAKE', api_key: 'x', nested: { Authorization: 'Bearer y', password: 'p', ok: 'fine' }, list: [{ token: 't' }] } });
  assert.equal(out.Data.AgentKey, 'FAKE…');
  assert.equal(out.Data.api_key, '<redacted>');
  assert.equal(out.Data.nested.Authorization, '<redacted>');
  assert.equal(out.Data.nested.password, '<redacted>');
  assert.equal(out.Data.nested.ok, 'fine');
  assert.equal(out.Data.list[0].token, '<redacted>');
  assert.equal(scrub({ AgentKey: 'ab****cd' }).AgentKey, 'ab****cd', 'an already masked key is left as it is');
});

test('the client sends exactly one read-only search with the key as a header, and maps hits to labelled lines', T, async () => {
  const es = await fakeEs(ok([hit('a'), hit('b', { Data: { Decision: 'Deny', Target: 'x', AgentKey: 'ab****cd' } }, 120_000), hit('c', { Index: 'audit-log', privilege_event_kind: 'console', Data: { Action: 'edit' } }, 180_000), { _id: 'no-time', _source: { Index: 'audit-log' } }]));
  try {
    const client = createSiemClient({ baseUrl: es.base, index: 'ping-siem-events-v2', apiKey: KEY, timeField: '@timestamp' });
    const r = await client.search({ q: q('{service="privilege-siem"}'), now: Date.now(), sinceMs: 86_400_000, limit: 50 });
    assert.equal(es.requests.length, 1);
    const [req] = es.requests;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/ping-siem-events-v2/_search', 'only the search endpoint of the one index');
    assert.equal(req.headers.authorization, `ApiKey ${KEY}`);
    const body = JSON.parse(req.body);
    assert.deepEqual(Object.keys(body).sort(), ['query', 'size', 'sort', 'track_total_hits']);
    assert.ok(body.size >= 100 && body.size <= LIMITS.maxHits);
    assert.ok(body.query.bool.filter[0].range['@timestamp'].gte < body.query.bool.filter[0].range['@timestamp'].lte);
    assert.equal(r.entries.length, 3, 'a document with no time is skipped');
    assert.deepEqual(r.entries.map((e) => e.labels.kind), ['runtime', 'runtime', 'console']);
    assert.deepEqual(r.entries.map((e) => e.labels.index), ['policy-decision-log', 'policy-decision-log', 'audit-log']);
    assert.equal(r.entries[1].level, 'warn', 'a Deny is level warn');
    assert.ok(r.entries.every((e) => e.service === 'privilege-siem' && e.product === 'psiem'));
    assert.ok(!r.entries.some((e) => e.message.includes('FAKEFAKEFAKEFAKE')), 'an unmasked AgentKey never reaches the page');
    assert.ok(!JSON.stringify(r).includes(KEY));
    assert.deepEqual(r.request, { method: 'POST', path: '/ping-siem-events-v2/_search', host: new URL(es.base).host });
    const runtime = await client.search({ q: q('{service="privilege-siem", kind="runtime"} |= "Deny"'), now: Date.now(), sinceMs: 86_400_000, limit: 50 });
    assert.equal(runtime.entries.length, 1, 'label matchers and line filters apply to the fetched documents');
  } finally { await es.close(); }
});

test('the client reports each failure in words, never echoing the key, and refuses redirects and oversized answers', T, async () => {
  const cases = [
    [(_q, res) => { res.statusCode = 401; res.end('{"error":"nope"}'); }, 'siem_unauthorized', /refused the read credential \(HTTP 401\)/],
    [(_q, res) => { res.statusCode = 403; res.end('{}'); }, 'siem_unauthorized', /HTTP 403/],
    [(_q, res) => { res.statusCode = 500; res.end('boom'); }, 'siem_error', /HTTP 500: boom/],
    [(_q, res) => res.end('<html>'), 'siem_bad_response', /did not answer with JSON/],
    [(_q, res) => { res.setHeader('content-type', 'application/json'); res.end('{"hits":{}}'); }, 'siem_bad_response', /something other than search hits/],
    [(_q, res) => { res.statusCode = 302; res.setHeader('location', 'http://elsewhere.example/'); res.end(); }, 'siem_unreachable', /Could not reach/],
    [(_q, res) => { res.setHeader('content-type', 'application/json'); res.end('x'.repeat(LIMITS.maxBytes + 10)); }, 'siem_too_large', /more data than this lab will read/],
  ];
  for (const [handler, code, pattern] of cases) {
    const es = await fakeEs(handler);
    try {
      const client = createSiemClient({ baseUrl: es.base, index: 'ping-siem-events-v2', apiKey: KEY, timeField: '@timestamp' });
      await assert.rejects(client.search({ q: q('{service="privilege-siem"}'), now: Date.now(), sinceMs: 60_000, limit: 10 }), (e) => {
        assert.ok(e instanceof SiemError);
        assert.equal(e.code, code);
        assert.match(e.detail, pattern);
        assert.ok(!e.detail.includes(KEY));
        return true;
      });
    } finally { await es.close(); }
  }
  const dead = await fakeEs(() => {}); const base = dead.base; await dead.close();
  await assert.rejects(createSiemClient({ baseUrl: base, index: 'i', apiKey: KEY, timeField: '@timestamp' }).search({ q: q('{service="privilege-siem"}'), now: Date.now(), sinceMs: 60_000, limit: 10 }), { code: 'siem_unreachable' });
});

const get = async (url, path) => { const r = await fetch(`${url}${path}`, { redirect: 'error' }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, text, json }; };

test('through the app: Real reads the SIEM for service="privilege-siem" with a 30-day window, the key never appears, other queries need Loki', T, async () => {
  const es = await fakeEs(ok([hit('a'), hit('b', { Index: 'audit-log', privilege_event_kind: 'console', Data: { Action: 'edit' } }, 3_600_000)]));
  try {
    await withServer(async (url) => {
      const info = await get(url, '/api/info');
      assert.equal(info.json.mode, 'real');
      assert.equal(info.json.siem.configured, true);
      assert.equal(info.json.siem.index, 'ping-siem-events-v2');
      assert.ok(info.json.siem.kibana.deepLink.includes('privilege-logs'));
      assert.ok(!info.text.includes(KEY), 'the key is never in /api/info');
      const sel = encodeURIComponent('{service="privilege-siem"}');
      const logs = await get(url, `/api/logs?query=${sel}&minutes=43200`);
      assert.equal(logs.status, 200);
      assert.equal(logs.json.count, 2);
      assert.deepEqual(logs.json.entries.map((e) => e.labels.kind).sort(), ['console', 'runtime']);
      assert.equal(logs.json.hops?.[1]?.to, 'elasticsearch', 'the hops panel names the SIEM, not Loki');
      assert.ok(!logs.text.includes(KEY));
      assert.equal(es.requests.length, 1);
      const tooLong = await get(url, `/api/logs?query=${sel}&minutes=999999`);
      assert.equal(tooLong.status, 400);
      assert.match(tooLong.json.detail, /1-43200/);
      const lokiLong = await get(url, `/api/logs?query=${encodeURIComponent('{service="pingfederate"}')}&minutes=60`);
      assert.equal(lokiLong.status, 400, 'the long window is only for the SIEM');
      const noLoki = await get(url, `/api/logs?query=${encodeURIComponent('{service="pingfederate"}')}`);
      assert.equal(noLoki.status, 409);
      assert.equal(noLoki.json.error, 'real_not_configured');
      const alerts = await get(url, '/api/alerts');
      assert.equal(alerts.status, 200, 'alerts treat a source that is not set up as silent, not as an error');
      assert.ok(!alerts.text.includes(KEY));
    }, { env: { PRIVILEGE_SIEM_URL: es.base, PRIVILEGE_SIEM_READ_APIKEY: KEY, PRIVILEGE_KIBANA_URL: 'http://localhost:5601' } });
  } finally { await es.close(); }
});

test('through the app: Real with a wrong key says so in words, and Mock holds the placeholder sample and needs no settings', T, async () => {
  const es = await fakeEs((_req, res) => { res.statusCode = 401; res.end('{}'); });
  try {
    await withServer(async (url) => {
      const r = await get(url, `/api/logs?query=${encodeURIComponent('{service="privilege-siem"}')}`);
      assert.equal(r.status, 502);
      assert.equal(r.json.error, 'siem_unauthorized');
      assert.ok(!r.text.includes(KEY));
    }, { env: { PRIVILEGE_SIEM_URL: es.base, PRIVILEGE_SIEM_READ_APIKEY: KEY } });
  } finally { await es.close(); }
  await withServer(async (url) => {
    const mock = await get(url, `/api/logs?query=${encodeURIComponent('{service="privilege-siem"}')}`);
    assert.equal(mock.status, 200);
    assert.ok(mock.json.count >= 20 && mock.json.entries.every((e) => e.product === 'psiem'));
    const consoleOnly = await get(url, `/api/logs?query=${encodeURIComponent('{service="privilege-siem", kind="console"}')}`);
    assert.ok(consoleOnly.json.count >= 3 && consoleOnly.json.entries.every((e) => e.source === 'audit-log'));
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(mock.text), 'the public sample holds placeholders only');
    const info = await get(url, '/api/info');
    assert.equal(info.json.siem.configured, false);
    assert.match(info.json.siem.problem, /PRIVILEGE_SIEM_URL/);
    const sw = await post(url, '/api/mode', { source: 'real' });
    assert.equal(sw.status, 409);
    // the SIEM asked for in Real with no settings: handled in a Real server below
  }, { env: { MODE: 'mock' } });
});
