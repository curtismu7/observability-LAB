import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, LokiError, createLokiClient, mapStreams } from '../src/lokiClient.js';
import { parseQuery } from '../src/logql.js';
import { fakeLoki, withServer } from './helpers.js';

const ok = (result) => (_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'success', data: { resultType: 'streams', result } })); };
const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const ns = (ms) => String(BigInt(ms) * 1_000_000n);

test('Real mode end to end against a loopback Loki: the lab sends a read-only query_range rebuilt from the PARSED query', async () => {
  const lines = [
    { stream: { service: 'pingfederate', level: 'warn' }, values: [[ns(NOW - 1000), 'AUTHN_ATTEMPT FAILURE user=u trace_id=0af7651916cd43dd8448eb211c80319c'], [ns(NOW - 5000), 'AUTHN_ATTEMPT SUCCESS user=u']] },
    { stream: { service: 'something-else' }, values: [[ns(NOW - 3000), 'level=error boom']] },
  ];
  const loki = await fakeLoki(ok(lines));
  try {
    await withServer(async (url) => {
      const q = '{service="pingfederate"}   |=   "FAILURE"';
      const j = await (await fetch(`${url}/api/logs?query=${encodeURIComponent(q)}&limit=50`, { headers: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' } })).json();
      assert.equal(j.source, 'real');
      assert.equal(j.count, 3);
      assert.deepEqual(j.entries.map((e) => e.level), ['warn', 'error', 'warn'], 'level comes from the stream label, then the line');
      assert.equal(j.entries[0].product, 'pingfederate'); assert.equal(j.entries[1].product, 'unknown');
      assert.equal(j.entries[0].traceId, '0af7651916cd43dd8448eb211c80319c');
      assert.match(j.hops[1].request, /^GET \/loki\/api\/v1\/query_range\?/);
      assert.match(j.hops[1].response, /HTTP 200: 2 stream\(s\)/);
    }, { now: () => NOW, env: { OBS_LOKI_URL: loki.base } });
    const sent = loki.requests[0];
    assert.equal(sent.method, 'GET');
    const u = new URL(sent.url, 'http://x');
    assert.equal(u.pathname, '/loki/api/v1/query_range');
    assert.equal(u.searchParams.get('query'), '{service="pingfederate"} |= "FAILURE"', 'canonical text, not the raw spacing the user typed');
    assert.equal(u.searchParams.get('limit'), '50'); assert.equal(u.searchParams.get('direction'), 'backward');
    assert.match(sent.headers.traceparent, /^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/, 'trace continues to Loki');
    assert.equal(sent.headers.authorization, undefined, 'no credentials are ever sent');
  } finally { await loki.close(); }
});

test('Real mode alerts are computed over Loki lines with the same rules', async () => {
  const gw = (status, n) => Array.from({ length: n }, (_, i) => [ns(NOW - 1000 * (i + 1) - status), `route=/mcp method=POST status=${status} trace_id=${'a'.repeat(32)}`]);
  const loki = await fakeLoki((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams.get('query');
    const values = q.includes('ping-gateway') ? [...gw(502, 12), ...gw(200, 3)] : [];
    ok(values.length ? [{ stream: { service: 'ping-gateway' }, values }] : [])(req, res);
  });
  try {
    await withServer(async (url) => {
      const j = await (await fetch(`${url}/api/alerts`)).json();
      assert.equal(j.source, 'real');
      const by = Object.fromEntries(j.rules.map((r) => [r.id, r]));
      assert.equal(by.ProductLogSilence.state, 'firing', 'pingfederate and pingone-webhook returned nothing');
      assert.deepEqual(by.ProductLogSilence.evidence.silentServices.sort(), ['agentless-mcpgw', 'authz-server', 'gateway-events', 'llm-proxy', 'mcp-gateway', 'mcp-promptguard', 'mcp-server', 'ping-mcpgw', 'pingfederate', 'pingone-webhook', 'privilege-siem', 'procyon-nodesensor']);
    }, { now: () => NOW, env: { OBS_LOKI_URL: loki.base } });
  } finally { await loki.close(); }
});

test('Real mode failure modes are honest: unreachable, HTTP error, not JSON, wrong shape, too large, redirect', async () => {
  const cases = [
    ['loki_error', (_q, res) => { res.statusCode = 500; res.end('boom'); }],
    ['loki_bad_response', (_q, res) => res.end('<html>not json</html>')],
    ['loki_bad_response', (_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'success', data: { resultType: 'matrix', result: [] } })); }],
    ['loki_too_large', (_q, res) => { res.setHeader('content-type', 'application/json'); res.end('x'.repeat(LIMITS.maxBytes + 10)); }],
    ['loki_unreachable', (_q, res) => { res.statusCode = 302; res.setHeader('location', 'http://elsewhere.example/'); res.end(); }],
  ];
  for (const [code, handler] of cases) {
    const loki = await fakeLoki(handler);
    try {
      await withServer(async (url) => {
        const r = await fetch(`${url}/api/logs`);
        assert.equal(r.status, 502, code);
        assert.equal((await r.json()).error, code);
      }, { env: { OBS_LOKI_URL: loki.base } });
    } finally { await loki.close(); }
  }
  const dead = await fakeLoki(() => {}); const base = dead.base; await dead.close();
  await withServer(async (url) => {
    const r = await fetch(`${url}/api/logs`);
    assert.equal(r.status, 502); assert.equal((await r.json()).error, 'loki_unreachable');
  }, { env: { OBS_LOKI_URL: base } });
});

test('the client is read-only by construction: GET only, never follows a redirect, no body, refuses a hostile query before any request', async () => {
  const loki = await fakeLoki(ok([]));
  try {
    const c = createLokiClient({ baseUrl: loki.base });
    await c.queryRange({ query: parseQuery('{service="a"}'), now: NOW });
    assert.deepEqual(loki.requests.map((r) => r.method), ['GET']);
    await withServer(async (url) => {
      const r = await fetch(`${url}/api/logs?query=${encodeURIComponent('{service=~"(a+)+"}')}`);
      assert.equal(r.status, 400);
    }, { env: { OBS_LOKI_URL: loki.base } });
    assert.equal(loki.requests.length, 1, 'a rejected query never reached Loki');
  } finally { await loki.close(); }
});

test('level: the label wins, then the line, then Loki\'s guess, then unknown', () => {
  const lvl = (labels, line) => mapStreams([{ stream: { service: 's', ...labels }, values: [[ns(1), line]] }], 5)[0].level;
  assert.equal(lvl({ level: 'warn' }, 'ERROR boom'), 'warn', 'an explicit label beats the text');
  assert.equal(lvl({ detected_level: 'info' }, '\u001b[1;31m\u001b[0;39m[thread-1] \u001b[1;31mERROR\u001b[0;39m RouterHandler no handler'), 'error', 'a colourised ERROR line beats Loki\'s guess');
  assert.equal(lvl({}, '2026-11-07 15:24:16,901 tid:abc DEBUG [org.x.Y] flush cookies'), 'debug');
  assert.equal(lvl({}, 'WARNING disk almost full'), 'warn');
  assert.equal(lvl({}, 'FATAL out of memory'), 'error');
  assert.equal(lvl({ detected_level: 'info' }, 'plain text with no level'), 'info', 'detected_level is the fallback');
  assert.equal(lvl({}, 'there was no error here'), 'unknown', 'lower-case prose is not a level');
  assert.equal(lvl({}, 'x'.repeat(400) + ' ERROR'), 'unknown', 'only the start of the line is searched');
});

test('mapStreams survives hostile or malformed Loki data', () => {
  assert.equal(mapStreams([{ stream: { service: 's' }, values: [[ns(1), 'no level here']] }], 5)[0].level, 'unknown');
  assert.deepEqual(mapStreams(null, 10), []);
  assert.deepEqual(mapStreams([null, 5, { stream: null, values: 'x' }, { values: [[1], ['a', 2], null, ['abc', 'line']] }], 10).map((e) => e.message), ['line']);
  const rows = mapStreams([{ stream: { service: 's' }, values: Array.from({ length: 50 }, (_, i) => [ns(1000 + i), 'x'.repeat(10_000)]) }], 5);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.message.length === 4000));
});

test('LokiError carries a stable code and an HTTP status', () => {
  const e = new LokiError('loki_error', 'x');
  assert.equal(e.status, 502); assert.equal(e.code, 'loki_error');
});

test('a redirect is never followed, even to another LOOPBACK server (defence in depth beyond the netguard)', async () => {
  const target = await fakeLoki(ok([]));
  const redirector = await fakeLoki((_q, res) => { res.statusCode = 302; res.setHeader('location', `${target.base}/loki/api/v1/query_range?query=%7Ba%3D%22b%22%7D`); res.end(); });
  try {
    await withServer(async (url) => {
      const r = await fetch(`${url}/api/logs`);
      assert.equal(r.status, 502);
      assert.equal((await r.json()).error, 'loki_unreachable');
    }, { env: { OBS_LOKI_URL: redirector.base } });
    assert.equal(redirector.requests.length, 1);
    assert.equal(target.requests.length, 0, 'the redirect target was never requested');
  } finally { await redirector.close(); await target.close(); }
});
