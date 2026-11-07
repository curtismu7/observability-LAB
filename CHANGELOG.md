# Changelog

## 0.1.0 (unreleased)

- Core: seeded mock log stream for PingOne, PingFederate and Ping Gateway (replayed relative to now), LogQL-lite with literal-only regex operators, three alert rules (burst, ratio with a traffic floor, silence), per-workspace incidents and relabel switch, runtime Mock/Real toggle, read-only loopback Loki client for Real, W3C traceparent on every hop, doctor that replays every scenario.
- Web: Logs, Products, Pipeline (diagram-studio/1 data), Label lab, Alerts, Talk track; presenter mode.
- Port 7800 (one port, from the shelf allocator; the first draft used 7720-7729, which meridian-a2a-hop already owns). Catalog id D122 is a plan id (not assigned).
