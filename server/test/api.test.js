import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeLoki, post, rawHttp, withServer } from './helpers.js';

const J = (r) => r.json();
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

test('GET /api/health is demo-health/1, GET only', async () => {
  await withServer(async (url) => {
    const j = await J(await fetch(`${url}/api/health`));
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.demo.id, 'observability-lab');
    const bad = await fetch(`${url}/api/health`, { method: 'POST', headers: { origin: url } });
    assert.equal(bad.status, 405);
  });
});

test('GET /api/logs: default query returns all three products, newest first, labelled by service; bad params and queries are 400', async () => {
  await withServer(async (url) => {
    const j = await J(await fetch(`${url}/api/logs`));
    assert.equal(j.source, 'mock');
    assert.equal(j.relabel, true);
    assert.deepEqual([...new Set(j.entries.map((e) => e.product))].sort(), ['pinggateway', 'pingfederate', 'pingone'].sort());
    assert.ok(j.count > 0 && j.count <= 200);
    for (let i = 1; i < j.entries.length; i++) assert.ok(j.entries[i - 1].ts >= j.entries[i].ts);
    assert.ok(j.entries.every((e) => ['pingone-webhook', 'pingfederate', 'ping-gateway'].includes(e.service)));
    const f = await J(await fetch(`${url}/api/logs?query=${encodeURIComponent('{service="pingfederate"} |= "FAILURE"')}`));
    assert.ok(f.entries.length >= 1 && f.entries.every((e) => e.service === 'pingfederate' && e.message.includes('FAILURE')));
    const lim = await J(await fetch(`${url}/api/logs?limit=3`));
    assert.equal(lim.entries.length, 3); assert.equal(lim.truncated, true);
    for (const bad of ['limit=0', 'limit=501', 'limit=x', 'limit=1.5', 'minutes=0', 'minutes=31']) assert.equal((await fetch(`${url}/api/logs?${bad}`)).status, 400, bad);
    for (const q of ['', 'junk', '{}', '{service=~"(a+)+"}', '{service="x"} |= bare']) {
      const r = await fetch(`${url}/api/logs?query=${encodeURIComponent(q)}`);
      assert.equal(r.status, 400, q);
      assert.match((await J(r)).error, /bad_query|regex_unsupported/);
    }
    assert.equal((await fetch(`${url}/api/logs?query=${'x'.repeat(5000)}`)).status, 400);
  });
});

test('hostile log text is returned as JSON text, never markup, and the server never evaluates it', async () => {
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/logs?query=${encodeURIComponent('{service="<script>alert(1)</script>"}')}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const j = await J(r);
    assert.equal(j.count, 0);
    assert.match(j.query, /<script>/, 'echoed as data inside JSON');
  });
});

test('the Mock/Real toggle (rule 19): both directions, 409 with the reason when unconfigured, strict body', async () => {
  const loki = await fakeLoki((_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'success', data: { resultType: 'streams', result: [] } })); });
  try {
    await withServer(async (url) => {
      let info = await J(await fetch(`${url}/api/info`));
      assert.equal(info.source, 'mock'); assert.equal(info.realAvailable, false); assert.match(info.realHint, /OBS_LOKI_URL/);
      const refused = await post(url, '/api/mode', { source: 'real' });
      assert.equal(refused.status, 409);
      assert.match((await J(refused)).detail, /OBS_LOKI_URL/);
      assert.equal((await J(await fetch(`${url}/api/info`))).source, 'mock', 'a refused switch changes nothing');
      for (const bad of [{}, { source: 'live' }, { source: 'mock', extra: 1 }, [], 'real', { source: 5 }]) assert.equal((await post(url, '/api/mode', bad)).status, 400, JSON.stringify(bad));
    });
    await withServer(async (url) => {
      let info = await J(await fetch(`${url}/api/info`));
      assert.equal(info.source, 'mock', 'MODE unset + Loki configured launches Real by default; env here forces mock');
    }, { env: { MODE: 'mock', OBS_LOKI_URL: loki.base } });
    await withServer(async (url) => {
      assert.equal((await J(await fetch(`${url}/api/info`))).source, 'real');
      assert.equal((await post(url, '/api/mode', { source: 'mock' })).status, 200);
      assert.equal((await J(await fetch(`${url}/api/info`))).source, 'mock');
      assert.equal((await J(await fetch(`${url}/api/logs`))).source, 'mock', 'data reloads from the mock after switching');
      assert.equal((await post(url, '/api/mode', { source: 'real' })).status, 200);
      const j = await J(await fetch(`${url}/api/logs`));
      assert.equal(j.source, 'real');
      assert.equal(j.count, 0);
      assert.equal(j.hops[1].to, 'loki');
    }, { env: { OBS_LOKI_URL: loki.base } });
  } finally { await loki.close(); }
});

test('incidents and the relabel switch change the mock stream, per workspace; reset restores it; Real refuses them with 409', async () => {
  await withServer(async (url) => {
    const alerts = async (ws) => Object.fromEntries((await J(await fetch(`${url}/api/alerts`, { headers: { 'x-workspace': ws } }))).rules.map((r) => [r.id, r.state]));
    assert.deepEqual(Object.values(await alerts('one')), ['ok', 'ok', 'ok']);
    assert.equal((await post(url, '/api/incident', { name: 'login-burst' }, { 'x-workspace': 'one' })).status, 200);
    assert.equal((await alerts('one')).FailedLoginBurst, 'firing');
    assert.equal((await alerts('two')).FailedLoginBurst, 'ok', 'another workspace is untouched');
    assert.equal((await post(url, '/api/relabel', { enabled: false }, { 'x-workspace': 'one' })).status, 200);
    const off = await J(await fetch(`${url}/api/logs`, { headers: { 'x-workspace': 'one' } }));
    assert.equal(off.count, 0); assert.equal(off.relabel, false);
    assert.equal((await alerts('one')).ProductLogSilence, 'firing');
    assert.equal((await J(await fetch(`${url}/api/relabel`, { headers: { 'x-workspace': 'two' } }))).enabled, true);
    assert.equal((await post(url, '/api/reset', {}, { 'x-workspace': 'one' })).status, 200);
    assert.deepEqual(Object.values(await alerts('one')), ['ok', 'ok', 'ok']);
    assert.ok((await J(await fetch(`${url}/api/logs`, { headers: { 'x-workspace': 'one' } }))).count > 0);
    for (const bad of [{}, { name: 'nope' }, { name: 5 }]) assert.equal((await post(url, '/api/incident', bad)).status, 400);
    for (const bad of [{}, { enabled: 'no' }, { enabled: 1 }]) assert.equal((await post(url, '/api/relabel', bad)).status, 400);
    assert.equal((await fetch(`${url}/api/logs`, { headers: { 'x-workspace': 'Bad Id' } })).status, 400);
  });
});

test('incident injection is bounded however often it is pressed', async () => {
  await withServer(async (url) => {
    for (let i = 0; i < 40; i++) assert.equal((await post(url, '/api/incident', { name: 'gateway-5xx' })).status, 200);
    const j = await J(await fetch(`${url}/api/logs?query=${encodeURIComponent('{service="ping-gateway"} |= "upstream=timeout"')}&limit=500`));
    assert.ok(j.count <= 200, `injected events are capped, got ${j.count}`);
  }, { now: () => NOW });
});

test('scenarios, diagram and runs endpoints; verticals fill the cast', async () => {
  await withServer(async (url) => {
    const s = await J(await fetch(`${url}/api/scenarios`));
    assert.equal(s.scenarios.length, 6); assert.equal(s.products.length, 12); assert.deepEqual(s.verticals.sort(), ['finance', 'health', 'retail']);
    assert.ok(!JSON.stringify(s).includes('{{'));
    const fin = await J(await fetch(`${url}/api/scenarios?vertical=finance`));
    assert.match(JSON.stringify(fin), /payments-agent/);
    const d = await J(await fetch(`${url}/api/diagram`));
    assert.ok(d.nodes.length >= 8 && d.steps.length >= 6);
    assert.deepEqual((await J(await fetch(`${url}/api/diagram?name=../../etc/passwd`))).title, d.title, 'an unknown diagram name falls back, never reads a path');
    await post(url, '/api/incident', { name: 'login-burst' });
    assert.deepEqual((await J(await fetch(`${url}/api/runs`))).runs.map((r) => r.action), ['incident']);
    assert.equal((await fetch(`${url}/api/nope`)).status, 404);
  });
});

test('safety: bad Host is 403, cross-origin writes are 403, oversize body is 413 as short JSON', async () => {
  await withServer(async (url) => {
    const bad = await rawHttp(`${url}/api/info`, { headers: { host: 'evil.example' } });
    assert.equal(bad.status, 403);
    const cross = await fetch(`${url}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' });
    assert.equal(cross.status, 403);
    const big = await post(url, '/api/relabel', { enabled: true, pad: 'x'.repeat(20_000) });
    assert.equal(big.status, 413);
    assert.deepEqual(await J(big), { error: 'payload_too_large' });
  });
});

test('in Real mode, incidents and the relabel switch are refused with 409 and change nothing', async () => {
  const loki = await fakeLoki((_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'success', data: { resultType: 'streams', result: [] } })); });
  try {
    await withServer(async (url) => {
      assert.equal((await J(await fetch(`${url}/api/info`))).source, 'real');
      const inc = await post(url, '/api/incident', { name: 'login-burst' });
      assert.equal(inc.status, 409); assert.equal((await J(inc)).error, 'mock_only');
      const rel = await post(url, '/api/relabel', { enabled: false });
      assert.equal(rel.status, 409); assert.equal((await J(rel)).error, 'mock_only');
      assert.equal((await post(url, '/api/mode', { source: 'mock' })).status, 200);
      assert.equal((await J(await fetch(`${url}/api/relabel`))).enabled, true, 'the refused relabel changed nothing');
      assert.deepEqual((await J(await fetch(`${url}/api/runs`))).runs, [], 'no action was recorded');
    }, { env: { OBS_LOKI_URL: loki.base } });
  } finally { await loki.close(); }
});

test('query and numeric parameters are strict: repeated or nested query, exponent, hex and padded numbers are 400', async () => {
  await withServer(async (url) => {
    for (const bad of ['query=a&query=b', 'query[a]=b', 'limit=1e2', 'limit=0x10', 'limit=%2010', 'limit=-1', 'limit=+5', 'minutes=1.0', 'limit=1234567']) {
      assert.equal((await fetch(`${url}/api/logs?${bad}`)).status, 400, bad);
    }
    assert.equal((await fetch(`${url}/api/logs?limit=7&minutes=5`)).status, 200);
  });
});
