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

- `AI-DEMO-Standalone/scripts/check-css.sh` passes (2026-11-07): `tokens.css` now maps onto the shared stylesheet's tokens (no literals, no media query), the diagram CSS uses shared tokens, and reduced motion is handled in `hooks/useDiagramStepper.js` instead of `!important`. The sibling labs built from the same scaffold still fail it. `check-ui-patterns.sh` and `check-ui-standard.sh` pass.

- Privilege (SIEM feed vs gateway log), P1AZ decisions and the MCP servers are out of v1 (a follow-up). The AI-DEMO2 doc `privilege/GATEWAY-LOGGING-WITH-ELASTICSEARCH.md` is the source for the Privilege lesson.
- Real mode was run by an agent twice. (1) Against a throwaway Loki 3.3.2 with hand-pushed lines: query, product mapping, level label and alert evaluation worked. (2) 2026-11-07 against a throwaway Loki fed by AI-DEMO2's own `monitoring/alloy/config.docker.alloy` relabel rule, restricted by an added keep rule to `ai-demo-ping-gateway` and `ai-demo-pingfederate`: service labels came out as `ping-gateway` and `pingfederate` (both match this lab), real lines mapped to the right products, `ProductLogSilence` fired for `pingone-webhook` (no PingOne forwarder in that stack). Not done: starting AI-DEMO2's own observability profile (Loki/Alloy/Grafana) on this memory-starved Mac. Measured gaps: real PF `server.log` and gateway lines differ from the mock shapes, so `FailedLoginBurst` and the 5xx rule see nothing meaningful; lines without a `level` label show as `info` even if the text says ERROR; gateway lines carry ANSI colour codes. Owner run against the real profile: `./run-docker.sh optional start observability` in AI-DEMO2, `OBS_LOKI_URL=http://127.0.0.1:3100`, press Real.
- Line shapes for all three products are UNVERIFIED (illustrative).
- The shared lab-proxy route and compose network (an edit to `AI-DEMO-Standalone/shared/lab-proxy`, a different repo) are owed, as is the meta-repo submodule pin.
- The SE k8s mock build is deferred by the owner (rule 18).

## Traps

- Real mode needs a loopback Loki on purpose: the netguard refuses all other outbound. Do not loosen it; port-forward a remote Loki to localhost instead.
- Mock events are replayed relative to now. If you pin timestamps for a test, pass a fixed `now`.
- `air-test` was unreachable on 2026-11-07 (Air hostname did not resolve); tests were run locally.
- Do not `pkill -f server/src/index.js`: it matches every lab's server. Kill by the PID from `lsof -iTCP:7800 -sTCP:LISTEN`.
