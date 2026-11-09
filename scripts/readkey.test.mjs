import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'make-read-key.sh');
const KEY = 'not-a-real-key-test-value';

// A fake Elasticsearch: answers GET / and POST /_security/api_key, records what it was sent.
async function fakeEs(status = 200) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      if (req.method === 'GET') { res.statusCode = 200; return res.end('{}'); }
      res.statusCode = status; res.setHeader('content-type', 'application/json');
      res.end(status === 200 ? JSON.stringify({ id: 'fakeId', name: 'observability-lab-reader', encoded: KEY }) : '{"error":"security_exception"}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

// Async, not spawnSync: the fake Elasticsearch lives in this process and must keep answering while the script runs.
const run = (es, file, input = 'pw"with\\odd chars\n', extra = {}) => new Promise((resolve) => {
  const c = spawn('bash', [SCRIPT], { env: { ...process.env, ES_LOCAL_URL: es.url, OBS_ENV_FILE: file, ...extra } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (x) => { stdout += x; }); c.stderr.on('data', (x) => { stderr += x; });
  c.on('close', (status) => resolve({ status, stdout, stderr }));
  c.stdin.end(input);
});
const tmpEnv = (text) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'readkey-')); const f = path.join(d, '.env'); fs.writeFileSync(f, text); return { d, f }; };

test('make-read-key.sh is valid bash', () => { assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0); });

test('make-read-key.sh: asks for READ-only access to three indexes, saves the key and the SIEM settings, never prints the key', async () => {
  const es = await fakeEs(); const { d, f } = tmpEnv('# comment\nPORT=7800\n# PRIVILEGE_SIEM_URL=http://127.0.0.1:9200\nPRIVILEGE_SIEM_READ_APIKEY=oldkey\n');
  try {
    const r = await run(es, f);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY), 'the key is never printed');
    const post = es.seen.find((s) => s.method === 'POST');
    assert.equal(post.url, '/_security/api_key');
    assert.equal(post.auth, `Basic ${Buffer.from('elastic:pw"with\\odd chars').toString('base64')}`, 'typed password, quotes and backslashes intact');
    const body = JSON.parse(post.body);
    const idx = body.role_descriptors.reader.indices;
    assert.equal(idx.length, 1);
    assert.deepEqual(idx[0].names, ['ping-siem-events-v2', 'ping-logs-*', 'demo-logs-*', 'pingone-events']);
    assert.deepEqual(idx[0].privileges, ['read', 'view_index_metadata'], 'read only: no write, create or manage');
    assert.equal(body.expiration, '30d');
    assert.equal(Object.keys(body.role_descriptors).length, 1);
    const env = fs.readFileSync(f, 'utf8');
    assert.match(env, new RegExp(`^PRIVILEGE_SIEM_READ_APIKEY=${KEY}$`, 'm'));
    assert.ok(!env.includes('oldkey'), 'the old key line is replaced');
    assert.match(env, /^PRIVILEGE_SIEM_URL=http:\/\/127\.0\.0\.1:9200$/m);
    assert.match(env, /^PRIVILEGE_SIEM_INDEX=ping-siem-events-v2$/m);
    assert.match(env, /^# PRIVILEGE_SIEM_URL=/m, 'commented example lines are left alone');
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    assert.ok(fs.readdirSync(d).some((n) => n.startsWith('.env.bak.')), 'the old file is kept');
    assert.ok(fs.readFileSync(path.join(d, fs.readdirSync(d).find((n) => n.startsWith('.env.bak.'))), 'utf8').includes('oldkey'));
  } finally { await es.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('make-read-key.sh: keeps an index you already chose, and a refused password writes nothing', async () => {
  const es = await fakeEs(); const a = tmpEnv('PRIVILEGE_SIEM_INDEX=my-index\n');
  const bad = await fakeEs(401); const b = tmpEnv('PRIVILEGE_SIEM_READ_APIKEY=oldkey\n');
  try {
    assert.equal((await run(es, a.f)).status, 0);
    assert.match(fs.readFileSync(a.f, 'utf8'), /^PRIVILEGE_SIEM_INDEX=my-index$/m);
    const r = await run(bad, b.f);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /HTTP 401 \(no key written\)/);
    assert.equal(fs.readFileSync(b.f, 'utf8'), 'PRIVILEGE_SIEM_READ_APIKEY=oldkey\n', 'the file is untouched');
    assert.deepEqual(fs.readdirSync(b.d), ['.env'], 'no backup either');
  } finally { await es.close(); await bad.close(); fs.rmSync(a.d, { recursive: true, force: true }); fs.rmSync(b.d, { recursive: true, force: true }); }
});

test('make-read-key.sh: refuses to run without an .env or an empty password, and says so', async () => {
  const es = await fakeEs();
  try {
    const noFile = await run(es, '/nonexistent/.env');
    assert.equal(noFile.status, 1); assert.match(noFile.stderr, /missing/);
    const { d, f } = tmpEnv('PORT=7800\n');
    const empty = await run(es, f, '\n');
    assert.equal(empty.status, 1); assert.match(empty.stderr, /no password given/);
    assert.equal(es.seen.filter((s) => s.method === 'POST').length, 0);
    fs.rmSync(d, { recursive: true, force: true });
  } finally { await es.close(); }
});
