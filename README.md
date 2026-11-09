# Observability LAB

Tier: Demo.
Repo: https://github.com/curtismu7/observability-LAB

Ping products log in different ways. This lab follows a log line from the product to a searchable, alertable store, and shows what goes wrong when one small collector rule is missing. It is the standalone version of the logging and monitoring stack in AI-DEMO2 (collector, Loki, dashboards, alert rules), without Grafana: one small container with its own log store, a query box and three alert rules.

Catalog id **D123** (chosen by the owner 2026-11-07; D122 belongs to a2a-lab).

## What is simulated

**Mock mode (the default; needs no tenant, no credentials, no network).** Seeded, synthetic log events for fifteen sources (PingOne webhook events, PingFederate audit and server lines, Ping Gateway route and router-error lines, the Privilege node sensor, the Privilege agent gateway, the Privilege hosted gateway, the hosted gateway's OpenSearch events, the Prompt-Guard sidecar, the MCP gateway, the banking MCP server, the weather MCP server, the LLM proxy, the authz server and the Privilege SIEM) are replayed relative to "now", so the last 30 minutes are always populated. A mock store answers a small query language (LogQL-lite). Three mock alert rules watch it. Every host is `.example`; every identifier is made up. The simulation banner on every tab says so.

**What is measured and what is not.** Every line shape added on 2026-11-08 was sampled from the running service and carries its honesty label; ids and hostnames are placeholders. The PingOne webhook, PingFederate audit and Ping Gateway route shapes are still illustrative (UNVERIFIED). The weather MCP server logs per call (errors and some informational lines) and is a source. One call to each of the Brave and audit servers printed nothing, and the HITL service prints only start-up lines (its challenge routes need a shared secret, so no approval line was observed): they are not sources. A trace id did not join lines across these services on 2026-11-08: the banking server's trace ids stayed in its own log and every Jaeger trace had one service, so the lab does not claim a trace join. The hosted gateway's OpenSearch events and the Prompt-Guard sidecar live in the SE cluster: Mock shows them, Real mode on this machine does not.

**Privilege SIEM (Elasticsearch), a second Real source.** The Privilege events live in the index `ping-siem-events-v2` on the SIEM Elasticsearch: console admin changes (`privilege_event_kind` = console) and runtime events (gateway HTTP records, policy decisions, guardrail verdicts, agent approvals). Every Privilege product card has an **Open in Kibana (Privilege logs)** link (data view `privilege-logs`) and the tunnel command it needs, and the Products tab opens with a **Privilege logs in Kibana** panel: links to the Privilege logs dashboard and Discover, the **Privilege overview** dashboard (policy denials, AI Guard denials, approval holds, decisions per day), the **Ping logs (all products)** dashboard and Discover on the `ping-logs` data view, **Security detection rules** and the **Detection rule monitoring** dashboard, the five saved searches (`privilege-all`, `-runtime`, `-console`, `-decisions`, `-aiguard`) and seven ready-made KQL queries, each with a **Copy** button and a **Run in Discover** link (the query is Rison-quoted into the link), with the tunnel command beside them; the Kibana origin is `PRIVILEGE_KIBANA_URL`, default `http://localhost:5601`. To read the index in Real mode, run the lab on the host (or in Docker with the `siem` profile, below) and set `PRIVILEGE_SIEM_URL` (a loopback port-forward to `elasticsearch-siem`) and `PRIVILEGE_SIEM_READ_APIKEY`; then ask for `{service="privilege-siem"}`, filter with `kind` (`console` or `runtime`) or `index`, and use **Look back** (up to 30 days; the other sources keep 30 minutes). The client sends one read-only search (`POST /<index>/_search`) to that loopback origin, never follows a redirect, caps the answer, scrubs secret-looking fields again, and never returns or logs the key. **The owner creates a read key limited to that one index; this lab never creates one.** Mock shows a sample with placeholders only (the repo is public) and needs none of this. The shapes of four of the five indices (`audit-log`, `proxy-audit-log`, `policy-decision-log`, `aiguard-log`) were measured on 2026-11-08 by the privilege-logging-LAB session, which read the live index and relayed them with the values replaced; `@timestamp` is the confirmed time field. This lab has not read the index itself, so its Real path has only been run against a stand-in, and the `agent-approval-log` shape stays UNVERIFIED. A deny or a hold (Decision `deny` or `hitl`) shows as level warn.

**Click a log line** to open it: the exact time, its labels, the whole message, the fields found in it (JSON or key=value), and what kind of line it is, with its measured or UNVERIFIED label. Click again to close it. Several can be open at once.

**Real mode (owner-run, read-only).** Set `OBS_LOKI_URL` to a Loki on this machine (loopback only, for example the AI-DEMO2 observability profile on `http://127.0.0.1:3100`) and the header **Real** button reads log lines from it with `GET /loki/api/v1/query_range`. Nothing is ever written to Loki, no credentials are sent, redirects are refused, answers are size- and time-capped, and the query sent is rebuilt from the parsed query rather than the raw text. A remote Loki is refused (the lab has no outbound network on purpose); unconfigured, the button is disabled with the reason and `POST /api/mode` answers 409. Real mode was run by an agent on 2026-11-07 against AI-DEMO2's own Loki and Alloy (started for the test from its `observability` profile, Loki and Alloy only): `{service="ping-gateway"}`, `{service="pingfederate"}`, `{service="procyon-nodesensor"}` and `{service="mcp-gateway"}` returned real lines that mapped to the right products, and `ProductLogSilence` fired only for `pingone-webhook` because AI-DEMO2 runs no PingOne webhook forwarder. Measured limits: real PingFederate (`server.log` DEBUG lines) and gateway lines (Java log lines with colour codes) do not look like the lab's mock lines, so `FailedLoginBurst` and the 5xx rule judge nothing useful on them. A line's level comes from an explicit `level` label, then the line text (`level=INFO`, or an upper-case word such as ERROR in the first 300 characters), then Loki's own `detected_level` guess, which is last because it called a colourised ERROR gateway line `info`.

> The line shapes shown for PingOne, PingFederate and Ping Gateway are **illustrative and UNVERIFIED** against product documentation. What is *measured* is the pipeline lessons, each taken from a named file in the AI-DEMO2 monitoring stack and labelled on the Products tab.

## What it teaches

1. **One shared id is the join.** Search the client id and one sign-in appears in PingOne, PingFederate and the gateway in time order. (The Privilege sensor and MCP gateway lines carry no shared id; they are searched, not joined.)
2. **A burst is not a blip.** Two stray failures an hour are noise; eight in two minutes fires the rule.
3. **A 401 is not an outage.** A spec-following MCP client starts every session with one, so the gateway rule is a ratio of 5xx with a traffic floor, never a count of rejections (measured in AI-DEMO2).
4. **The silent failure.** Turn the collector's relabel rule off: container names reach the store with a slash and a prefix, every by-service query returns nothing, nothing errors, and only the silence rule notices (measured in AI-DEMO2).
5. **PingOne is different.** It is SaaS: its events arrive only because a forwarder pushes webhooks.

## Run it

- Host: `./scripts/run.sh` (Node 26+), then open http://localhost:7800/.
- Docker (OrbStack): `HOST_PORT=7800 docker compose up --build -d`, published on `127.0.0.1` only.
- Through the shared lab-proxy: `https://local.ping-devops.com:8443/observability-lab/` once the owner registers the route (see `docs/HANDOFF.md`).
- Tests: `npm ci && npm test` (server, web and packaging). Preflight: `npm run doctor`. Reset: `npm run reset`.
- Real: copy `.env.example` to `.env` and set `OBS_LOKI_URL`.
- **Start mode.** With no `MODE` (or an empty one) the lab starts in **Real** when the Real settings are usable (a loopback `OBS_LOKI_URL` or the Privilege SIEM settings) and in **Mock** otherwise, so anyone without settings still gets Mock. The image sets `MODE=mock` for a plain `docker run`; compose replaces it with `MODE: ${OBS_MODE:-}`, empty when `OBS_MODE` is unset, so `docker compose up` follows the rule above. `OBS_MODE=mock` or `OBS_MODE=real` forces one (`real` without settings is refused at start). The header toggle (`POST /api/mode`) still switches at runtime.
- **Port-forward hints.** The Kibana and Elasticsearch tunnel commands the lab shows read `kubectl --context <your-context> -n <your-namespace> ...`. Set `OBS_KUBE_CONTEXT` and `OBS_KUBE_NAMESPACE` in your shell (compose passes them through, empty by default) to show your own: plain names of 1 to 63 letters, digits, `.`, `_` or `-`; anything else keeps the placeholder. They are hints only; the lab never runs `kubectl`.
- **Whole stack** (lab, Loki, Alloy, the SIEM forwarder and the agent gateway log file), after exporting the settings in your shell: `docker compose -f docker-compose.yml -f docker-compose.privilege.yml --profile stack --profile siem up -d --build --force-recreate`.
- **Own log stack, no AI-DEMO2 needed (profile `stack`).** `OBS_LOKI_URL=http://127.0.0.1:3100 docker compose --profile stack up -d` starts this lab plus its own Loki and Alloy. They share the lab's network namespace, so Loki is on the lab's loopback and no extra host port is published. Alloy reads the **lab-proxy's** stdout through the Docker socket (mounted read-only, as AI-DEMO2's collector does) and sets `service` from the container name. Stop with `docker compose --profile stack down`.
- **Privilege SIEM in Docker (profile `siem`).** The lab reads the SIEM only from a loopback URL, and inside the container loopback is the container. The `siem-forwarder` service (`alpine/socat`, pinned) shares the lab's network namespace, listens on `127.0.0.1:9200` there and relays to the Mac's `localhost:9200` (OrbStack's `host.docker.internal`), where the Elasticsearch port-forward runs. It publishes no host port, is read-only, drops every capability and runs as nobody. Export the settings in your shell (compose passes them through; nothing is written to a file in the repo) and set the URL to the forwarder: `PRIVILEGE_SIEM_URL=http://127.0.0.1:9200 PRIVILEGE_SIEM_READ_APIKEY=... OBS_LOKI_URL=http://127.0.0.1:3100 docker compose --profile stack --profile siem up -d`. `PRIVILEGE_SIEM_INDEX`, `PRIVILEGE_KIBANA_URL`, `PRIVILEGE_LOGGING_LAB_URL` and `FIELD_NOTES_URL` pass through the same way; empty means the default (SIEM off). Start or recreate the whole stack together, so Loki, Alloy and the forwarder join the current lab container's namespace.
- **Read key for the SIEM (you run it).** `scripts/make-read-key.sh` makes one read-only Elasticsearch API key (reads `ping-siem-events-v2`, `ping-logs-*`, `demo-logs-*` and `pingone-events`; expires in 30 days) and saves it, with `PRIVILEGE_SIEM_URL`, in your own `.env`. It needs the Elasticsearch port-forward and the password of a user that may create keys (typed hidden, or read from a cluster Secret in your shell with `ES_SECRET`; `--find` lists candidates). The key is never printed and the lab itself never creates a credential. Then recreate the stack with `--profile siem`.
- **Rules table (you run it).** Kibana's managed *Detection rule monitoring* dashboard cannot be edited and the anonymous Kibana user is read-only. `scripts/kibana-runs-per-rule.py` reads the live managed dashboard and saves a COPY, *Detection rule monitoring (runs per rule)*, with one table under the five top boxes: one row per rule with how many times it ran, average and slowest run time, new alerts and when it last ran, for the selected time range. It needs the Kibana port-forward and a user that may save dashboards (password typed hidden, or `ES_SECRET` from a cluster Secret). The managed dashboard is never changed; run it again to refresh the copy.
- **Browser driver (profile `drive`).** `docker compose --profile drive run --rm driver` runs headless Chromium (Playwright 1.59.1, in Docker) against the labs through the lab-proxy, so the proxy writes real access-log lines for Alloy to ship. GET only: it loads each lab's page, reads `/api/health` and clicks tabs; no form, sign-in or POST. `DRIVE_LABS=a-lab,b-lab` and `DRIVE_ROUNDS=3` tune it. Query the result in Real mode with `{service="lab-proxy-lab-proxy-1"}`.
- **Privilege logs in the stack.** Alloy also ships the Privilege **node sensor** (`procyon-nodesensor`) and the **MCP gateway** (`mcp-gateway`), the two that print to stdout, and six AI-DEMO2 services whose lines the lab models (PingFederate, the Ping Gateway, the LLM proxy, the authz server, the banking MCP server, the weather MCP server), each matched by exact container name and rate limited so the Ping Gateway's endless router error cannot fill Loki; they appear when AI-DEMO2's containers of those names are running. The **agent gateway** (`ping-mcpgw`) writes a file, so it is an add-on: `docker compose -f docker-compose.yml -f docker-compose.privilege.yml --profile stack up -d` mounts AI-DEMO2's `ai-demo_mcpgw-logs` volume read-only (override with `PRIVILEGE_LOG_VOLUME`). Only the four modelled message families are kept (the two rejection lines, the control-plane stream error, and the four `[SERVER]` request lines that carry User-Agent and Remote Addr); the file's other lines (tenant and node ids, peer certificates) are dropped before Loki, and only lines written after start are read. New gateway lines appear only while AI-DEMO2's `mcpgw` profile is running, which connects to the owner's tenant; this lab never starts it.
- **What this measured (2026-11-07):** nearly every `-LAB` app prints only a startup line to stdout, so the browser makes no app log lines; the lines come from the **proxy's access log**. First run: 6 of 11 default labs reached; the others answered 421, 403 or 502 at the proxy and were skipped. The proxy log holds every request through it, so Loki also gets non-driver lines (health polls from other tools); driver requests carry a HeadlessChrome user agent. The lines are nginx access-log shape, not the Ping product shapes, so the six product alert rules still read as silent in this stack.

## Run from a clone

Prerequisites: Node 26 or newer. Docker (OrbStack) only for the Docker form. Mock needs no tenant and no credentials.

```
git clone https://github.com/curtismu7/observability-LAB.git
cd observability-LAB
npm ci
npm run build
npm run doctor
npm start
```

Open http://127.0.0.1:7800/. `GET /api/health` answers `demo-health/1`. Or with Docker: `HOST_PORT=7800 docker compose up --build -d` from the same folder.

## What to do if the port is taken

```
Ports: observability-LAB listens on 7800 only.
Docker publishes it on 127.0.0.1:7800 only.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:7800 -sTCP:LISTEN -n -P
2. If it is an old copy of this lab (npm start), stop that process: kill <PID>.
   If it is this lab's container: docker compose down (from this folder).
3. If it is something else, stop it. The lab refuses any other port on purpose
   (one port per app; npm run doctor says so), so free 7800 rather than moving the lab.
4. Then start again: npm start, or docker compose up -d.
```

## Tabs

Logs (scenarios, query box, product and level filters, raw hops with `traceparent`), Products (sources, status labels, measured/UNVERIFIED facts), Pipeline (ReactFlow diagram with Simulate, Reset and speed control: the mock Loki path on top, and below it the paths into Elasticsearch and Kibana: the Privilege SIEM export and logs bridge into `ping-siem-events-v2`, a Vector collector on local Docker into `ping-logs-*`, the PingOne webhook subscription through pingone-events-LAB into `ping-logs-pingone`, and this lab reading the Privilege index through the loopback forwarder; each new box carries its honesty label, and the PingOne path says it is being switched on, not measured), Label lab, Alerts (Simulate buttons), Searches, Talk track. Presenter mode (key `P`) keeps the banner.

**Searches** lists Kibana searches that each answer one question, in five groups: Privilege (one user, one agent key, one tool, one app, policy denials, approval holds, approvals released, AI Guard blocks, decisions missing the agent key, console changes by one admin), All Ping products (one user, all real errors, errors for one product), PingFederate (failed sign-ins, token requests for one client, admin changes), PingGateway (errors) and PingOne webhooks (all, one service, failures, one user; data appears once PingOne forwarding is live; the service list uses the `ping_component` values the Elasticsearch pipeline writes: sso, mfa, davinci, authorize, protect, verify, credentials, directory, governance, provisioning, admin-config, other, shown with readable names). Each shows the question, the KQL, the data view and, where it needs one, an input box or select: the value goes into the KQL as one quoted string (`\` and `"` escaped; empty, over 200 characters or control characters refused). **Copy** copies the KQL; **Run in Discover** opens it on `PRIVILEGE_KIBANA_URL` with the same Rison helper as the Products panel, last 30 days. A **Links** section has Security Alerts, the privilege-logging-LAB Privilege tab (`PRIVILEGE_LOGGING_LAB_URL`, default `http://127.0.0.1:7801`), field-notes-LAB (`FIELD_NOTES_URL`, default `http://127.0.0.1:7804`; both loopback only) and the dashboards. Mock shows the same searches with a note that the links point at your Kibana. The lab never calls Kibana. Every search except the PingOne group returned events from the real index over 30 days before it shipped (the counts are in the pull request that added the tab).

## Query language

`{service="pingfederate", level!="debug"} |= "FAILURE" != "heartbeat"`. Label matchers `=` `!=` `=~` `!~`; line filters `|=` `!=` `|~` `!~`. The regex operators accept only a literal list like `"a|b|c"`: no regex engine ever sees your text.

## Surface

`GET /api/logs?query=&limit=&minutes=`, `GET /api/alerts`, `POST /api/incident` (`login-burst` | `gateway-5xx`, mock only), `GET|POST /api/relabel` (mock only), `GET /api/info`, `POST /api/mode` (exactly `{source:"mock"|"real"}`, 409 with the reason when Real is not configured), `GET /api/scenarios`, `GET /api/diagram`, `GET /api/runs`, `POST /api/reset`, `GET /api/health` (`demo-health/1`). Every visitor carries an `X-Workspace` id; Reset clears only that workspace.

Safety: loopback Host check (plus `LAB_ALLOWED_HOSTS`), same-origin writes, bounded input, `nosniff`, read-only container filesystem, non-root, a network guard that refuses every non-loopback connection. See `docs/safety.md` and `docs/talk-track.md` (generated from the same data the UI reads).

## Attribution

The scaffold (server shell, safety, workspaces, diagram viewer, packaging) was copied from `delegation-lab-LAB`; every surface here is this lab's own. The measured lessons come from reading the AI-DEMO2 monitoring configs; no code or identifier was imported from it.
