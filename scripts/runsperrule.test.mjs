import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kibana-runs-per-rule.py');
const tile = (id, title, x) => ({ type: 'lens', title, panelIndex: id, gridData: { i: id, x, y: 7, w: 10, h: 8 }, embeddableConfig: { attributes: { visualizationType: 'lnsLegacyMetric', title: '', state: { visualization: {}, datasourceStates: {}, filters: [{ meta: { index: 'abc-uuid' }, query: {} }] }, references: [] } } });
const MANAGED = {
  attributes: {
    title: '[Elastic Security] Detection rule monitoring', description: 'managed',
    panelsJSON: JSON.stringify([
      { type: 'visualization', panelIndex: 'hdr', gridData: { i: 'hdr', x: 0, y: 0, w: 48, h: 7 }, embeddableConfig: { savedVis: { params: { markdown: '* This Kibana-managed dashboard can not be customized. To make a custom version, clone it or edit and save it as a new dashboard.' } } } },
      tile('t1', 'Enabled rules', 0), tile('t2', 'Rule executions', 10), tile('t3', '"Succeeded" statuses', 20),
      { type: 'lens', title: 'Executions by status', panelIndex: 'c1', gridData: { i: 'c1', x: 0, y: 24, w: 21, h: 13 }, embeddableConfig: {} },
    ]),
    kibanaSavedObjectMeta: { searchSourceJSON: '{}' },
  },
  references: [{ id: 'kibana-event-log-data-view', name: 't2:indexpattern-datasource-layer-x', type: 'index-pattern' }],
};

async function fakeKibana({ writeStatus = 200 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, xsrf: req.headers['kbn-xsrf'], body });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') { res.statusCode = 200; return res.end(JSON.stringify(MANAGED)); }
      res.statusCode = writeStatus; res.end(writeStatus === 200 ? '{"id":"x"}' : '{"message":"Unable to create dashboard"}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

// getpass would talk to the terminal, so the tests use the Secret path with a fake kubectl that prints a base64 password.
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

test('kibana-runs-per-rule.py saves a COPY with a per-rule row under the top boxes and never touches the managed dashboard', async () => {
  const k = await fakeKibana(); const bin = fakeKubectl();
  try {
    const r = await run(k, bin);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Saved\. Open it: .*detection-rule-monitoring-runs-per-rule/);
    assert.ok(!r.stdout.includes('s3cret') && !r.stderr.includes('s3cret'), 'the password is never printed');
    const writes = k.seen.filter((s) => s.method !== 'GET');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'POST');
    assert.equal(writes[0].url, '/api/saved_objects/dashboard/detection-rule-monitoring-runs-per-rule?overwrite=true', 'a new id, not the managed one');
    assert.equal(writes[0].auth, `Basic ${Buffer.from('elastic:s3cret"pw').toString('base64')}`);
    assert.equal(writes[0].xsrf, '1');
    const body = JSON.parse(writes[0].body);
    assert.equal(body.attributes.title, 'Detection rule monitoring (runs per rule)');
    const panels = JSON.parse(body.attributes.panelsJSON);
    const row = panels.find((p) => p.title === 'Rules: runs, speed and alerts');
    assert.deepEqual(row.gridData, { i: row.panelIndex, x: 0, y: 15, w: 48, h: 8 }, 'directly under the top boxes, full width');
    const a = row.embeddableConfig.attributes;
    assert.equal(a.visualizationType, 'lnsDatatable', 'one table listing every rule, not one box per rule');
    assert.equal(a.state.visualization.columns[0].width, 420, 'the Rule column is wide enough for the longest rule name');
    assert.equal(a.state.visualization.columns[1].width, undefined, 'the number columns keep their default width');
    assert.equal(a.state.visualization.paging.enabled, false, 'every rule shows; the table scrolls instead of paging');
    const header = JSON.stringify(panels.find((p) => p.panelIndex === 'hdr'));
    assert.ok(!header.includes('can not be customized') && header.includes('This is a copy of the managed dashboard'), 'the header note describes the copy');
    const layer = Object.values(a.state.datasourceStates.formBased.layers)[0];
    const cols = Object.values(layer.columns);
    const RUN = 'kibana.alert.rule.execution.metrics.total_run_duration_ms';
    assert.deepEqual(cols.map((c) => `${c.operationType}:${c.sourceField}`).sort(), [`average:${RUN}`, 'count:___records___', 'max:@timestamp', `max:${RUN}`, 'sum:kibana.alert.rule.execution.metrics.alert_counts.new', 'terms:rule.name'].sort());
    assert.deepEqual(cols.map((c) => c.label), ['Rule', 'Runs', 'Avg run (ms)', 'Slowest run (ms)', 'New alerts', 'Last run'], 'plain column names, in reading order');
    assert.deepEqual(a.state.visualization.columns.map((c) => c.columnId), layer.columnOrder, 'every column is shown, in order');
    assert.equal(panels.find((p) => p.panelIndex === 'c1').gridData.y, 32, 'the panels below move down by the new row');
    assert.equal(panels.find((p) => p.panelIndex === 't2').gridData.y, 7, 'the top boxes stay where they were');
    assert.ok(body.references.some((x) => x.name === `${row.panelIndex}:indexpattern-datasource-layer-${Object.keys(a.state.datasourceStates.formBased.layers)[0]}`));
    assert.ok(JSON.stringify(a.state.filters).includes('kibana-event-log-data-view') && !JSON.stringify(a.state.filters).includes('abc-uuid'), 'saved filters point at the data view the references resolve');
  } finally { await k.close(); fs.rmSync(bin, { recursive: true, force: true }); }
});

test('kibana-runs-per-rule.py: when Kibana refuses the write it says nothing was saved and exits non-zero', async () => {
  const k = await fakeKibana({ writeStatus: 403 }); const bin = fakeKubectl();
  try {
    const r = await run(k, bin);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refused to save the copy \(HTTP 403\); nothing was saved/);
  } finally { await k.close(); fs.rmSync(bin, { recursive: true, force: true }); }
});
