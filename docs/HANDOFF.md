# HANDOFF: observability-LAB

**Date:** 2026-11-07. GitHub account for every operation: `curtismu7` (check `gh auth status`; never `cmuir_pingcorp`). Read first: `~/Development/STANDALONE-RULES.md`.

## What this lab is

A standalone, simpler version of the AI-DEMO2 monitoring stack (collector, Loki, dashboards, alert rules) for six sources: PingOne, PingFederate, Ping Gateway, the Privilege node sensor (`procyon-nodesensor`), the Privilege agent gateway (`ping-mcpgw`) and the MCP gateway (`mcp-gateway`). The last three were added 2026-11-07 with shapes measured from a running AI-DEMO2 stack. The agent gateway writes its log to a FILE, not stdout, so AI-DEMO2's collector would not ship it (measured). See README.md for what it teaches. Tier Demo; ports 7800; catalog id D123 (owner's choice 2026-11-07; D122 belongs to a2a-lab).

## State

- Local repo only (`~/Development/observability-LAB`). **No GitHub repo, no shelf PR, no lab-proxy route yet.** Repo creation needs explicit owner approval.
- Board row claimed in `STANDALONE-COORDINATION.md` (2026-11-07).
- Built in three steps (core, web, integration). Evidence is in the commit messages and the board.

## Decisions the owner made (2026-11-07)

Name observability-LAB; custom UI with NO Grafana (one container); Real = read-only queries to a loopback Loki from `OBS_LOKI_URL`; v1 = PingOne, PingFederate, Ping Gateway only.

## Not done, and why

- `AI-DEMO-Standalone/scripts/check-css.sh` passes (2026-11-07): `tokens.css` now maps onto the shared stylesheet's tokens (no literals, no media query), the diagram CSS uses shared tokens, and reduced motion is handled in `hooks/useDiagramStepper.js` instead of `!important`. The sibling labs built from the same scaffold still fail it. `check-ui-patterns.sh` and `check-ui-standard.sh` pass.

- Not covered: the model-call gateway's JSON lines (`LLM request`, `AIGuard`, `AIGuardControl`, A2A allow/deny; AI-DEMO2 `privilege/GATEWAY-LOGGING-WITH-ELASTICSEARCH.md` describes them, so a source added from it would be doc-sourced, not measured; the `ping-mcpgw` source here is the other, logfmt gateway), P1AZ decisions, and the other MCP servers (`mcp-server` prints tracing span fields, `mcp-weather`, `mcp-brave`, ...). Each is a one-entry addition to `PRODUCTS` in `server/src/logData.js` plus baseline lines in `server/src/logStore.js`. The AI-DEMO2 doc `privilege/GATEWAY-LOGGING-WITH-ELASTICSEARCH.md` is the source for the Privilege lesson.
- Real mode was run by an agent twice. (1) Against a throwaway Loki 3.3.2 with hand-pushed lines: query, product mapping, level label and alert evaluation worked. (2) 2026-11-07 against a throwaway Loki fed by AI-DEMO2's own `monitoring/alloy/config.docker.alloy` relabel rule, restricted by an added keep rule to `ai-demo-ping-gateway` and `ai-demo-pingfederate`: service labels came out as `ping-gateway` and `pingfederate` (both match this lab), real lines mapped to the right products, `ProductLogSilence` fired for `pingone-webhook` (no PingOne forwarder in that stack). Later the same day AI-DEMO2's own Loki and Alloy (observability profile, those two services only, Loki port bound to 127.0.0.1 through an override file outside the repo) were started and the lab read from them: all four services mapped, silence fired only for pingone-webhook. Grafana, Prometheus and Alertmanager were not started. To stop: `docker compose -f docker-compose.yml -f docker-compose.override.yml --profile observability stop loki alloy` in AI-DEMO2. Measured gaps: real PF `server.log` and gateway lines differ from the mock shapes, so `FailedLoginBurst` and the 5xx rule see nothing meaningful; gateway lines carry ANSI colour codes. Owner run against the real profile: `./run-docker.sh optional start observability` in AI-DEMO2, `OBS_LOKI_URL=http://127.0.0.1:3100`, press Real.
- Line shapes: PingOne, PingFederate and Ping Gateway mock lines are UNVERIFIED (illustrative; real PF/gateway lines measured 2026-11-07 look different). Privilege sensor and MCP gateway shapes were measured from a running AI-DEMO2 stack.
- The shared lab-proxy route and compose network (an edit to `AI-DEMO-Standalone/shared/lab-proxy`, a different repo) are owed, as is the meta-repo submodule pin.
- The SE k8s mock build is deferred by the owner (rule 18).

## Traps

- Own stack (2026-11-07): `docker compose --profile stack up -d` (Loki + Alloy in the lab's network namespace, `OBS_LOKI_URL=http://127.0.0.1:3100`) and `docker compose --profile drive run --rm driver` (Playwright in Docker, GET only, via the lab-proxy). Verified end to end: 267 proxy lines in Loki after one run, readable in Real mode. Limits: lines are nginx access-log shape; 5 of 11 default labs were skipped (421/403/502 at the proxy, their Host allowlists differ); the driver needs the lab-proxy up on 127.0.0.1:8443.
- Real mode needs a loopback Loki on purpose: the netguard refuses all other outbound. Do not loosen it; port-forward a remote Loki to localhost instead.
- Mock events are replayed relative to now. If you pin timestamps for a test, pass a fixed `now`.
- `air-test` was unreachable on 2026-11-07 (Air hostname did not resolve); tests were run locally.
- Do not `pkill -f server/src/index.js`: it matches every lab's server. Kill by the PID from `lsof -iTCP:7800 -sTCP:LISTEN`.
