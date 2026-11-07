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
