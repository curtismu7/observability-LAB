import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LOOKUPS, TTL_MS, latestValues } from '../src/startingValues.js';
import { withServer } from './helpers.js';

const KEY = 'not-a-real-key-test-value';
const DOCS = { // index -> [filter value or '' , _source]
  'ping-siem-events-v2': { 'Data.User': { Data: { User: 'u-1' } }, 'Data.AgentKey': { Data: { AgentKey: 'key-1' } }, 'Data.Target': { Data: { Target: 'Tool1' } }, 'Data.App': { Data: { App: 'app-1' } }, 'User.Name': { User: { Name: 'admin-1' } } },
  'ping-logs-*': { user: { user: 'someone' }, client_id: { client_id: 'client-1' } },
};

// A fake Elasticsearch: answers POST /<index>/_search by reading the one field the lookup asks for. pingone-events is refused (403).
async function fakeEs() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      const index = decodeURIComponent(req.url.split('/')[1]);
      if (index === 'pingone-events') { res.statusCode = 403; return res.end('{"error":"forbidden"}'); }
      const field = body._source[0];
      const terms = body.query.bool.filter.filter((f) => f.term).map((f) => Object.values(f.term)[0]);
      let src = DOCS[index]?.[field];
      if (index === 'ping-logs-*' && field === 'user' && terms[0] === 'pingone') src = { user: 'demoUser' };
      res.end(JSON.stringify({ hits: { hits: src ? [{ _source: src }] : [] } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

test('latestValues: finds the newest value per search with fixed read-only lookups; a refused index only costs its own box', async () => {
  const es = await fakeEs();
  try {
    const r = await latestValues({ baseUrl: es.base, apiKey: KEY, siemIndex: 'ping-siem-events-v2', timeField: '@timestamp' });
    assert.deepEqual(r.values, { 'priv-user': 'u-1', 'priv-agent-key': 'key-1', 'priv-tool': 'Tool1', 'priv-app': 'app-1', 'priv-console-admin': 'admin-1', 'all-user': 'someone', 'pf-client': 'client-1', 'p1-user': 'demoUser' });
    assert.deepEqual(r.failed, ['pe-actor-id'], 'the 403 index is skipped, not fatal');
    assert.equal(es.seen.length, Object.keys(LOOKUPS).length);
    for (const s of es.seen) {
      assert.equal(s.method, 'POST'); assert.match(s.url, /^\/[^/]+\/_search$/);
      assert.equal(s.auth, `ApiKey ${KEY}`);
      assert.deepEqual(Object.keys(s.body).sort(), ['_source', 'query', 'size', 'sort', 'track_total_hits'], 'one fixed request shape');
      assert.equal(s.body.size, 1); assert.deepEqual(s.body.sort[0]['@timestamp'].order, 'desc');
    }
    assert.ok(!JSON.stringify(r).includes(KEY), 'the key is never in the result');
  } finally { await es.close(); }
});

test('latestValues: an unreachable Elasticsearch gives no values and never throws', async () => {
  const r = await latestValues({ baseUrl: 'http://127.0.0.1:9', apiKey: KEY, siemIndex: 'ping-siem-events-v2', timeField: '@timestamp' });
  assert.deepEqual(r.values, {}); assert.equal(r.failed.length, Object.keys(LOOKUPS).length);
});

test('latestValues: values with control characters or over 200 characters are dropped', async () => {
  const fetchFn = async () => ({ ok: true, text: async () => JSON.stringify({ hits: { hits: [{ _source: { Data: { User: 'a\nb', AgentKey: 'x'.repeat(201), Target: 'ok' } } }] } }) });
  const r = await latestValues({ baseUrl: 'http://x', apiKey: KEY, siemIndex: 'i', timeField: '@timestamp', fetchFn });
  assert.equal(r.values['priv-user'], undefined); assert.equal(r.values['priv-agent-key'], undefined); assert.equal(r.values['priv-tool'], 'ok');
});

test('GET /api/search-defaults: live values from the SIEM read key, cached for five minutes; none when the SIEM is not configured', async () => {
  await withServer(async (url) => {
    const j = await (await fetch(`${url}/api/search-defaults`)).json();
    assert.equal(j.source, 'none'); assert.deepEqual(j.values, {}); assert.match(j.reason, /PRIVILEGE_SIEM_URL/);
  });
  const es = await fakeEs(); let t = 1_000_000;
  try {
    await withServer(async (url) => {
      const a = await (await fetch(`${url}/api/search-defaults`)).json();
      assert.equal(a.source, 'live'); assert.equal(a.values['priv-user'], 'u-1'); assert.deepEqual(a.failed, ['pe-actor-id']);
      assert.ok(!JSON.stringify(a).includes(KEY));
      const n = es.seen.length;
      await fetch(`${url}/api/search-defaults`);
      assert.equal(es.seen.length, n, 'the second call is served from the cache');
      t += TTL_MS + 1;
      await fetch(`${url}/api/search-defaults`);
      assert.equal(es.seen.length, n * 2, 'after five minutes it looks again');
    }, { env: { PRIVILEGE_SIEM_URL: es.base, PRIVILEGE_SIEM_READ_APIKEY: KEY }, now: () => t });
  } finally { await es.close(); }
});
