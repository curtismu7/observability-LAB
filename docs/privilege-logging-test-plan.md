# Privilege logging test plan

Status: **plan, with Phase 0 (preflight) and Phase 1 (matrix) done on 2026-11-07. Phases 2 to 5 are not started.** Nothing below that is marked *measured* was run again for this document; labels follow the lab's honesty rule: **measured** (seen on a live stack), **inferred** (read from a name or a doc), **UNVERIFIED** (not seen).

Written for: the owner and SEs deciding what to test and in what order.

## 1. Goal

For every Privilege use case, app and page in AI-DEMO2: say which log line it produces, which source carries it, and whether this lab can see it. Each answer ends as measured, doc-sourced or UNVERIFIED, never a guess presented as fact.

Done means:

1. Every row of the surface matrix (section 5) has a result: *emits (source, shape, level)*, *emits nothing*, or *not observable locally (why)*.
2. Every shape the lab models for a Privilege source is either measured, or still labelled UNVERIFIED with the reason.
3. No log line in any source contains a token, key or password (negative check on every case).
4. The lab's Real mode shows the lines for every source that is observable locally.

## 2. Do not rebuild what exists: privilege-logging-LAB

`standalone/privilege-logging-LAB` (port 7801, Tester tier) already drives transactions through the gateway and records what each log sink shows. Per its README and `server/data/capture.json`:

- **17 cases measured on 2026-11-07** against one gateway build, across five sinks (hosted gateway pod log, response header, console, Elasticsearch `ping-siem-events`, OpenSearch `gateway-events`). Groups: MCP (5), AI Guard (2), Rejected (3), Aggregate (2), A2A (1), LLM (3), Intent (1).
- **17 more cases are defined but not measured** (`realOnly`): Keys (revoked, expired, 429, no mcp scope), Federated identity (valid, wrong audience, wrong issuer, expired, lifetime too long), Approvals (held, approved, denied, Cedar decision), Registry lifecycle (created, rotated, revoked, expired).
- **A correlation method**: a unique marker (`audit-<8 hex>`) planted in the request, found in the log first, with a time-window fallback.
- **Its headline findings** (its own words, one build): the pod log is the only sink with per-call lines; no allowed call has an explicit allow line; rejected calls name no user, agent or tool; the aggregate, A2A and LLM routes log little or nothing; the SIEM index held console changes only; the OpenSearch shipper had not delivered since 2026-10-26.

This plan therefore **reuses its case ids and marker method** and adds what it does not cover: the sources this lab ships to Loki (sensor, MCP gateway, agent gateway), every page and app, and the cases that are in neither lab.

## 3. Sources

| # | Source | How the lab gets it | State |
|---|---|---|---|
| 1 | Privilege node sensor (`procyon-nodesensor`) | Alloy, container stdout | In the lab. Phase 0: **measured**, 1000+ lines in Loki in the last 3 h (the query cap) |
| 2 | MCP gateway (`ai-demo-mcp-gateway`) | Alloy, container stdout | In the lab. Phase 0: **measured**, 77 lines, newest 22:05Z, so quiet when idle |
| 3 | Agent gateway (`ai-demo-ping-mcpgw`, mcpgw binary) | Alloy reads its FILE log from the `ai-demo_mcpgw-logs` volume | In the lab through `docker-compose.privilege.yml`. Phase 0: **measured with the real gateway**: it was started at about 21:55Z and Loki held 934 lines at 22:51Z, split 467 `Invalid Authorization token` and 467 `authorization header missing`. Before this the path was proven only on a throwaway volume |
| 4 | Model-call gateway JSON (`LLM request`, `AIGuard`, A2A) | Not local. Hosted gateway pod log | **Not in the lab.** The 2026-11-07 capture found no LLM request line in the hosted pod log, and OpenSearch had nothing since 2026-10-26. So the doc (`GATEWAY-LOGGING-WITH-ELASTICSEARCH.md`) and the measurement disagree: UNVERIFIED which is current |
| 5 | Console audit events to SIEM (Elasticsearch / OpenSearch) | Not in the lab | The capture found console changes only in `ping-siem-events` |
| 6 | AI-DEMO2 BFF and app logs | Not in the lab | Not examined |
| 7 | Lab-proxy access lines | Alloy, container stdout | In the lab. nginx shape, not Privilege shape. Its Loki service label is `lab-proxy-lab-proxy-1`; 0 lines in the last 3 h at preflight (nothing had driven the labs) |

Phase 0 also leaves one open question: source 3 shows two request-rejection families at equal counts (467 each). Something is sending requests without a credential and with a bad one. **I have not identified what.** Find it before reading the counts as test results.

## 4. Method for every case

1. **Plant a marker** (`audit-<8 hex>`) where the case allows (a header, a prompt, the first string tool argument). Record the run id and start time.
2. **Do one action** from a named runbook, with a low-cap key and small bursts.
3. **Wait** for the source's delay (stdout: seconds; the agent gateway file log: seconds after the tail; hosted pod log: the shipper).
4. **Query Loki** by marker, then by service and time window (`{service="ping-mcpgw"} |= "audit-..."`). Fall back to the window only when the marker is absent.
5. **Assert**: line present or absent (absent is a result); shape; level; which of user, agent, tool and policy decision it names.
6. **Negative check**: the line holds no JWT, key, secret or password.
7. **Record** the result with its label, the build or image digest, and the date.

## 5. Surface matrix

Classification here is **inferred from route names and the Privilege docs**. No page source was read yet (Phase 1b). "Source" uses the numbers from section 3. "Cases" are privilege-logging-LAB ids where one fits.

### MCP and A2A

| Surface | Likely emits | Source | Cases |
|---|---|---|---|
| `/mcp-gateway`, `/mcp-gateway-oauth-flow`, `/privilege-first-gateway`, `/privilege-mcp-client` | tool calls, sign-in, 401 challenge | 3, 2, 4 | mcp-allowed-user, mcp-allowed-key, no-credential, unknown-key, malformed-token |
| `/mcp-discovery`, `/mcp-scanner`, `/mcp-inspector`, `/mcp-tools`, `/mcp-traffic`, `/mcp-observability`, `/mcp-scope-topology` | `tools/list`, discovery gating | 3, 2 | mcp-list-filtered, mcp-list-guard-blocked |
| `/demo/enterprise-mcp`, `/gateway-claims`, `/gateway-enforcement-map`, `/gateway-stats` | claims, enforcement, stats | 3, 4 | mcp-tool-not-granted, mcp-app-not-granted |
| `/agent-gateway-authorization`, `/agent-gateway-capabilities`, `/agent-gateway-inspector`, `/privileges-gateway-preview`, `/privilege-gateway-topologies`, `/privilege-mcp-diagrams`, `/privilege-mcp-learning` | mostly explanation; some probe the gateway | 3 or none | aggregate-allowed, aggregate-none |
| `/privilege-a2a`, `/ai-products/privilege-a2a`, `/a2a-architecture`, `/a2a-protocol-learning` | A2A through the gateway, guardrail ladder | 4, 3 | a2a-call |
| the dual-gateway and ChatGPT MCP flow pages (route names left out: the lab's customer-name test rejects some words in them), `/pingone-mcp-inspector` | external-agent lanes | 3, 2 | none yet |

### LLM and guardrails

| Surface | Likely emits | Source | Cases |
|---|---|---|---|
| `/llm-gateway`, `/ai-products/privilege-llm` | model calls, virtual keys, rate limit | 4 | llm-allowed, llm-model-denied, keys-rate-limited |
| `/agent-guardrails`, `/privilege-prompt-log`, `/privilege-pii-detection`, `/ai-gateway/shadow-ai-detector` | AIGuard verdicts, prompt log | 4 | llm-injection, mcp-arg-injection |

### Identity

| Surface | Likely emits | Source | Cases |
|---|---|---|---|
| `/agent-registry` | key created, rotated, revoked, expired | 5, 3 | reg-key-created, reg-key-rotated, reg-key-revoked, reg-key-expired, keys-revoked, keys-expired |
| `/privilege-pf-token`, `/cimd-privilege` | federated token checks, client documents | 3, 5 | fed-valid-token, fed-wrong-audience, fed-wrong-issuer, fed-expired-token, fed-lifetime-too-long |

### Policy and oversight

| Surface | Likely emits | Source | Cases |
|---|---|---|---|
| `/privilege-ai-policies`, `/privilege-cedar`, `/privilege-intent-triage` | Cedar and intent decisions | 3, 4 | approval-cedar-decision, intent-encoder-unreachable |
| `/privilege-coding-agents`, `/privilege-saas-access` | agent actions on hosts and SaaS | 1, 2 | none yet |
| HITL and approvals (runbook `AGENT-APPROVALS-DEMO.md`) | held, approved, denied | 3, 5 | approval-held, approval-approved, approval-denied |
| Sensor enforcement (runbook `SENSOR-ENFORCEMENT-DEMO.md`) | off, audit, enforce events | 1 | none yet |

### Platform, shelf, docs (expected to emit no Privilege line)

`/privilege-demo`, `/privilege-for-ai`, `/privilege-map`, `/privilege-shelf`, `/privilege-docs-index`, `/ai-products/gateway`, `/ai-products/privilege-mcp`. Test as negative cases: confirm opening them adds no line to sources 1 to 3.

### Out of scope for this plan

Ping Gateway pages (`/pinggateway-*`: product source not shipped), and non-Privilege MCP demo servers (`/brave-mcp`, `/weather-mcp`, `/webmcp`, `/claude-skills`).

### Standalone labs (one pass each, then compare with the matrix)

privilege-demo, privilege-map, privilege-logging, privilege-a2a-anthropic-demo, hostile-mcp, hostile-a2a, ai-gateway-client, ai-guard-sidecar, agent-kill-switch, agent-registry-demo, federated-identity, saas-access, ai-policies, mcp-discovery, mcp-gateway-lab, gateway-claims, gateway-suite, agent-gateway-inspector, jit-lab, secrets-vault, data-protection, coding-agents, agent-audit-trail, mcp-demo-client-privilege, no-tool-no-promise (all `-LAB`). Earlier measurement for most -LAB apps: stdout carries only a startup line, so expect their traffic in the lab-proxy access log (source 7), not in Privilege shapes.

## 6. Gaps in the existing case list (new cases needed)

- Sensor: off, audit and enforce modes; a blocked exec; termination.
- Tag policies, RequiredClaims scope tiers, policy union and expiry.
- Aggregate apps with a limited member set.
- Backend auth modes: None, Static Token, Pass Agent Token (403 from the gateway).
- Hostile MCP and hostile A2A, governed against ungoverned.
- Secrets Hub (view, sync, policy) and session recordings.
- MCP discovery gating, DCR and PKCE sign-in.
- Second gateway and load balancer failover.

## 7. Harness

- **Observe**: the lab's Real mode against its own Loki (already built). Use `{service=~"procyon-nodesensor|mcp-gateway|ping-mcpgw"}`.
- **Act, GET**: the existing Playwright driver in Docker, GET-only.
- **Act, POST (owner chose: scoped mode)**: extend the driver with an allow-list of **named runbook actions**, each with fixed method, path and body template; no free-form requests; a low-cap key; small bursts; loopback or the lab-proxy only. Everything not on the list stays GET-only, and `scripts/driver.test.mjs` keeps asserting that.
- **Hosted sources (4, 5)**: follow privilege-logging-LAB: a loopback `kubectl proxy` for the pod log and a configured search endpoint, with its netguard allowing only the origins you configure. A one-time SE capture was approved in principle. Repeat it only if SE is up, and say first whether the 2026-11-07 capture is already enough.

## 8. Phases

| Phase | What | Status |
|---|---|---|
| 0 | Preflight: stack up, Loki has lines for sources 1 to 3 | **Done 2026-11-07**, results in section 3 |
| 1 | Surface and source matrix | **Done, inferred classification** (section 5). 1b still to do: read each page's source to confirm what it actually calls |
| 2 | Scoped POST driver and the per-case method; run groups A to J against sources 1 to 3 | Not started |
| 3 | Sources 4 and 5: kubectl proxy and search endpoint paths; one SE capture | Not started, needs SE up and owner approval at the time |
| 4 | Fold results into the lab: replace UNVERIFIED shapes, add missing products and queries, re-run the suites | Not started |
| 5 | Report: one table of results with counts and labels | Not started |

## 9. Constraints

Low load on the live gateway. Local Docker only; the hosted SE copy is scaled down and stays that way. Alloy keeps its exact container-name filter. The shared AI-DEMO2 checkout is read-only for us (use a worktree). No secret is printed or stored. Tests run on the Air first, local when it is unreachable (it was, on 2026-11-07). GitHub work uses `curtismu7`.

## 10. Open items

1. What sends the unauthenticated and bad-token requests to the agent gateway (467 each)?
2. Is the doc claim that model calls reach Elasticsearch current, given the capture found none?
3. Phase 1b: which pages call the gateway, and which only explain?
4. Real gateway left running (`ai-demo-ping-mcpgw`) for Phase 2; stop it with `docker rm -f ai-demo-ping-mcpgw` when not needed.
