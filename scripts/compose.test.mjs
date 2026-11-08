import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { portProblem } from '../server/src/safety.js';

// Every published port must be bound to loopback on the host. A small line parser (no YAML dependency).
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}
const here = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('docker-compose.yml publishes only on 127.0.0.1', () => {
  const ports = publishedPorts(here('docker-compose.yml'));
  assert.ok(ports.length > 0, 'the parser found the published port');
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `${p} must start with 127.0.0.1:`);
});

test('the parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "7800:7800"', '- "0.0.0.0:7800:7800"', '- 7800', '- "::1:7800:7800"']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});

test('compose default host port and Dockerfile port are allowed ports and agree', () => {
  const compose = here('docker-compose.yml');
  const host = Number(/\$\{HOST_PORT:-(\d+)\}/.exec(compose)[1]);
  assert.equal(portProblem(host), null);
  const docker = here('Dockerfile');
  const port = Number(/^EXPOSE (\d+)/m.exec(docker)[1]);
  assert.equal(portProblem(port), null);
  assert.match(compose, new RegExp(`:${port}"`));
  assert.match(docker, /^ENV OBS_BIND=0\.0\.0\.0$/m);
  assert.match(docker, /^USER node$/m);
});

test('the container is locked down: read-only fs, no capabilities, no new privileges', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
});

test('the stack profile adds no published port, shares the lab network namespace and is locked down', () => {
  const compose = here('docker-compose.yml');
  const block = (name) => new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)+)`, 'm').exec(compose)?.[1] ?? '';
  for (const name of ['loki', 'alloy', 'driver']) {
    const b = block(name);
    assert.ok(b, `${name} service exists`);
    assert.doesNotMatch(b, /^    ports:/m, `${name} publishes nothing`);
    assert.match(b, /read_only: true/);
    assert.match(b, /cap_drop: \[ALL\]/);
    assert.match(b, /no-new-privileges:true/);
  }
  for (const name of ['loki', 'alloy']) {
    assert.match(block(name), /network_mode: "service:observability-lab"/, `${name} shares the lab's network namespace`);
    assert.match(block(name), /image: grafana\/(loki:3\.3\.2|alloy:v1\.19\.2)\n/, `${name} image is pinned to a version`);
    assert.match(block(name), /profiles: \["stack"\]/);
  }
  assert.match(block('alloy'), /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/, 'the Docker socket is read-only');
  assert.match(block('driver'), /profiles: \["drive"\]/);
});

test('Loki and Alloy make no outbound calls of their own and listen on loopback', () => {
  assert.match(here('stack/loki.yaml'), /reporting_enabled: false/);
  assert.match(here('stack/loki.yaml'), /http_listen_address: 127\.0\.0\.1/);
  assert.match(here('docker-compose.yml'), /--disable-reporting/);
  assert.match(here('docker-compose.yml'), /--server\.http\.listen-addr=127\.0\.0\.1:12345/);
  assert.match(here('stack/alloy.alloy'), /url = "http:\/\/127\.0\.0\.1:3100\//);
});

test('Privilege sources: stdout containers are filtered by exact name, the gateway file is read-only, tailed from the end and filtered', () => {
  const alloy = here('stack/alloy.alloy');
  for (const name of ['lab-proxy-lab-proxy-1', 'procyon-nodesensor', 'ai-demo-mcp-gateway', 'ai-demo-pingfederate', 'ai-demo-ping-gateway', 'ai-demo-llm-proxy', 'ai-demo-authz-server', 'ai-demo-mcp-server', 'ai-demo-mcp-weather', 'ai-demo-hitl-service']) assert.match(alloy, new RegExp(`"\\^/\\?${name}\\$"`), `${name} is matched exactly`);
  assert.match(alloy, /\(\?:ai-demo-\)\?/, 'service drops the ai-demo- prefix, as AI-DEMO2 does');
  assert.match(alloy, /tail_from_end = true/, 'the gateway file holds days of history; only new lines are shipped');
  assert.match(alloy, /stage\.match[\s\S]*action\s*=\s*"drop"/, 'lines outside the four modelled families are dropped');
  assert.match(alloy, /Error receiving from the stream\|\[\[\]SERVER\[\]\]/, 'the [SERVER] request lines (User-Agent, Remote Addr) are kept');
  // Alloy hands the selector to LogQL after River unescapes it, so any backslash other than \" breaks the load (measured 2026-11-08:
  // "invalid char escape", container exits). Square brackets are matched with character classes instead.
  const selector = /selector\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(alloy.split('loki.process "privilege"')[1])[1];
  assert.doesNotMatch(selector.replace(/\\"/g, ''), /\\/, 'no backslash escapes inside the match selector');
  assert.match(alloy, /older_than\s*=\s*"15m"/, 'a restart does not replay old container history into Loki');
  assert.match(alloy, /stage\.limit[\s\S]*drop\s*=\s*true/, 'one noisy container cannot fill the small Loki');
  assert.match(alloy, /stage\.replace[\s\S]*expression\s*=\s*"\(\\\\x1b[^"]*\)"/, 'terminal colour codes are stripped before Loki, and the pattern is one capture group (stage.replace only replaces what a group matched)');
  const limit = /stage\.limit \{([^}]*)\}/.exec(alloy)[1];
  assert.doesNotMatch(limit, /drop_counter_reason/, 'stage.limit has no drop_counter_reason (only stage.drop does): Alloy refuses the file and the container exits');
  const priv = here('docker-compose.privilege.yml');
  assert.match(priv, /privilege-logs:\/privilege-logs:ro/, 'the gateway log volume is mounted read-only');
  assert.match(priv, /external: true/, 'the volume belongs to AI-DEMO2; this lab never creates it');
  assert.doesNotMatch(priv, /^\s*ports:/m);
});

test('the siem profile: a loopback-only forwarder in the lab namespace, locked down, pinned, no host port, no logging flags', () => {
  const compose = here('docker-compose.yml');
  const b = new RegExp('^  siem-forwarder:\\n((?:    .*\\n|\\n)+)', 'm').exec(compose)?.[1] ?? '';
  assert.ok(b, 'siem-forwarder service exists');
  assert.match(b, /image: alpine\/socat:\d+\.\d+\.\d+\.\d+\n/, 'pinned to an exact version');
  assert.match(b, /profiles: \["siem"\]/);
  assert.match(b, /network_mode: "service:observability-lab"/);
  assert.doesNotMatch(b, /^    ports:/m);
  assert.match(b, /"TCP-LISTEN:9200,bind=127\.0\.0\.1,fork,reuseaddr"/, 'listens on loopback only inside the namespace');
  assert.match(b, /"TCP:host\.docker\.internal:9200"/);
  assert.doesNotMatch(b, /"-[dvx]/, 'no socat debug or verbose flags (they would print the traffic)');
  for (const re of [/read_only: true/, /cap_drop: \[ALL\]/, /no-new-privileges:true/, /mem_limit: \d+m/, /user: "65534:65534"/]) assert.match(b, re);
});

test('the SIEM and link settings are passed through from the shell, with no committed value', () => {
  const compose = here('docker-compose.yml');
  for (const name of ['PRIVILEGE_SIEM_URL', 'PRIVILEGE_SIEM_INDEX', 'PRIVILEGE_SIEM_READ_APIKEY', 'PRIVILEGE_KIBANA_URL', 'PRIVILEGE_LOGGING_LAB_URL', 'FIELD_NOTES_URL']) {
    assert.match(compose, new RegExp(`^      ${name}: \\$\\{${name}:-\\}$`, 'm'), `${name} defaults to empty`);
  }
});

test('start mode: compose replaces the image MODE=mock with OBS_MODE, empty when unset, so a configured Real starts in Real', async () => {
  const compose = here('docker-compose.yml');
  const lab = new RegExp('^  observability-lab:\\n((?:    .*\\n|\\n)+)', 'm').exec(compose)?.[1] ?? '';
  assert.match(lab, /^      MODE: \$\{OBS_MODE:-\}$/m, 'MODE comes from OBS_MODE with an empty default');
  assert.match(here('Dockerfile'), /^ENV .*\bMODE=mock\b/m, 'the image default stays mock (rule 19) for a plain docker run');
  // What the container sees with OBS_MODE unset: an empty MODE, which config.js treats like unset.
  const { modeFrom } = await import('../server/src/config.js');
  assert.equal(modeFrom({ MODE: '' }), 'mock', 'no Real settings: Mock');
  assert.equal(modeFrom({ MODE: '', OBS_LOKI_URL: 'http://127.0.0.1:3100' }), 'real', 'Real settings: Real');
  assert.equal(modeFrom({ MODE: 'mock', OBS_LOKI_URL: 'http://127.0.0.1:3100' }), 'mock', 'the image default alone would have forced Mock');
});

test('the kube context and namespace for the port-forward hints pass through with empty defaults', () => {
  const compose = here('docker-compose.yml');
  for (const name of ['OBS_KUBE_CONTEXT', 'OBS_KUBE_NAMESPACE']) {
    assert.match(compose, new RegExp(`^      ${name}: \\$\\{${name}:-\\}$`, 'm'), `${name} defaults to empty`);
  }
});
