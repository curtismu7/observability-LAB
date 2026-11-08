# Observability Lab

**Tier: Demo.** Ping products log in different ways. This lab follows a log line from the product to a searchable, alertable store, and shows what goes wrong when one small collector rule is missing. It is the standalone version of the logging and monitoring stack in AI-DEMO2 (collector, Loki, dashboards, alert rules), without Grafana: one small container with its own log store, a query box and three alert rules.

Catalog id **D123** (chosen by the owner 2026-11-07; D122 belongs to a2a-lab).

## What is simulated

**Mock mode (the default; needs no tenant, no credentials, no network).** Seeded, synthetic log events for twelve sources (PingOne webhook events, PingFederate audit and server lines, Ping Gateway route and router-error lines, the Privilege node sensor, the Privilege agent gateway, the Privilege hosted gateway, the hosted gateway's OpenSearch events, the Prompt-Guard sidecar, the MCP gateway, the banking MCP server, the LLM proxy and the authz server) are replayed relative to "now", so the last 30 minutes are always populated. A mock store answers a small query language (LogQL-lite). Three mock alert rules watch it. Every host is `.example`; every identifier is made up. The simulation banner on every tab says so.

**What is measured and what is not.** Every line shape added on 2026-11-08 was sampled from the running service and carries its honesty label; ids and hostnames are placeholders. The PingOne webhook, PingFederate audit and Ping Gateway route shapes are still illustrative (UNVERIFIED). The weather, Brave, audit, HITL and agent-service containers print only start-up lines until something calls them, so they are not sources yet. The hosted gateway's OpenSearch events and the Prompt-Guard sidecar live in the SE cluster: Mock shows them, Real mode on this machine does not.

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
- **Own log stack, no AI-DEMO2 needed (profile `stack`).** `OBS_LOKI_URL=http://127.0.0.1:3100 docker compose --profile stack up -d` starts this lab plus its own Loki and Alloy. They share the lab's network namespace, so Loki is on the lab's loopback and no extra host port is published. Alloy reads the **lab-proxy's** stdout through the Docker socket (mounted read-only, as AI-DEMO2's collector does) and sets `service` from the container name. Stop with `docker compose --profile stack down`.
- **Browser driver (profile `drive`).** `docker compose --profile drive run --rm driver` runs headless Chromium (Playwright 1.59.1, in Docker) against the labs through the lab-proxy, so the proxy writes real access-log lines for Alloy to ship. GET only: it loads each lab's page, reads `/api/health` and clicks tabs; no form, sign-in or POST. `DRIVE_LABS=a-lab,b-lab` and `DRIVE_ROUNDS=3` tune it. Query the result in Real mode with `{service="lab-proxy-lab-proxy-1"}`.
- **Privilege logs in the stack.** Alloy also ships the Privilege **node sensor** (`procyon-nodesensor`) and the **MCP gateway** (`mcp-gateway`), the two that print to stdout, and five AI-DEMO2 services whose lines the lab models (PingFederate, the Ping Gateway, the LLM proxy, the authz server, the banking MCP server), each matched by exact container name and rate limited so the Ping Gateway's endless router error cannot fill Loki; they appear when AI-DEMO2's containers of those names are running. The **agent gateway** (`ping-mcpgw`) writes a file, so it is an add-on: `docker compose -f docker-compose.yml -f docker-compose.privilege.yml --profile stack up -d` mounts AI-DEMO2's `ai-demo_mcpgw-logs` volume read-only (override with `PRIVILEGE_LOG_VOLUME`). Only the four modelled message families are kept (the two rejection lines, the control-plane stream error, and the four `[SERVER]` request lines that carry User-Agent and Remote Addr); the file's other lines (tenant and node ids, peer certificates) are dropped before Loki, and only lines written after start are read. New gateway lines appear only while AI-DEMO2's `mcpgw` profile is running, which connects to the owner's tenant; this lab never starts it.
- **What this measured (2026-11-07):** nearly every `-LAB` app prints only a startup line to stdout, so the browser makes no app log lines; the lines come from the **proxy's access log**. First run: 6 of 11 default labs reached; the others answered 421, 403 or 502 at the proxy and were skipped. The proxy log holds every request through it, so Loki also gets non-driver lines (health polls from other tools); driver requests carry a HeadlessChrome user agent. The lines are nginx access-log shape, not the Ping product shapes, so the six product alert rules still read as silent in this stack.

## Tabs

Logs (scenarios, query box, product and level filters, raw hops with `traceparent`), Products (sources, status labels, measured/UNVERIFIED facts), Pipeline (ReactFlow diagram with Simulate, Reset and speed control), Label lab, Alerts (Simulate buttons), Talk track. Presenter mode (key `P`) keeps the banner.

## Query language

`{service="pingfederate", level!="debug"} |= "FAILURE" != "heartbeat"`. Label matchers `=` `!=` `=~` `!~`; line filters `|=` `!=` `|~` `!~`. The regex operators accept only a literal list like `"a|b|c"`: no regex engine ever sees your text.

## Surface

`GET /api/logs?query=&limit=&minutes=`, `GET /api/alerts`, `POST /api/incident` (`login-burst` | `gateway-5xx`, mock only), `GET|POST /api/relabel` (mock only), `GET /api/info`, `POST /api/mode` (exactly `{source:"mock"|"real"}`, 409 with the reason when Real is not configured), `GET /api/scenarios`, `GET /api/diagram`, `GET /api/runs`, `POST /api/reset`, `GET /api/health` (`demo-health/1`). Every visitor carries an `X-Workspace` id; Reset clears only that workspace.

Safety: loopback Host check (plus `LAB_ALLOWED_HOSTS`), same-origin writes, bounded input, `nosniff`, read-only container filesystem, non-root, a network guard that refuses every non-loopback connection. See `docs/safety.md` and `docs/talk-track.md` (generated from the same data the UI reads).

## Attribution

The scaffold (server shell, safety, workspaces, diagram viewer, packaging) was copied from `delegation-lab-LAB`; every surface here is this lab's own. The measured lessons come from reading the AI-DEMO2 monitoring configs; no code or identifier was imported from it.
