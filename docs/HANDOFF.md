# HANDOFF: observability-LAB

**Date:** 2026-11-07. GitHub account for every operation: `curtismu7` (check `gh auth status`; never `cmuir_pingcorp`). Read first: `~/Development/STANDALONE-RULES.md`.

## What this lab is

A standalone, simpler version of the AI-DEMO2 monitoring stack (collector, Loki, dashboards, alert rules) for three Ping products: PingOne, PingFederate, Ping Gateway. See README.md for what it teaches. Tier Demo; ports 7800; catalog id D123 (owner's choice 2026-11-07; D122 belongs to a2a-lab).

## State

- Local repo only (`~/Development/observability-LAB`). **No GitHub repo, no shelf PR, no lab-proxy route yet.** Repo creation needs explicit owner approval.
- Board row claimed in `STANDALONE-COORDINATION.md` (2026-11-07).
- Built in three steps (core, web, integration). Evidence is in the commit messages and the board.

## Decisions the owner made (2026-11-07)

Name observability-LAB; custom UI with NO Grafana (one container); Real = read-only queries to a loopback Loki from `OBS_LOKI_URL`; v1 = PingOne, PingFederate, Ping Gateway only.

## Not done, and why

- `AI-DEMO-Standalone/scripts/check-css.sh` FAILS (41 colour literals in `tokens.css` and the three diagram CSS files, 1 `prefers-color-scheme` block, 3 `!important`). Inherited from the shared scaffold: hitl-mfa-lab, a2a-lab, mcp-gateway-lab and delegation-lab fail the same way. Not fixed here (it restyles the diagram controls in two themes). `check-ui-patterns.sh` and `check-ui-standard.sh` pass.

- Privilege (SIEM feed vs gateway log), P1AZ decisions and the MCP servers are out of v1 (a follow-up). The AI-DEMO2 doc `privilege/GATEWAY-LOGGING-WITH-ELASTICSEARCH.md` is the source for the Privilege lesson.
- Real mode was run once, by an agent, against a throwaway local Loki 3.3.2 (lines pushed by hand; query, product mapping, level label and alert evaluation all worked). It has NOT been run against the AI-DEMO2 observability stack. Owner run: start the AI-DEMO2 observability profile, set `OBS_LOKI_URL=http://127.0.0.1:3100`, press Real. Whether the services there are labelled `pingfederate`, `ping-gateway`, `pingone-webhook` is UNVERIFIED. Static read of AI-DEMO2 (2026-11-07, Loki was down so nothing was queried): Alloy sets `service` = container name minus `ai-demo-`, so `ping-gateway` matches, while its compose has no PingFederate or PingOne webhook container, so those two queries would likely come back empty. The default query may return nothing until you adjust it.
- Line shapes for all three products are UNVERIFIED (illustrative).
- The shared lab-proxy route and compose network (an edit to `AI-DEMO-Standalone/shared/lab-proxy`, a different repo) are owed, as is the meta-repo submodule pin.
- The SE k8s mock build is deferred by the owner (rule 18).

## Traps

- Real mode needs a loopback Loki on purpose: the netguard refuses all other outbound. Do not loosen it; port-forward a remote Loki to localhost instead.
- Mock events are replayed relative to now. If you pin timestamps for a test, pass a fixed `now`.
- `air-test` was unreachable on 2026-11-07 (Air hostname did not resolve); tests were run locally.
- Do not `pkill -f server/src/index.js`: it matches every lab's server. Kill by the PID from `lsof -iTCP:7800 -sTCP:LISTEN`.
