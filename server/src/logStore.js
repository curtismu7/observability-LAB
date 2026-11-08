// The mock log store: a seeded, deterministic stream for the six sources, replayed relative to "now" so the
// last 30 minutes are always populated, plus incidents injected per workspace. Messages keep {{cast}} tokens until read.
// Pure: no I/O, no clock of its own (now is passed in).
import { PRODUCTS } from './logData.js';
import { fillDeep } from './cast.js';
import { matchesQuery } from './logql.js';

export const SERVICES = Object.fromEntries(PRODUCTS.map((p) => [p.id, p.service]));
const CONTAINER_BY_PRODUCT = Object.fromEntries(PRODUCTS.map((p) => [p.id, p.container]));
const PRODUCT_BY_SERVICE = Object.fromEntries(PRODUCTS.map((p) => [p.service, p.id]));
export const productOfService = (service) => PRODUCT_BY_SERVICE[service] || 'unknown';

const MIN = 60_000;
export const WINDOW_MS = 30 * MIN;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (rand, n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');

const SEED = 20261107;
const SIGNINS = 24;

// Baseline events as offsets (ms before now). Generated once at import; deterministic.
function buildBaseline() {
  const rand = mulberry32(SEED);
  const out = [];
  const push = (offsetMs, product, source, level, message, traceId = null) => out.push({ offsetMs, product, source, level, message, traceId });
  for (let n = 1; n <= SIGNINS; n++) {
    const offset = Math.floor((WINDOW_MS - MIN) * (1 - (n - 0.5) / SIGNINS)) + 20_000; // spread over the window, newest ~20 s old
    const trace = hex(rand, 32);
    const user = `user-${n}`;
    const dur = 20 + Math.floor(rand() * 60);
    if (rand() < 0.45) push(offset + 2000, 'pinggateway', 'route-log', 'info', `route=/mcp method=POST status=401 trace_id=${hex(rand, 32)} client_id={{castClientId}} dur_ms=4 www_authenticate=resource_metadata`);
    push(offset + 1000, 'pinggateway', 'route-log', 'info', `route=/mcp method=POST status=200 trace_id=${trace} client_id={{castClientId}} dur_ms=${dur}`, trace);
    push(offset + 500, 'pingfederate', 'audit.log', 'info', `AUTHN_ATTEMPT SUCCESS user=${user} adapter=pi.flow client_id={{castClientId}} trace_id=${trace}`, trace);
    push(offset, 'pingone', 'webhook', 'info', `{"event":"USER.ACCESS_ALLOWED","user":"${user}","client_id":"{{castClientId}}","trace_id":"${trace}"}`, trace);
  }
  // Two stray failures long ago: noise that must NOT trip the burst rule.
  push(22 * MIN, 'pingfederate', 'audit.log', 'warn', `AUTHN_ATTEMPT FAILURE user=user-3 adapter=pi.flow client_id={{castClientId}} reason=bad_credentials`);
  push(17 * MIN, 'pingfederate', 'audit.log', 'warn', `AUTHN_ATTEMPT FAILURE user=user-9 adapter=pi.flow client_id={{castClientId}} reason=bad_credentials`);
  // Background chatter: gateway health on a different route, PF server heartbeat.
  for (let i = 0; i < 30; i++) push(i * MIN + 5000, 'pinggateway', 'route-log', 'debug', `route=/health method=GET status=200 dur_ms=1`);
  for (let i = 0; i < 15; i++) push(i * 2 * MIN + 12_000, 'pingfederate', 'server.log', 'info', `INFO  Connection pool to the directory is healthy (active=3, idle=7)`);
  // Privilege node sensor and MCP gateway: steady background lines (shapes measured on a running AI-DEMO2 stack), no shared id.
  for (let i = 0; i < 10; i++) push(i * 3 * MIN + 8000, 'privilege', 'sensor-report', 'info', `level=INFO msg="nodesensor: reported findings" sent=1 accepted=1`);
  for (let i = 0; i < 8; i++) push(i * 4 * MIN + 3000, 'privilege', 'exec-events', 'info', `exec    pid=${4200 + i * 17}  python           host`);
  // The two rejection messages are written together by ONE request (measured 2026-11-08: the invalid-token line follows the
  // missing-header line within a millisecond in 22,022 of 22,192 cases), so the baseline writes them as a pair, not as two streams.
  for (let i = 0; i < 12; i++) {
    push(i * 90_000 + 21_000, 'pgateway', 'auth-missing', 'info', `level=info msg="authorization header missing"`);
    push(i * 90_000 + 20_999, 'pgateway', 'auth-invalid', 'info', `level=info msg="Invalid Authorization token"`);
  }
  // Request received: four lines per request, the only lines that name the client (User-Agent, Remote Addr). 192.0.2.x is a documentation address.
  for (let i = 0; i < 15; i++) {
    const at = i * 2 * MIN + 9000;
    push(at + 3, 'pgateway', 'server-request', 'info', `level=info msg="\\n[SERVER]  Incoming request: GET /"`);
    push(at + 2, 'pgateway', 'server-request', 'info', `level=info msg="[SERVER]  User-Agent: Go-http-client/1.1"`);
    push(at + 1, 'pgateway', 'server-request', 'info', `level=info msg="[SERVER]  Remote Addr: 192.0.2.1:${40000 + i}"`);
    push(at, 'pgateway', 'server-request', 'info', `level=info msg="[SERVER]  Content-Type: "`);
  }
  for (let i = 0; i < 2; i++) push(i * 9 * MIN + 47_000, 'pgateway', 'mesh-error', 'error', `level=error msg="Error receiving from the stream: rpc error: code = Unavailable"`);
  for (let i = 0; i < 15; i++) push(i * 2 * MIN + 15_000, 'mcp', 'gw-lines', 'info', `[GW] authz warm: ok ${20 + ((i * 7) % 25)}ms (http://authz.example:9001)`);
  return out.sort((a, b) => b.offsetMs - a.offsetMs).map((e, i) => ({ ...e, id: `base-${String(i).padStart(4, '0')}` }));
}
const BASELINE = buildBaseline();

// Incidents append events with absolute timestamps. Deterministic ids from the workspace counter.
export const INCIDENTS = ['login-burst', 'gateway-5xx'];
export function incidentEvents(name, now, seq) {
  const rand = mulberry32(SEED + seq * 7919);
  const ev = [];
  const at = (i, count) => now - 110_000 + Math.floor((i * 100_000) / count); // spread over the last ~2 minutes
  if (name === 'login-burst') {
    for (let i = 0; i < 8; i++) ev.push({ ts: at(i, 8), product: 'pingfederate', source: 'audit.log', level: 'warn', message: `AUTHN_ATTEMPT FAILURE user=user-x adapter=pi.flow client_id={{castClientId}} reason=bad_credentials`, traceId: null });
    for (let i = 0; i < 2; i++) ev.push({ ts: at(i * 4 + 1, 8), product: 'pingone', source: 'webhook', level: 'warn', message: `{"event":"USER.ACCESS_DENIED","user":"user-x","client_id":"{{castClientId}}"}`, traceId: null });
  } else if (name === 'gateway-5xx') {
    for (let i = 0; i < 14; i++) ev.push({ ts: at(i, 16), product: 'pinggateway', source: 'route-log', level: 'error', message: `route=/mcp method=POST status=${[502, 503, 504][i % 3]} trace_id=${hex(rand, 32)} client_id={{castClientId}} dur_ms=${900 + Math.floor(rand() * 400)} upstream=timeout`, traceId: null });
    for (let i = 0; i < 2; i++) ev.push({ ts: at(i * 8 + 4, 16), product: 'pinggateway', source: 'route-log', level: 'info', message: `route=/mcp method=POST status=200 trace_id=${hex(rand, 32)} client_id={{castClientId}} dur_ms=60`, traceId: null });
  }
  return ev.map((e, i) => ({ ...e, id: `inc${seq}-${String(i).padStart(3, '0')}` }));
}

// The service label the collector attaches. relabel on = the bare name; off = Docker's raw name, slash and all.
export const serviceLabel = (product, relabel) => (relabel ? SERVICES[product] : CONTAINER_BY_PRODUCT[product]);

// All events visible now, labelled and filled. state = { injected: [...], relabel: boolean }.
export function snapshot({ now, cast, state }) {
  const all = [
    ...BASELINE.map((e) => ({ ...e, ts: now - e.offsetMs })),
    ...state.injected,
  ];
  return all.map((e) => {
    const service = serviceLabel(e.product, state.relabel);
    return fillDeep({
      id: e.id, ts: e.ts, product: e.product, source: e.source, level: e.level, message: e.message, traceId: e.traceId,
      service, labels: { service, source: e.source, level: e.level },
    }, cast);
  });
}

// Newest first, bounded. q = parsed query; sinceMs limits to a window (absolute epoch ms) when given.
export function queryMock({ now, cast, state, q, since = null, limit = 200 }) {
  const rows = snapshot({ now, cast, state }).filter((e) => (since == null || e.ts >= since) && e.ts <= now && matchesQuery(q, e));
  rows.sort((a, b) => b.ts - a.ts || (a.id < b.id ? -1 : 1));
  return { entries: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit };
}

export const toIso = (e) => ({ ...e, ts: new Date(e.ts).toISOString() });
