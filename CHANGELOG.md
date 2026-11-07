# Changelog

## 0.1.0 (unreleased)

- Added: Privilege agent gateway (`ping-mcpgw`) as a sixth source (lab PR #1).
- Added: Privilege logs in the own stack: node sensor and MCP gateway from stdout, agent gateway from AI-DEMO2's log volume (optional `docker-compose.privilege.yml`, read-only, tail from end, three message families kept). Alloy drops container history older than 15 minutes (a restart otherwise made Loki reject the replay).
- Added: own log stack (compose profile `stack`: Loki 3.3.2 + Alloy v1.19.2 sharing the lab's network namespace, nothing extra published) and a Playwright browser driver in Docker (profile `drive`) that visits labs through the lab-proxy so Alloy ships real access-log lines. See README.

- Core: seeded mock log stream for PingOne, PingFederate and Ping Gateway (replayed relative to now), LogQL-lite with literal-only regex operators, three alert rules (burst, ratio with a traffic floor, silence), per-workspace incidents and relabel switch, runtime Mock/Real toggle, read-only loopback Loki client for Real, W3C traceparent on every hop, doctor that replays every scenario.
- Web: Logs, Products, Pipeline (diagram-studio/1 data), Label lab, Alerts, Talk track; presenter mode.
- Port 7800 (one port, from the shelf allocator; the first draft used 7720-7729, which meridian-a2a-hop already owns). Catalog id D123 (chosen by the owner 2026-11-07; D122 belongs to a2a-lab).
