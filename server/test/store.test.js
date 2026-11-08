import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAST } from '../src/cast.js';
import { INCIDENTS, incidentEvents, queryMock, serviceLabel, snapshot } from '../src/logStore.js';
import { parseQuery } from '../src/logql.js';
import { evaluateAlerts } from '../src/alerts.js';
import { SCENARIOS } from '../src/logData.js';
import { checkScenario } from '../src/doctor.js';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const fresh = () => ({ injected: [], relabel: true });
const ask = (state, text, extra = {}) => queryMock({ now: NOW, cast: DEFAULT_CAST, state, q: parseQuery(text), ...extra });
const alertsFor = async (state, now = NOW) => Object.fromEntries((await evaluateAlerts({ fetch: async ({ query, windowMs }) => queryMock({ now, cast: DEFAULT_CAST, state, q: query, since: now - windowMs, limit: 1000 }).entries })).map((r) => [r.id, r]));

test('the baseline is deterministic, lies in the last 30 minutes, and is newest-first', () => {
  const a = ask(fresh(), '{service=~"pingone-webhook|pingfederate|ping-gateway"}', { limit: 500 });
  const b = ask(fresh(), '{service=~"pingone-webhook|pingfederate|ping-gateway"}', { limit: 500 });
  assert.deepEqual(a.entries, b.entries);
  assert.ok(a.total > 100);
  for (const e of a.entries) { assert.ok(e.ts <= NOW && e.ts >= NOW - 31 * 60_000); assert.ok(!e.message.includes('{{'), 'tokens are filled'); }
  for (let i = 1; i < a.entries.length; i++) assert.ok(a.entries[i - 1].ts >= a.entries[i].ts);
});

test('time slides with now: the same events are always inside the window (no aging out)', async () => {
  const later = NOW + 3 * 3_600_000;
  const q = parseQuery('{service="pingfederate"}');
  assert.equal(queryMock({ now: later, cast: DEFAULT_CAST, state: fresh(), q, since: later - 600_000 }).total > 0, true);
  const al = await alertsFor(fresh(), later);
  assert.equal(al.ProductLogSilence.state, 'ok');
});

test('one sign-in is joinable by trace id across all three products', () => {
  const one = ask(fresh(), '{service=~"pingone-webhook|pingfederate|ping-gateway"} |= "user-5"', { limit: 50 });
  const trace = /trace_id[":= ]+([0-9a-f]{32})/.exec(one.entries.find((e) => e.product === 'pingfederate').message)[1];
  const joined = ask(fresh(), `{service=~"pingone-webhook|pingfederate|ping-gateway"} |= "${trace}"`, { limit: 50 });
  assert.deepEqual([...new Set(joined.entries.map((e) => e.product))].sort(), ['pingfederate', 'pinggateway', 'pingone']);
});

test('baseline: no rule fires, the 401s are plentiful but do not trip the gateway rule, the stray failures stay under the burst threshold', async () => {
  const al = await alertsFor(fresh());
  for (const r of Object.values(al)) assert.equal(r.state, 'ok', r.id);
  assert.ok(ask(fresh(), '{service="ping-gateway"} |= "status=401"').total >= 5, 'there are real 401s');
  assert.ok(ask(fresh(), '{service="pingfederate"} |= "FAILURE"').total >= 1, 'there are stray failures');
  assert.match(al.GatewayMostlyRejecting.summary, /under the traffic floor|5xx/);
});

test('login-burst fires FailedLoginBurst only; gateway-5xx fires GatewayMostlyRejecting only', async () => {
  const burst = await alertsFor({ injected: incidentEvents('login-burst', NOW, 1), relabel: true });
  assert.equal(burst.FailedLoginBurst.state, 'firing');
  assert.equal(burst.GatewayMostlyRejecting.state, 'ok');
  assert.ok(burst.FailedLoginBurst.evidence.failures >= 8);
  const gw = await alertsFor({ injected: incidentEvents('gateway-5xx', NOW, 1), relabel: true });
  assert.equal(gw.GatewayMostlyRejecting.state, 'firing');
  assert.equal(gw.FailedLoginBurst.state, 'ok');
  assert.ok(gw.GatewayMostlyRejecting.evidence.total >= 10 && gw.GatewayMostlyRejecting.evidence.ratio >= 0.5);
});

test('incidents age out of the 5-minute window and the rule resolves', async () => {
  const state = { injected: incidentEvents('login-burst', NOW, 1), relabel: true };
  assert.equal((await alertsFor(state, NOW)).FailedLoginBurst.state, 'firing');
  assert.equal((await alertsFor(state, NOW + 6 * 60_000)).FailedLoginBurst.state, 'ok');
});

test('the traffic floor: a few 5xx on an idle route do not fire', async () => {
  const idle = incidentEvents('gateway-5xx', NOW, 1).filter((e) => e.level === 'error').slice(0, 4);
  const al = await alertsFor({ injected: idle, relabel: true });
  assert.equal(al.GatewayMostlyRejecting.state, 'ok');
});

test('relabel off: the service label carries the raw container name, every by-service query is empty, only the silence rule notices', async () => {
  const off = { injected: [], relabel: false };
  assert.equal(serviceLabel('pingfederate', false), '/obs-demo-pingfederate');
  assert.equal(serviceLabel('pingfederate', true), 'pingfederate');
  assert.equal(ask(off, '{service="pingfederate"}').total, 0);
  assert.equal(ask(off, '{service=~"pingone-webhook|pingfederate|ping-gateway"}').total, 0);
  assert.ok(ask(off, '{service="/obs-demo-pingfederate"}').total > 0, 'the lines are still there under the raw name');
  const al = await alertsFor(off);
  assert.equal(al.ProductLogSilence.state, 'firing');
  assert.deepEqual(al.ProductLogSilence.evidence.silentServices.sort(), ['agentless-mcpgw', 'authz-server', 'gateway-events', 'llm-proxy', 'mcp-gateway', 'mcp-promptguard', 'mcp-server', 'mcp-weather', 'ping-gateway', 'ping-mcpgw', 'pingfederate', 'pingone-webhook', 'privilege-siem', 'procyon-nodesensor']);
  assert.equal(al.FailedLoginBurst.state, 'ok', 'the other rules just go quiet, which is the trap');
});

test('every scenario teaches what it claims, and its expectation is mutation-sensitive', async () => {
  for (const sc of SCENARIOS) assert.deepEqual(await checkScenario(sc), [], sc.id);
  // mutate: a scenario whose action is missing must fail its expectation
  const burst = SCENARIOS.find((s) => s.id === 'login-burst');
  assert.notDeepEqual(await checkScenario({ ...burst, action: null }), []);
  const quiet = SCENARIOS.find((s) => s.id === 'everything-went-quiet');
  assert.notDeepEqual(await checkScenario({ ...quiet, action: null }), []);
});

test('incidentEvents is deterministic, bounded and knows only the two incidents', () => {
  assert.deepEqual(INCIDENTS, ['login-burst', 'gateway-5xx']);
  assert.deepEqual(incidentEvents('login-burst', NOW, 1), incidentEvents('login-burst', NOW, 1));
  assert.notDeepEqual(incidentEvents('gateway-5xx', NOW, 1).map((e) => e.message), incidentEvents('gateway-5xx', NOW, 2).map((e) => e.message));
  assert.deepEqual(incidentEvents('nope', NOW, 1), []);
  for (const n of INCIDENTS) assert.ok(incidentEvents(n, NOW, 1).length <= 20);
});

test('snapshot fills cast tokens per vertical and never leaks a raw token', () => {
  const all = snapshot({ now: NOW, cast: { ...DEFAULT_CAST, castClientId: 'payments-agent' }, state: fresh() });
  assert.ok(all.some((e) => e.message.includes('payments-agent')));
  assert.ok(all.every((e) => !e.message.includes('{{')));
});

test('the traffic floor is what holds the gateway rule back: all-5xx but under 10 requests does not fire, and 10 does', async () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, ts: NOW - 1000 * (i + 1), product: 'pinggateway', service: 'ping-gateway', source: 'route-log', level: 'error', message: `route=/mcp method=POST status=502 trace_id=${'a'.repeat(32)}`, traceId: null }));
  const run = async (n) => (await evaluateAlerts({ fetch: async () => lines(n) })).find((r) => r.id === 'GatewayMostlyRejecting');
  const few = await run(9);
  assert.equal(few.evidence.ratio, 1, 'the ratio alone WOULD fire');
  assert.equal(few.state, 'ok', 'the floor holds it back');
  assert.equal((await run(10)).state, 'firing');
});

test('Privilege sensor and MCP gateway lines exist, are queryable by service, and keep their measured shapes', () => {
  const sensor = ask(fresh(), '{service="procyon-nodesensor"} |= "nodesensor: reported findings"', { limit: 50 });
  assert.ok(sensor.entries.length >= 5 && sensor.entries.every((e) => e.product === 'privilege' && e.message.startsWith('level=INFO msg="nodesensor: reported findings"')));
  const gw = ask(fresh(), '{service="mcp-gateway"} |= "[GW] authz warm: ok"', { limit: 50 });
  assert.ok(gw.entries.length >= 5 && gw.entries.every((e) => e.product === 'mcp'));
  const exec = ask(fresh(), '{service="procyon-nodesensor"} |= "exec "', { limit: 50 });
  assert.ok(exec.entries.length >= 4);
  // Both are fresh enough that the silence rule has nothing to say at baseline (the baseline test above asserts no rule fires).
  for (const q of ['{service="procyon-nodesensor"}', '{service="mcp-gateway"}']) assert.ok(ask(fresh(), q, { limit: 5 }).entries.some((e) => e.ts >= NOW - 10 * 60_000), q);
});

test('Privilege agent gateway: the invalid-token line is written with a missing-header line by the same request (measured), never alone', () => {
  const all = ask(fresh(), '{service="ping-mcpgw"}', { limit: 500 }).entries;
  const invalid = all.filter((e) => e.message.includes('Invalid Authorization token'));
  const missing = all.filter((e) => e.message.includes('authorization header missing'));
  assert.ok(invalid.length >= 5 && invalid.length === missing.length, 'one of each per request');
  for (const e of invalid) assert.ok(missing.some((m) => e.ts - m.ts >= 0 && e.ts - m.ts <= 5), `invalid-token line at ${e.ts} has a missing-header line within 5 ms before it`);
});

test('Privilege agent gateway: a request received is four back-to-back [SERVER] lines that name the client, with a documentation address', () => {
  const lines = ask(fresh(), '{service="ping-mcpgw"} |= "[SERVER]"', { limit: 500 }).entries;
  assert.ok(lines.length >= 20 && lines.length % 4 === 0 && lines.every((e) => e.source === 'server-request' && e.level === 'info'));
  assert.equal(lines.filter((e) => /Incoming request: GET \//.test(e.message)).length, lines.length / 4);
  assert.equal(lines.filter((e) => /User-Agent: Go-http-client\/1\.1/.test(e.message)).length, lines.length / 4);
  const addrs = lines.filter((e) => /Remote Addr: /.test(e.message));
  assert.equal(addrs.length, lines.length / 4);
  assert.ok(addrs.every((e) => /Remote Addr: 192\.0\.2\.1:\d+/.test(e.message)), 'a documentation address, never a real host address');
});

test('Privilege agent gateway: rejected requests are logged at level info (measured), only the control-plane stream error is error', () => {
  const rejected = ask(fresh(), '{service="ping-mcpgw"} |= "Authorization"', { limit: 100 });
  assert.ok(rejected.entries.length >= 5 && rejected.entries.every((e) => e.product === 'pgateway' && e.level === 'info'));
  const errors = ask(fresh(), '{service="ping-mcpgw"} |= "level=error"', { limit: 20 });
  assert.ok(errors.entries.length >= 1 && errors.entries.every((e) => e.level === 'error' && /Unavailable/.test(e.message)));
  assert.ok(ask(fresh(), '{service="ping-mcpgw"}', { limit: 5 }).entries.some((e) => e.ts >= NOW - 10 * 60_000), 'fresh enough that the silence rule is quiet at baseline');
});

test('Privilege hosted gateway: each request names the caller and the app; allowed is only a proxy line, a refusal is one info-level line (measured)', () => {
  const all = ask(fresh(), '{service="agentless-mcpgw"}', { limit: 500 }).entries;
  assert.ok(all.every((e) => e.product === 'phosted'));
  const n = (source) => all.filter((e) => e.source === source).length;
  assert.equal(n('caller-token'), 10);
  assert.equal(n('resolved-host'), 10);
  assert.equal(n('proxying') + n('policy-denied'), 10, 'every request ends in exactly one of: proxied, or denied');
  assert.equal(n('policy-denied'), 2);
  assert.ok(all.filter((e) => e.source === 'policy-denied').every((e) => e.level === 'info' && /policy denied <user-id> access to a2a app worker-agent/.test(e.message)), 'a denial is level info');
  assert.ok(!all.some((e) => /allowed/i.test(e.message)), 'there is no allow line');
  assert.ok(all.filter((e) => e.source === 'aiguard-blocked').every((e) => e.level === 'warn'));
  for (const e of all) assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(e.message), 'no real id in a seeded line');
  assert.ok(all.some((e) => e.ts >= NOW - 10 * 60_000), 'fresh enough that the silence rule is quiet at baseline');
});

test('real PingFederate and Ping Gateway lines (measured): the stdout server log is half DEBUG with the path in front, the router error repeats', () => {
  const pf = ask(fresh(), '{service="pingfederate"} |= "server.log:"', { limit: 200 }).entries;
  assert.ok(pf.length >= 20 && pf.every((e) => e.source === 'server-stdout' && e.message.startsWith('/opt/out/instance/log/server.log:')));
  assert.ok(pf.filter((e) => e.level === 'debug').length > pf.filter((e) => e.level === 'info').length, 'mostly DEBUG, as measured');
  const gw = ask(fresh(), '{service="ping-gateway"} |= "No handler to dispatch"', { limit: 100 }).entries;
  assert.ok(gw.length >= 10 && gw.every((e) => e.level === 'error' && e.source === 'router-error'));
});

test('hosted gateway OpenSearch events: seven kinds, each JSON with its measured field names, a blocked model call still has a document', () => {
  const all = ask(fresh(), '{service="gateway-events"}', { limit: 500 }).entries;
  assert.ok(all.every((e) => e.product === 'pevents'));
  const docs = all.map((e) => JSON.parse(e.message));
  assert.deepEqual([...new Set(docs.map((d) => d.msg))].sort(), ['A2A policy denied', 'AIGuard', 'LLM request', 'MCP call', 'MCP caller', 'MCP policy denied', 'Received HTTP request']);
  const llm = docs.filter((d) => d.msg === 'LLM request');
  assert.ok(llm.some((d) => d.HTTPStatus === 400) && llm.some((d) => d.HTTPStatus === 403), 'refused and blocked calls are documented');
  for (const d of llm) for (const f of ['Model', 'Provider', 'PromptTokens', 'CompletionTokens', 'CostUSD', 'LatencyMs', 'HTTPStatus']) assert.ok(f in d, `LLM request has ${f}`);
  assert.ok(docs.filter((d) => d.msg === 'MCP caller').every((d) => !('level' in d)), 'MCP caller has no level field, as measured');
});

test('guardrail sidecar, banking MCP server, LLM proxy and authz server keep their measured shapes', () => {
  const pg = ask(fresh(), '{service="mcp-promptguard"}', { limit: 100 }).entries;
  assert.ok(pg.some((e) => /flagged INJECTION \(\d\.\d\d\)/.test(e.message)) && pg.some((e) => e.message === 'promptguard: 1 unit(s) -> allow'));
  const bank = ask(fresh(), '{service="mcp-server"} |= "trace_id"', { limit: 100 }).entries;
  assert.ok(bank.length >= 8 && bank.every((e) => e.source === 'record-context' && /^ {4}trace_id: "<trace-id>"$/.test(e.message)), 'the trace id is on an indented context line, not the header');
  const proxy = ask(fresh(), '{service="llm-proxy"}', { limit: 100 }).entries;
  assert.ok(proxy.every((e) => e.message.startsWith('[proxy] ')) && proxy.some((e) => e.message.includes('POST /v1/chat/completions')));
  const authz = ask(fresh(), '{service="authz-server"}', { limit: 100 }).entries;
  const json = authz.filter((e) => e.source === 'decision-json').map((e) => JSON.parse(e.message));
  assert.equal(json.length, authz.filter((e) => e.source === 'decision-text').length, 'every decision is printed twice');
  assert.ok(json.every((d) => d.evt === 'authz_decision' && d.decision === 'PERMIT' && 'reason' in d && 'policyVersion' in d));
  for (const e of [...pg, ...bank, ...proxy, ...authz]) assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(e.message), 'no real id in a seeded line');
});

test('weather MCP server (measured): one JSON object per line, start-up, a place lookup and a tool error with a stack, no real id', () => {
  const all = ask(fresh(), '{service="mcp-weather"}', { limit: 100 }).entries;
  assert.ok(all.length >= 8 && all.every((e) => e.product === 'mcpweather'));
  const docs = all.map((e) => ({ e, d: JSON.parse(e.message) }));
  assert.ok(docs.every(({ d }) => typeof d.timestamp === 'string' && ['INFO', 'ERROR'].includes(d.level) && typeof d.message === 'string'));
  const errors = docs.filter(({ d }) => d.level === 'ERROR');
  assert.ok(errors.length >= 2 && errors.every(({ d, e }) => d.message === 'Tool execution error' && 'message' in d.error && 'stack' in d.error && e.level === 'error' && e.source === 'tool-error'));
  assert.ok(docs.some(({ d }) => /^Geocoding successful via Nominatim: \d+ result\(s\)$/.test(d.message)));
  assert.ok(docs.some(({ d }) => d.message === 'Weather MCP Server started' && d.metadata.enabledTools === 6));
  for (const e of all) assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(e.message));
  assert.ok(all.some((e) => e.ts >= NOW - 10 * 60_000), 'fresh enough that the silence rule is quiet at baseline');
});
