import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueryHops, formatTraceparent, newTrace, parseTraceparent } from '../src/trace.js';
import { withServer } from './helpers.js';

const GOOD = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

test('parseTraceparent accepts the W3C shape and refuses everything else', () => {
  assert.deepEqual(parseTraceparent(GOOD), { traceId: '0af7651916cd43dd8448eb211c80319c', parentId: 'b7ad6b7169203331', flags: '01' });
  for (const bad of [undefined, '', 'x', GOOD.toUpperCase(), `00-${'0'.repeat(32)}-b7ad6b7169203331-01`, `00-0af7651916cd43dd8448eb211c80319c-${'0'.repeat(16)}-01`, `${GOOD}-extra`, 5, `00-${'a'.repeat(32)}-${'b'.repeat(16)}-ff`]) assert.equal(parseTraceparent(bad), null);
});

test('one trace id and a distinct valid span id per hop; mock and real hops are labelled differently', () => {
  const trace = newTrace(GOOD);
  assert.equal(trace.traceId, '0af7651916cd43dd8448eb211c80319c');
  const mock = buildQueryHops({ trace, queryText: '{service="x"}', source: 'mock', count: 3 });
  assert.equal(mock.length, 2);
  assert.match(mock[1].label, /MOCK store.*no network/);
  const real = buildQueryHops({ trace, queryText: '{service="x"}', source: 'real', count: 3, lokiRequest: { method: 'GET', path: '/loki/api/v1/query_range?query=x', host: '127.0.0.1:3100' }, lokiResponse: { status: 200, streams: 1, bytes: 99 } });
  assert.equal(real[1].to, 'loki');
  assert.match(real[1].response, /HTTP 200/);
  for (const set of [mock, real]) {
    assert.equal(new Set(set.map((h) => h.traceparent)).size, set.length);
    for (const h of set) { assert.ok(parseTraceparent(h.traceparent)); assert.ok(h.traceparent.includes(trace.traceId)); assert.ok(h.request.includes(h.traceparent)); }
  }
  assert.equal(formatTraceparent('a'.repeat(32), 'b'.repeat(16)), `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
});

test('GET /api/logs returns hops and a traceparent header, and continues a valid incoming trace only', async () => {
  await withServer(async (url) => {
    const get = (headers = {}) => fetch(`${url}/api/logs`, { headers });
    let r = await get(); let j = await r.json();
    assert.ok(parseTraceparent(r.headers.get('traceparent')));
    assert.equal(j.hops.length, 2);
    assert.match(j.traceId, /^[0-9a-f]{32}$/);
    r = await get({ traceparent: GOOD }); j = await r.json();
    assert.equal(j.traceId, '0af7651916cd43dd8448eb211c80319c');
    r = await get({ traceparent: 'garbage' });
    assert.notEqual((await r.json()).traceId, '0af7651916cd43dd8448eb211c80319c');
  });
});
