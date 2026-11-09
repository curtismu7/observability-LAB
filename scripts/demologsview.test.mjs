import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kibana-demo-logs-view.py');
async function fakeKibana(status = 200) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, xsrf: req.headers['kbn-xsrf'], body }); res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(status === 200 ? '{"id":"demo-logs"}' : '{"message":"forbidden"}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}
// getpass would talk to the terminal, so the tests use the Secret path with a fake kubectl.
function fakeKubectl() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kubectl-'));
  fs.writeFileSync(path.join(d, 'kubectl'), `#!/bin/sh\nprintf '%s' '${Buffer.from('s3cret"pw').toString('base64')}'\n`, { mode: 0o755 });
  return d;
}
const run = (k, bin) => new Promise((resolve) => {
  const c = spawn('python3', [SCRIPT], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KIBANA_URL: k.url, ES_SECRET: 'x', ES_SECRET_KEY: 'k' } });
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (x) => { stdout += x; }); c.stderr.on('data', (x) => { stderr += x; });
  c.on('close', (status) => resolve({ status, stdout, stderr }));
});

test('kibana-demo-logs-view.py saves one data view over demo-logs-* with the time field, overwriting the same id, never printing the password', async () => {
  const k = await fakeKibana(); const bin = fakeKubectl();
  try {
    const r = await run(k, bin);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(k.seen.length, 1);
    const s = k.seen[0];
    assert.equal(s.method, 'POST'); assert.equal(s.url, '/api/saved_objects/index-pattern/demo-logs?overwrite=true');
    assert.equal(s.auth, `Basic ${Buffer.from('elastic:s3cret"pw').toString('base64')}`); assert.equal(s.xsrf, '1');
    assert.deepEqual(JSON.parse(s.body).attributes, { title: 'demo-logs-*', name: 'Demo logs (AI-DEMO2 and lab containers)', timeFieldName: '@timestamp' });
    assert.match(r.stdout, /dataViewId:'demo-logs'/);
    assert.ok(!r.stdout.includes('s3cret') && !r.stderr.includes('s3cret'));
  } finally { await k.close(); fs.rmSync(bin, { recursive: true, force: true }); }
});

test('kibana-demo-logs-view.py: a refused write exits 1 and says nothing was saved', async () => {
  const k = await fakeKibana(403); const bin = fakeKubectl();
  try {
    const r = await run(k, bin);
    assert.equal(r.status, 1); assert.match(r.stderr, /refused to save the data view \(HTTP 403\); nothing was saved/);
  } finally { await k.close(); fs.rmSync(bin, { recursive: true, force: true }); }
});
