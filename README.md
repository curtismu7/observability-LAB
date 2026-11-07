# Observability Lab

**Tier: Demo.** Three Ping products log in three different ways. This lab follows a log line from the product to a searchable, alertable store, and shows what goes wrong when one small collector rule is missing. It is the standalone version of the logging and monitoring stack in AI-DEMO2 (collector, Loki, dashboards, alert rules), without Grafana: one small container with its own log store, a query box and three alert rules.

Catalog id **D122** is a plan id: the owner has not assigned one yet.

## What is simulated

**Mock mode (the default; needs no tenant, no credentials, no network).** Seeded, synthetic log events for three products (PingOne webhook events, PingFederate audit and server lines, Ping Gateway route lines) are replayed relative to "now", so the last 30 minutes are always populated. A mock store answers a small query language (LogQL-lite). Three mock alert rules watch it. Every host is `.example`; every identifier is made up. The simulation banner on every tab says so.

**Real mode (owner-run, read-only).** Set `OBS_LOKI_URL` to a Loki on this machine (loopback only, for example the AI-DEMO2 observability profile on `http://127.0.0.1:3100`) and the header **Real** button reads log lines from it with `GET /loki/api/v1/query_range`. Nothing is ever written to Loki, no credentials are sent, redirects are refused, answers are size- and time-capped, and the query sent is rebuilt from the parsed query rather than the raw text. A remote Loki is refused (the lab has no outbound network on purpose); unconfigured, the button is disabled with the reason and `POST /api/mode` answers 409. Real mode was proven only against a fake loopback Loki in tests; it has not been run against a real Loki by an agent.

> The line shapes shown for PingOne, PingFederate and Ping Gateway are **illustrative and UNVERIFIED** against product documentation. What is *measured* is the pipeline lessons, each taken from a named file in the AI-DEMO2 monitoring stack and labelled on the Products tab.

## What it teaches

1. **One shared id is the join.** Search the client id and one sign-in appears in all three products in time order.
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

## Tabs

Logs (scenarios, query box, product and level filters, raw hops with `traceparent`), Products (sources, status labels, measured/UNVERIFIED facts), Pipeline (ReactFlow diagram with Simulate, Reset and speed control), Label lab, Alerts (Simulate buttons), Talk track. Presenter mode (key `P`) keeps the banner.

## Query language

`{service="pingfederate", level!="debug"} |= "FAILURE" != "heartbeat"`. Label matchers `=` `!=` `=~` `!~`; line filters `|=` `!=` `|~` `!~`. The regex operators accept only a literal list like `"a|b|c"`: no regex engine ever sees your text.

## Surface

`GET /api/logs?query=&limit=&minutes=`, `GET /api/alerts`, `POST /api/incident` (`login-burst` | `gateway-5xx`, mock only), `GET|POST /api/relabel` (mock only), `GET /api/info`, `POST /api/mode` (exactly `{source:"mock"|"real"}`, 409 with the reason when Real is not configured), `GET /api/scenarios`, `GET /api/diagram`, `GET /api/runs`, `POST /api/reset`, `GET /api/health` (`demo-health/1`). Every visitor carries an `X-Workspace` id; Reset clears only that workspace.

Safety: loopback Host check (plus `LAB_ALLOWED_HOSTS`), same-origin writes, bounded input, `nosniff`, read-only container filesystem, non-root, a network guard that refuses every non-loopback connection. See `docs/safety.md` and `docs/talk-track.md` (generated from the same data the UI reads).

## Attribution

The scaffold (server shell, safety, workspaces, diagram viewer, packaging) was copied from `delegation-lab-LAB`; every surface here is this lab's own. The measured lessons come from reading the AI-DEMO2 monitoring configs; no code or identifier was imported from it.
