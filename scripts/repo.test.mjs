import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml', 'docs/talk-track.md', 'docs/safety.md', 'docs/shelf-entry.json', 'customer.config.example.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('the shelf entry is valid and portable: relative composeFile, loopback url, health path', () => {
  const e = JSON.parse(read('docs/shelf-entry.json')).demos[0];
  assert.equal(e.id, 'observability-lab');
  assert.equal(e.kind, 'Demo');
  assert.equal(e.healthPath, '/api/health');
  assert.match(e.url, /^http:\/\/localhost:7800$/);
  assert.ok(!path.isAbsolute(e.composeFile), 'composeFile must be relative or a placeholder');
  assert.ok(!/\/Users\//.test(JSON.stringify(e)), 'no absolute home path');
});

test('customer.config.json is git-ignored, and its example only sets the four cast values', () => {
  assert.match(read('.gitignore'), /^customer\.config\.json$/m);
  assert.deepEqual(Object.keys(JSON.parse(read('customer.config.example.json')).cast).sort(), ['agentId', 'brand', 'clientId', 'host']);
});

test('no shipped text names a real customer, company or tenant', () => {
  const skip = new Set(['node_modules', 'dist', '.git', 'package-lock.json']);
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (!['repo.test.mjs', 'story.test.js', 'content-pack.test.mjs'].some((n) => p.endsWith(n))) {
        const t = fs.readFileSync(p, 'utf8').toLowerCase();
        for (const w of ['united airlines', 'mileageplus', 'datapower', 'optum', 'unitedhealth', 'uhg', 'member benefit', 'personal-agent', 'personal agent']) if (t.includes(w)) hits.push(`${path.relative(root, p)}: ${w}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});

test('Real is documented standalone-first: own Loki and Alloy stack is the default, every other source is bring-your-own, and no other project\'s address is a default', () => {
  const readme = read('README.md'); const env = read('.env.example');
  assert.match(readme, /standalone path is this lab's own Loki and Alloy \(compose profile `stack`\)/);
  assert.match(readme, /\*\*bring your own\*\*/);
  assert.match(readme, /Privilege SIEM[^.]*bring your own/i);
  assert.match(env, /BRING YOUR OWN/);
  assert.match(env, /--profile stack up -d/);
  // The SIEM settings ship commented out: no default URL or key.
  for (const k of ['PRIVILEGE_SIEM_URL', 'PRIVILEGE_SIEM_READ_APIKEY']) assert.ok(!new RegExp(`^${k}=`, 'm').test(env), `${k} must not be set in the example`);
  assert.match(read('docs/shelf-entry.json'), /bring-your-own/);
  // No other project's ports or name in shipped code, config, compose or docs (the vendored shared CSS and the 2026-11-08 measurement record are excluded).
  const bad = /\b(3036|9031)\b|localhost:8623|AI-DEMO2|ai-demo-(?!standalone)/i;
  const files = ['README.md', '.env.example', 'CLAUDE.md', 'docker-compose.yml', 'docker-compose.privilege.yml', 'stack/alloy.alloy', 'stack/loki.yaml', 'docs/shelf-entry.json', 'docs/safety.md', 'docs/HANDOFF.md', 'docs/content-pack.schema.json', 'content-pack.json', 'server/src/config.js', 'server/src/logData.js', 'server/src/logStore.js', 'server/src/siemClient.js', 'web/src/components/Products.jsx'];
  assert.deepEqual(files.filter((f) => bad.test(read(f))), []);
});
