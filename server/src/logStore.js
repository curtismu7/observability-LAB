// The mock log store: a seeded, deterministic stream for the fifteen sources, replayed relative to "now" so the
// last 30 minutes are always populated, plus incidents injected per workspace. Messages keep {{cast}} tokens until read.
// Pure: no I/O, no clock of its own (now is passed in).
import { SIEM_SOURCES, PRODUCTS } from './logData.js';
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
  // The hosted gateway: ten agent-to-agent requests, two of them refused. Per request, in the order the gateway writes them: who,
  // which app, a few policy checks, then either the proxy line (allowed: there is no allow line) or the denial. Measured 2026-11-08.
  for (let i = 0; i < 10; i++) {
    const at = i * 150_000 + 11_000;
    const denied = i === 2 || i === 7;
    push(at + 9, 'phosted', 'caller-token', 'info', `level=info msg="Access token found for user: <user-id>, client: main-agent"`);
    push(at + 8, 'phosted', 'resolved-host', 'info', `level=info msg="[mcpgw] resolved host for app worker-agent: <app-host>:8643"`);
    for (let k = 0; k < 5; k++) push(at + 7 - k, 'phosted', 'policy-eval', 'info', `level=info msg="Success: principal {RefKind:User RefID:<b64>} is in list {RefKind:Policy RefID:<b64>}"`);
    if (denied) push(at, 'phosted', 'policy-denied', 'info', `level=info msg="[mcpgw] policy denied <user-id> access to a2a app worker-agent (agent=true): principal {RefKind:User RefID:<b64>} does not have access to {RefKind:Application RefID:<b64>} object for HTTP action and  principal"`);
    else push(at, 'phosted', 'proxying', 'info', `level=info msg="Proxying to: http://<backend>.svc.cluster.local"`);
  }
  for (let i = 0; i < 2; i++) push(i * 8 * MIN + 95_000, 'phosted', 'aiguard-blocked', 'warn', `level=warning msg="aiguard: blocked mcp response client=<client> category=malicious_content"`);
  // Real PingFederate and Ping Gateway lines (measured 2026-11-08): PF prints its server.log to stdout with the file path in front and
  // about half of it DEBUG; the gateway repeats one router ERROR for a request that matches no route.
  for (let i = 0; i < 20; i++) push(i * 80_000 + 6000, 'pingfederate', 'server-stdout', 'debug', `/opt/out/instance/log/server.log:  DEBUG [org.sourceid.util.log.internal.TrackingIdSupport] The incoming request does not contain a unique identifier. Assigning auto-generated tracking id`);
  for (let i = 0; i < 6; i++) push(i * 5 * MIN + 40_000, 'pingfederate', 'server-stdout', 'info', `/opt/out/instance/log/server.log:  INFO  [com.pingidentity.crypto.jwk.impl.JwkStateRpcImpl] Added new key to JSON Web Key Set`);
  for (let i = 0; i < 12; i++) push(i * 150_000 + 30_000, 'pinggateway', 'router-error', 'error', `[vert.x-eventloop-thread-${1 + (i % 8)}] ERROR o.f.o.handler.router.RouterHandler @default - No handler to dispatch to for request 'https://<host>:<port>/get_model_info'`);
  // Audit lines now on stdout (measured 2026-11-08 after AI-DEMO2 PR #3437).
  for (let i = 0; i < 4; i++) {
    const tid = hex(rand, 27);
    push(i * 7 * MIN + 20_000, 'pingfederate', 'audit-stdout', 'info', `/opt/out/instance/log/audit.log:  | tid:${tid}| ${hex(rand, 25)}| OAuth| | <ip> | | <client id>| OAuth20| <host id>| AS| inprogress| | | 479`);
    push(i * 7 * MIN + 20_020, 'pingfederate', 'audit-stdout', 'warn', `/opt/out/instance/log/audit.log:  | tid:${tid}| ${hex(rand, 25)}| OAuth| | <ip> | | <client id>| OAuth20| <host id>| AS| failure| | Invalid Client| 501`);
  }
  for (let i = 0; i < 3; i++) push(i * 9 * MIN + 33_000, 'pingfederate', 'admin-api-stdout', 'warn', `/opt/out/instance/log/admin-api.log:  | administrator| Basic| <ip>| unknown| GET| /version| 401`);
  for (let i = 0; i < 8; i++) push(i * 4 * MIN + 14_000, 'pinggateway', 'access-audit', i % 2 ? 'warn' : 'info', JSON.stringify({ eventName: 'OPENIG-HTTP-ACCESS', client: { ip: '<ip>' }, http: { request: { method: 'POST', path: 'https://<host>:<port>/mcp' } }, response: { status: i % 2 ? 'FAILED' : 'SUCCESSFUL', statusCode: i % 2 ? '401' : '200', elapsedTime: 7 + i }, ig: { routeId: '01-mcp-olb', routeName: 'mcp-olb-primary' }, topic: 'access' }));
  // One measured human-approval run (2026-11-08): gateway authorize lines, then the HITL service receipt check.
  for (let i = 0; i < 3; i++) {
    const at = i * 11 * MIN + 41_000;
    const ch = `${hex(rand, 8)}-${hex(rand, 4)}-${hex(rand, 4)}-${hex(rand, 4)}-${hex(rand, 12)}`;
    push(at, 'pinggateway', 'p1az-decision', 'info', `[vert.x-eventloop-thread-3] INFO  o.f.o.f.S.P1AZDecision @00-mcp-olb-jwks - [P1AZ] DECISION: PERMIT | backend=real | sub=<user id> | tool=pay_tuition_balance | method=tools/call | vertical=university | obligation=hitl`);
    push(at + 5, 'pinggateway', 'p1az-decision', 'warn', `[vert.x-eventloop-thread-3] INFO  o.f.o.f.S.P1AZDecision @00-mcp-olb-jwks - [P1AZ] INDETERMINATE - HITL challenge ${ch} minted for tool=pay_tuition_balance`);
    push(at + 5000, 'pinggateway', 'p1az-decision', 'info', `[vert.x-eventloop-thread-3] INFO  o.f.o.f.S.P1AZDecision @00-mcp-olb-jwks - [P1AZ] DECISION: PERMIT | backend=real | sub=<user id> | tool=pay_tuition_balance | method=tools/call | vertical=university | obligation=hitl`);
    push(at + 5100, 'hitl', 'receipt-verification', 'info', JSON.stringify({ level: 30, service: 'hitl-service', trace_id: hex(rand, 32), challengeId: ch, tool: 'pay_tuition_balance', ok: true, reason: null, correlation_id: '<correlation id>', msg: 'hitl receipt verification' }));
  }
  // The hosted gateway's OpenSearch documents (field names measured 2026-11-08; the time field is left out, the store keeps the timestamp).
  const doc = (fields) => JSON.stringify(fields);
  for (let i = 0; i < 10; i++) {
    const at = i * 150_000 + 11_000;
    push(at + 20, 'pevents', 'http-request', 'info', doc({ msg: 'Received HTTP request', level: 'info', Method: 'POST', Path: '/a2a/jsonrpc', Host: '<host>', Domain: '<domain>', Device: '<device>', Tenant: '<tenant-id>', User: '<user-id>' }));
    if (i === 2 || i === 7) push(at - 1, 'pevents', 'a2a-denied', 'info', doc({ msg: 'A2A policy denied', App: 'worker-agent', Principal: '<principal>', Reason: '<reason>' }));
  }
  const llm = [[200, 'claude-haiku-4-5-20251001', 1929, 22, 8], [200, 'claude-haiku-4-5-20251001', 1410, 31, 12], [403, 'claude-opus-5', 85, 0, 0], [400, 'claude-haiku-4-5-20251001', 190, 0, 0]];
  for (let i = 0; i < 8; i++) {
    const [status, model, ms, pt, ct] = llm[i % 4];
    const at = i * 3 * MIN + 25_000;
    push(at, 'pevents', 'llm-request', 'info', doc({ msg: 'LLM request', HTTPStatus: status, Model: model, Provider: 'anthropic', KeyType: 'api_key', PrincipalKind: 'User', LatencyMs: ms, PromptTokens: pt, CompletionTokens: ct, CostUSD: status === 200 ? 0.0001 : 0, UpstreamStatus: status === 200 ? 200 : 0, LLMRule: '', Tenant: '<tenant-id>', User: '<user-id>', RequestID: '<request-id>' }));
    if (status === 400) push(at + 5, 'pevents', 'aiguard', 'warn', doc({ msg: 'AIGuard', level: 'warning', Category: 'prompt_injection', Client: '<client>', KeyType: 'api_key', PrincipalKind: 'User', Tenant: '<tenant-id>', User: '<user-id>', RequestID: '<request-id>', TraceID: '<trace-id>', SpanID: '<span-id>', TopScore: 0.99, Direction: '<direction>', Event: '<event>', Findings: [] }));
  }
  for (let i = 0; i < 6; i++) {
    push(i * 4 * MIN + 50_000, 'pevents', 'mcp-caller', 'info', doc({ msg: 'MCP caller', Client: '<client>', User: '<user-id>' }));
    push(i * 4 * MIN + 49_990, 'pevents', 'mcp-call', 'info', doc({ msg: 'MCP call', Method: 'tools', Tool: 'get_weather' }));
  }
  push(14 * MIN + 20_000, 'pevents', 'mcp-denied', 'info', doc({ msg: 'MCP policy denied', Agent: '<agent>', App: 'hostile-mcp', Decision: 'deny', Principal: '<principal>' }));
  // The guardrail sidecar: one verdict line per text unit; flagged lines carry the score.
  const scores = ['0.99', '0.98', '1.00'];
  for (let i = 0; i < 12; i++) push(i * 100_000 + 14_000, 'pguard', i % 4 === 3 ? 'verdict-flagged' : 'verdict-allow', 'info', i % 4 === 3 ? `promptguard: 1 unit(s) -> Prompt-Guard flagged INJECTION (${scores[(i >> 2) % 3]})` : 'promptguard: 1 unit(s) -> allow');
  for (let i = 0; i < 2; i++) push(i * 9 * MIN + 60_000, 'pguard', 'broken-pipe', 'unknown', 'BrokenPipeError: [Errno 32] Broken pipe');
  // The banking MCP server: a header line, then the indented context lines that carry the trace id (newest line has the smallest offset).
  const steps = ['[TEACH] step 3/3: local JWT decode result', 'token audience validated', '[TEACH] step 3/3: introspection result evaluated'];
  for (let i = 0; i < 8; i++) {
    const at = i * 3.5 * MIN + 20_000;
    push(at, 'mcpbank', 'record-header', 'info', `[<time>] INFO: ${steps[i % 3]}`);
    ['    service: "mcp-server"', '    trace_id: "<trace-id>"', '    span_id: "<span-id>"', '    trace_flags: "01"', '    resource_uri: "<resource-uri>"'].forEach((l, k) => push(at - 1 - k, 'mcpbank', 'record-context', 'info', l));
  }
  // The LLM proxy: mostly discovery and health requests, a few chat completions.
  const routes = ['GET / → llama-3.2-3b-instruct (class 0 via classified-raw) | load=10', 'GET /v1/models → llama-3.2-3b-instruct (class 0 via classified-raw) | load=10', 'GET /info → llama-3.2-3b-instruct (class 0 via classified-raw) | load=12', 'POST /v1/chat/completions → llama-3.2-3b-instruct (class 0 via model=phi-4-mini-instruct) | load=10'];
  for (let i = 0; i < 24; i++) push(i * 70_000 + 9000, 'llmproxy', 'route', 'info', `[proxy] ${routes[i % 4]}`);
  // The authz server: each decision twice, readable then JSON (only permit decisions were observed).
  for (let i = 0; i < 16; i++) {
    const at = i * 110_000 + 17_000;
    push(at, 'authz', 'decision-text', 'info', '[cid=<correlation-id>] [AuthzServer/decision] policy=mcp-gateway ctx=McpToolsList tool=(none) sub=<user-id> actor=(none) aud=<audience> exp=(none) scopes=[gateway:mcp:invoke] hitlApproved=false');
    push(at - 1, 'authz', 'decision-json', 'info', doc({ evt: 'authz_decision', decision: 'PERMIT', reason: 'tool discovery permitted (per-tool)', correlationId: '<correlation-id>', decisionContext: 'McpToolsList', tool: null, sub: '<user-id>', actor: null, workerId: 'mcp-gateway', scopes: ['gateway:mcp:invoke'], rarPresent: false, hitlApproved: false, decisionId: '<decision-id>', policyVersion: 'mock-v1' }));
  }
  // The Privilege SIEM (Elasticsearch): the document shapes measured on 2026-11-08 (relayed by the privilege-logging-LAB session), values
  // replaced by placeholders except enum-like fields. Console changes are rare, runtime events steady. A deny or a hold is shown as warn.
  const sObj = () => ({ WrOwners: { ObjectRef: null }, Tenant: '<tenant>', Labels: {}, CTags: {}, id: '<id>', RdOwners: { ObjectRef: null }, Namespace: '<namespace>', Name: '<name>' });
  for (let i = 0; i < 4; i++) push(i * 7 * MIN + 90_000, 'psiem', 'audit-log', 'info', doc({ Status: '<status>', '@timestamp': '<time>', User: sObj(), Message: '<message>', Device: sObj(), Region: '<region>', Index: 'audit-log', DataText: '<datatext>', Resources: null, Module: 'apigw', privilege_event_kind: 'console' }));
  for (let i = 0; i < 6; i++) push(i * 4 * MIN + 35_000, 'psiem', 'proxy-audit-log', 'info', doc({ '@timestamp': '<time>', Message: 'Received HTTP request', Region: '<region>', Data: { Path: '<path>', Tenant: '<tenant>', User: '<user>', Device: '<device>', Headers: { 'X-Vendor-Mcp-Cap': ['<x-vendor-mcp-cap>'], Accept: ['<accept>'], 'X-Request-Id': ['<x-request-id>'], 'X-Forwarded-Host': ['<x-forwarded-host>'], Traceparent: ['<traceparent>'], 'Mcp-Protocol-Version': ['<mcp-protocol-version>'], 'Content-Type': ['<content-type>'] }, Host: '<host>', Method: 'POST' }, Index: 'proxy-audit-log', Level: 'INFO', privilege_event_kind: 'runtime' }));
  const decisions = [['allow', 'policy_decision'], ['allow', 'policy_decision'], ['deny', 'policy_decision'], ['allow', 'policy_decision'], ['hitl', 'policy_approval_required'], ['allow', 'policy_approval_released'], ['allow', 'policy_decision'], ['deny', 'policy_decision'], ['hitl', 'policy_approval_required'], ['allow', 'policy_decision']];
  decisions.forEach(([decision, event], i) => {
    const data = { App: '<app>', User: '<user>', RequestID: '<requestid>', SchemaVersion: 1, InstructionID: '<instructionid>', PrincipalResolved: true, Method: 'tools/call', Decision: decision, GrantShape: 'capability', Reason: '<reason>', Flow: 'mcp', BaselinePhase: 'learning' };
    if (i % 4 !== 1) data.AgentKey = i % 4 === 3 ? '' : '<agentkey>'; // missing or empty on about half, as measured (19 of 37)
    Object.assign(data, { Target: '<target>', PrincipalKind: i % 4 === 2 ? 'NonHumanIdentity' : 'User', Tenant: '<tenant>', PolicyIDs: ['<policyids>'], Event: event, Stage: 'pre_guard', Principal: '<principal>' });
    push(i * 2.5 * MIN + 12_000, 'psiem', 'policy-decision-log', decision === 'allow' ? 'info' : 'warn', doc({ privilege_bridge: true, '@timestamp': '<time>', Message: 'AIPolicyDecision', Region: '<region>', Data: data, Level: 'INFO', Index: 'policy-decision-log', privilege_event_kind: 'runtime' }));
  });
  for (let i = 0; i < 3; i++) push(i * 9 * MIN + 70_000, 'psiem', 'aiguard-log', 'warn', doc({ privilege_bridge: true, '@timestamp': '<time>', Message: 'AIGuard', Region: '<region>', Data: { Findings: [{ Score: 0, Category: 'malicious_content', Detector: '<detector>', Recommended: '<recommended>', Severity: '<severity>' }], Category: 'malicious_content', User: '<user>', KeyType: '<keytype>', RequestID: '<requestid>', TopScore: 0, ComplianceMappings: [{ MappingType: '<mappingtype>', Identifier: '<identifier>', CatalogVersion: '<catalogversion>', Framework: '<framework>', Source: '<source>' }], NISTAIRMFIDs: ['<nistairmfids>'], Direction: i % 2 ? 'request' : 'response', MITREATLASIDs: ['<mitreatlasids>'], ElapsedMs: 0, PrincipalKind: 'User', Tenant: '<tenant>', ComplianceCatalogSecurityVersion: '<compliancecatalogsecurityversion>', Event: i % 2 ? 'llm_request_alert' : 'mcp_response_blocked', TraceID: '<traceid>', Client: '<client>', ASIIDs: ['<asiids>'], OWASPIDs: ['<owaspids>'], SpanID: '<spanid>' }, Level: 'WARNING', Index: 'aiguard-log', privilege_event_kind: 'runtime' }));
  // agent-approval-log: listed but its shape was not measured, so the sample stays a guess.
  for (let i = 0; i < 2; i++) push(i * 12 * MIN + 100_000, 'psiem', 'agent-approval-log', 'info', doc({ Index: 'agent-approval-log', privilege_event_kind: 'runtime', '@timestamp': '<time>', Data: { Agent: '<agent>', Decision: '<decision>' } }));
  // The weather MCP server: one JSON object per line. Start-up, a place lookup now and then, an occasional tool error (measured 2026-11-08).
  push(21 * MIN, 'mcpweather', 'startup', 'info', doc({ timestamp: '<time>', level: 'INFO', message: 'Weather MCP Server started', metadata: { version: '1.13.0', cacheEnabled: true, logLevel: 'INFO', enabledTools: 6 } }));
  push(21 * MIN - 1, 'mcpweather', 'startup', 'info', doc({ timestamp: '<time>', level: 'INFO', message: 'Analytics disabled by user preference' }));
  for (let i = 0; i < 6; i++) push(i * 4 * MIN + 55_000, 'mcpweather', 'geocoding', 'info', doc({ timestamp: '<time>', level: 'INFO', message: `Geocoding successful via Nominatim: ${1 + (i % 5)} result(s)` }));
  for (let i = 0; i < 2; i++) push(i * 11 * MIN + 150_000, 'mcpweather', 'tool-error', 'error', doc({ timestamp: '<time>', level: 'ERROR', message: 'Tool execution error', error: { message: 'Saved location "<place>" not found.', stack: '<stack trace>' } }));
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
      service, labels: { service, source: e.source, level: e.level, ...(e.product === 'psiem' && SIEM_SOURCES[e.source] ? { kind: SIEM_SOURCES[e.source].kind, index: e.source } : {}) },
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
