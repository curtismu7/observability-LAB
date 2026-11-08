// Story data for the Observability Lab: the products, their log sources, the scenarios and the talk track.
// Text uses {{cast}} tokens (rule 10); a test fails on any token the cast does not define.
// Every product claim carries a status: measured (read from the AI-DEMO2 monitoring stack's own config, with the file named),
// inferred, or UNVERIFIED (illustrative shape, not checked against product documentation). Nothing here is a vendor claim.

export const TITLE = 'Observability Lab';
export const INTRO = 'Ping products log in different ways. This lab follows a log line from the product to a searchable, alertable store, and shows what goes wrong when one small rule is missing.';
export const BANNER = 'SIMULATED: seeded, synthetic log events for six Ping sources, a mock log store and mock alert rules. Nothing here reads a real product log or calls a real tenant. In Real mode only, it reads one loopback Loki that you configured.';
export const REAL_BANNER = 'REAL (read-only): log lines are read from the loopback Loki you configured; products, alert thresholds and the label lab still follow this lab\'s rules. Nothing is written to Loki.';

// The collector's relabel rule, modelled on the AI-DEMO2 collector config (config.docker.alloy), with this lab's own prefix: strips Docker's leading "/" and the stack prefix.
export const RELABEL_RULE = 'source_labels = ["__meta_docker_container_name"]  regex = "/(?:obs-demo-)?(.*)"  target_label = "service"';

// Raw container names (what Docker reports, with the leading slash) and the service each becomes after relabel.
export const PRODUCTS = [
  {
    id: 'pingone', name: 'PingOne', service: 'pingone-webhook', container: '/obs-demo-pingone-webhook',
    how: 'SaaS: there is no container to tail. Events reach the store only because a forwarder receives PingOne webhooks and pushes them.',
    sources: [
      { id: 'webhook', title: 'Webhook events', where: 'Pushed by a forwarder (the "Tier 1" path in the AI-DEMO2 stack).', status: 'measured', sample: '{"event":"USER.ACCESS_ALLOWED","user":"user-7","client_id":"{{castClientId}}","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736"}', note: 'Measured: before a container collector existed, webhook events and app events were the only things in the store (AI-DEMO2 monitoring/alloy/config.docker.alloy). The event names and field names here are illustrative and UNVERIFIED against PingOne documentation.' },
      { id: 'audit-activities', title: 'Audit activities API', where: 'Pulled from the PingOne audit activities API, not a file.', status: 'UNVERIFIED', sample: '(not generated in this build)', note: 'Retention of about 7 days was observed in one demo environment and is UNVERIFIED. This build does not generate it.' },
    ],
  },
  {
    id: 'pingfederate', name: 'PingFederate', service: 'pingfederate', container: '/obs-demo-pingfederate',
    how: 'A container that writes its log files and prints to stdout; the collector reads the stdout stream.',
    sources: [
      { id: 'audit.log', title: 'Audit log', where: 'Authentication and token events.', status: 'UNVERIFIED', sample: 'AUTHN_ATTEMPT SUCCESS user=user-7 adapter=pi.flow client_id={{castClientId}} trace_id=4bf92f3577b34da6a3ce929d0e0e4736', note: 'Illustrative shape. The real field order and names depend on the PingFederate version and log4j configuration: UNVERIFIED. The trace id is injected by this demo stack; PingFederate does not add one on its own.' },
      { id: 'server.log', title: 'Server log', where: 'Runtime messages, warnings and errors.', status: 'UNVERIFIED', sample: 'INFO  Connection pool to the directory is healthy (active=3, idle=7)', note: 'Illustrative.' },
    ],
  },
  {
    id: 'pinggateway', name: 'Ping Gateway', service: 'ping-gateway', container: '/obs-demo-ping-gateway',
    how: 'A container with two feeds: a request log line per call, and a /metrics endpoint scraped for counters.',
    sources: [
      { id: 'route-log', title: 'Route request log', where: 'One line per request on the MCP route.', status: 'UNVERIFIED', sample: 'route=/mcp method=POST status=200 trace_id=4bf92f3577b34da6a3ce929d0e0e4736 client_id={{castClientId}} dur_ms=42', note: 'Illustrative line shape: UNVERIFIED.' },
      { id: 'metrics', title: 'Prometheus metrics', where: 'GET /metrics on the admin connector.', status: 'measured', sample: 'ig_route_response_status_total{route="<route>",family="client_error"} <count>', note: 'Measured: the metric name ig_route_response_status_total counts every response the gateway sent, including rejections other counters miss (AI-DEMO2 monitoring/alerts.yml). The label values and the count in the sample are placeholders. The rules in this lab use the log feed; the metric is shown for contrast.' },
    ],
  },
  {
    id: 'privilege', name: 'PingOne Privilege (node sensor)', service: 'procyon-nodesensor', container: '/obs-demo-procyon-nodesensor',
    how: 'A container that watches the host and reports what it finds. It prints structured key=value lines and plain process events to stdout.',
    sources: [
      { id: 'sensor-report', title: 'Sensor reports', where: 'Structured key=value lines on stdout.', status: 'measured', sample: 'level=INFO msg="nodesensor: reported findings" sent=1 accepted=1', note: 'Shape measured on 2026-11-07 from a running AI-DEMO2 stack. The real line starts with time=...; it is left out here because the store keeps the timestamp.' },
      { id: 'exec-events', title: 'Process exec events', where: 'One plain line per observed process start.', status: 'measured', sample: 'exec    pid=4242  python           host', note: 'Shape measured on 2026-11-07 from a running AI-DEMO2 stack; the pid and process here are made up.' },
    ],
  },
  {
    id: 'mcp', name: 'MCP gateway', service: 'mcp-gateway', container: '/obs-demo-mcp-gateway',
    how: 'A container that prints free-text lines prefixed [GW] to stdout. The other MCP servers in AI-DEMO2 (mcp-server, mcp-weather, mcp-brave and so on) get a service label the same way but print other shapes: mcp-server prints tracing span fields.',
    sources: [
      { id: 'gw-lines', title: 'Gateway stdout', where: 'Free text prefixed [GW].', status: 'measured', sample: '[GW] authz warm: ok 29ms (http://authz.example:9001)', note: 'Shape measured on 2026-11-07 from a running AI-DEMO2 stack; the real host is replaced with a .example name.' },
    ],
  },
  {
    id: 'pgateway', name: 'PingOne Privilege (agent gateway)', service: 'ping-mcpgw', container: '/obs-demo-ping-mcpgw',
    how: 'The gateway that fronts MCP servers. It prints key=value lines (time, level, msg, and for some lines func and file). In AI-DEMO2 it writes them to a FILE inside the container, not to stdout, so a collector that reads container stdout sees nothing from it.',
    sources: [
      { id: 'auth-missing', title: 'Request with no token', where: 'One line for a request that arrived without an Authorization header. The invalid-token line below follows it within a millisecond.', status: 'measured', sample: 'level=info msg="authorization header missing"', note: 'Shape measured on 2026-11-07 by starting the gateway from AI-DEMO2 docker-compose.yml (profile mcpgw). The real line also starts with time=...; it is left out here because the store keeps the timestamp. A rejected request is logged at level info, not error. Measured on 2026-11-08: the line carries no client address, and an unauthenticated request to an MCP app path (a 401) wrote no line at all.' },
      { id: 'auth-invalid', title: 'Invalid token (follows the line above)', where: 'Written together with the missing-header line by the same request: in the real file 22,022 of 22,192 invalid-token lines directly follow a missing-header line.', status: 'measured', sample: 'level=info msg="Invalid Authorization token"', note: 'Shape measured on 2026-11-07 from the same AI-DEMO2 docker-compose.yml run; the pairing was measured on 2026-11-08 from the same file. Also level info. The 170 lines that do not follow a missing-header line were not examined.' },
      { id: 'server-request', title: 'Request received (four lines)', where: 'For a request to the gateway root: Incoming request, User-Agent, Remote Addr and Content-Type, written back to back. The only gateway lines that name the client.', status: 'measured', sample: 'level=info msg="[SERVER]  User-Agent: Go-http-client/1.1"', note: 'Measured on 2026-11-08 from the AI-DEMO2 docker-compose.yml gateway: a GET and a POST to the root each wrote these four lines. The address shown here is a documentation address; the real one is the Docker network gateway, because requests arrive through the published port. Requests to an MCP app path wrote none of them.' },
      { id: 'mesh-error', title: 'Control-plane stream error', where: 'The gateway lost its stream to the Privilege control plane.', status: 'measured', sample: 'level=error msg="Error receiving from the stream: rpc error: code = Unavailable"', note: 'Shape measured on 2026-11-07 from the same AI-DEMO2 docker-compose.yml run; the text after code = Unavailable is cut here and no tenant or node ids are shown.' },
    ],
  },
];

// The alert rules. The ratio-plus-traffic-floor idea comes from AI-DEMO2 monitoring/alerts.yml (whose door rule is a 4xx ratio and which also
// has a no-ratio any-5xx rule); the 5xx ratio, windows and thresholds here are this lab's own design.
export const ALERT_RULES = [
  { id: 'FailedLoginBurst', title: 'Failed sign-in burst', lesson: 'Counts failures in the last 5 minutes; fires at 5 or more.' },
  { id: 'GatewayMostlyRejecting', title: 'Gateway mostly failing', lesson: 'This lab\'s own rule: fires when 5xx responses are half or more of the traffic AND there are at least 10 requests in 5 minutes. A 401 is not counted: it is how a healthy client starts.' },
  { id: 'ProductLogSilence', title: 'A product went quiet', lesson: 'Fires when a product\'s service has no lines in 10 minutes. This is the only rule that notices a broken relabel.' },
];

export const SCENARIOS = [
  { id: 'follow-a-signin', title: 'Follow one sign-in across three products', query: '{service=~"pingone-webhook|pingfederate|ping-gateway"} |= "{{castClientId}}"', action: null, expect: { minProducts: 3 },
    lesson: 'One shared id is the whole join. Search the client id and a single sign-in appears in PingOne, PingFederate and the gateway, in time order. Without a shared id you can only line up clocks.' },
  { id: 'login-burst', title: 'A burst of failed sign-ins', query: '{service="pingfederate"} |= "FAILURE"', action: { kind: 'incident', name: 'login-burst' }, expect: { alertFiring: 'FailedLoginBurst' },
    lesson: 'Two stray failures an hour are noise. Eight in two minutes from one user is the rule firing. The rule counts lines, so the count is only as good as the filter.' },
  { id: 'the-401-is-normal', title: 'The 401s that are not an outage', query: '{service="ping-gateway"} |= "status=401"', action: null, expect: { alertQuiet: 'GatewayMostlyRejecting' },
    lesson: 'Measured in AI-DEMO2: a spec-following MCP client starts every session with a 401 to discover the authorization server, so rejections run near 1:1 with successes while everything works. A rule on "any 401" would fire forever and be muted within a day.' },
  { id: 'gateway-failing', title: 'The gateway really is failing', query: '{service="ping-gateway"} |~ "status=502|status=503"', action: { kind: 'incident', name: 'gateway-5xx' }, expect: { alertFiring: 'GatewayMostlyRejecting' },
    lesson: 'Now 5xx responses are most of the traffic and there is enough traffic to trust the ratio. The traffic floor is what stops one failed probe on an idle route from paging someone.' },
  { id: 'everything-went-quiet', title: 'Everything went quiet', query: '{service=~"pingone-webhook|pingfederate|ping-gateway"}', action: { kind: 'relabel', enabled: false }, expect: { alertFiring: 'ProductLogSilence', minProducts: 0 },
    lesson: 'Turn the relabel rule off and the container names reach the store with a slash and a prefix, so every query by service name returns nothing, with no error. Measured in AI-DEMO2 (config.docker.alloy): leaving the stack prefix on made every container-log panel silently empty. The leading slash is this lab\'s own extension of that lesson.' },
  { id: 'more-products', title: 'Privilege sensor, MCP gateway and agent gateway, same label scheme', query: '{service=~"procyon-nodesensor|mcp-gateway|ping-mcpgw"}', action: null, expect: { minProducts: 3 },
    lesson: 'Two more sources reach the store the same way: the collector turns a container name into a service label. These two shapes were measured from a running AI-DEMO2 stack; they carry no shared id, so unlike the three-product sign-in they cannot be joined, only searched.' },
];

export const FACTS = [
  { id: 'tier1-only', status: 'measured', text: 'Before a container collector existed, only BFF app events and PingOne webhook events were in the store; a service that only printed to stdout was invisible. Source: AI-DEMO2 monitoring/alloy/config.docker.alloy (its Tier 1 / Tier 2 comment).' },
  { id: 'relabel-prefix', status: 'measured', text: 'Leaving the container-name prefix on made every container-log panel silently empty in Docker. Source: AI-DEMO2 monitoring/alloy/config.docker.alloy.' },
  { id: 'ratio-rules', status: 'measured', text: 'In AI-DEMO2 monitoring/alerts.yml the rule on the external MCP door\'s rejected (4xx) responses is a ratio with a traffic floor, not a count, because a 401 is normal there (client_error 12 vs successful 13 measured while healthy). The same file has a separate rule that fires on ANY 5xx with no ratio.' },
  { id: 'lab-5xx-rule', status: 'inferred', text: 'This lab\'s gateway rule applies the ratio-plus-floor idea to 5xx responses over 5 minutes. The windows and thresholds are this lab\'s own design, not AI-DEMO2\'s.' },
  { id: 'trace-join', status: 'inferred', text: 'A shared trace or client id is what joins one sign-in across products; the seeded events carry one on purpose.' },
  { id: 'log-shapes', status: 'UNVERIFIED', text: 'The line shapes and field names shown for PingOne, PingFederate and Ping Gateway are illustrative, not checked against product documentation.' },
  { id: 'shapes-measured', status: 'measured', text: 'On 2026-11-07 lines were read from a running AI-DEMO2 stack through its own collector rule: the Privilege node sensor prints level=INFO msg="nodesensor: reported findings" lines and plain exec lines, the MCP gateway prints [GW] lines, the Privilege agent gateway prints time=... level=... msg=... lines, PingFederate server.log lines look like a timestamp, tid:<id>, DEBUG and a class name, and Ping Gateway prints Java log lines with colour codes. The PingFederate and Ping Gateway shapes in this lab\'s mock data are NOT those, so they stay illustrative.' },
  { id: 'gateway-file-log', status: 'measured', text: 'On 2026-11-07 the Privilege agent gateway (ping-mcpgw) was started from AI-DEMO2 docker-compose.yml (profile mcpgw) for a few minutes. Its log is a file (/var/log/procyon/cyonproxy.log, on a volume) and docker logs printed no lines, so AI-DEMO2\'s collector, which reads container stdout only, would ship nothing and a "no lines in 10 minutes" rule would fire for it. Of the last 3000 file lines about 830 were "authorization header missing" and 830 "Invalid Authorization token", both at level info: a level=error filter never sees a rejected request. Measured on 2026-11-08 from the same gateway: the invalid-token line directly follows a missing-header line in 22,022 of 22,192 cases, so they are one event, and a refused request to an MCP app path wrote no line at all.' },
  { id: 'level-labels', status: 'UNVERIFIED', text: 'In this lab each line carries service, source and level as labels. In the AI-DEMO2 collector only service (plus component for one container) is attached (config.docker.alloy); level and source would be parsed from the line.' },
];

export const TOOLS = [
  { id: 'query', title: 'Query the store', how: 'Type a query such as {service="pingfederate"} |= "FAILURE". Label matchers: = != =~ !~. Line filters: |= != |~ !~. Regex operators accept only a literal alternation like "a|b" (letters, digits, space and _ : / = -); real Loki would treat other characters as regex syntax.' },
];

export const TALK_TRACK = [
  { id: 'say-first', title: 'Say this first', say: 'Everything on this screen is simulated: seeded log lines for six Ping sources and a mock store. The formats are illustrative. What is measured is the pipeline lesson, taken from the AI-DEMO2 monitoring stack.' },
  { id: 'join', title: 'One sign-in, three products', say: 'Search the client id. One sign-in shows up in PingOne, PingFederate and the gateway. That shared id is the whole join; without it you are lining up clocks.' },
  { id: 'burst', title: 'A burst, not a blip', say: 'Press Simulate burst. Eight failed sign-ins in two minutes and the rule fires. Two stray failures an hour never would.' },
  { id: 'ratio', title: 'Why a ratio', say: 'Look at the gateway 401s: lots of them, nothing is wrong. A spec-following client starts every session with one. So this lab\'s gateway rule uses a ratio of 5xx with a traffic floor, not a count of rejections.' },
  { id: 'silence', title: 'The silent failure', say: 'Open the Label lab and turn the relabel rule off. Nothing errors. Every query returns nothing. The only rule that notices is the one that watches for silence.' },
  { id: 'real', title: 'Mock and Real', say: 'Mock is the default and needs nothing. Real reads one Loki on this machine, read-only, if you configured it; otherwise the button explains why it is off.' },
  { id: 'unverified', title: 'What is not claimed', say: 'The line shapes are illustrative and labelled UNVERIFIED. This lab does not claim to match any product version.' },
];
