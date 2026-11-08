import test from 'node:test';
import assert from 'node:assert/strict';
import { lokiUrlFrom, modeFrom, realAvailableFrom, realProblemFrom } from '../src/config.js';

test('MODE defaults to Real when a loopback Loki is configured, else Mock; only mock/real accepted', () => {
  assert.equal(modeFrom({}), 'mock');
  assert.equal(modeFrom({ MODE: 'mock' }), 'mock');
  assert.throws(() => modeFrom({ MODE: 'real' }), /OBS_LOKI_URL/, 'Real requested without configuration is refused, never a silent fallback');
  const realEnv = { OBS_LOKI_URL: 'http://127.0.0.1:3100' };
  assert.equal(modeFrom(realEnv), 'real');
  assert.equal(modeFrom({ ...realEnv, MODE: 'mock' }), 'mock');
  assert.equal(modeFrom({ ...realEnv, MODE: 'real' }), 'real');
  for (const MODE of ['live', 'prod', 'Mock', 'x']) assert.throws(() => modeFrom({ ...realEnv, MODE }), /not available/, MODE);
});

test('only a plain loopback http(s) Loki URL counts: no remote host, credentials, query, hash or other scheme', () => {
  assert.equal(lokiUrlFrom({ OBS_LOKI_URL: 'http://127.0.0.1:3100' }), 'http://127.0.0.1:3100');
  assert.equal(lokiUrlFrom({ OBS_LOKI_URL: 'http://localhost:3100/' }), 'http://localhost:3100');
  assert.equal(lokiUrlFrom({ OBS_LOKI_URL: 'http://[::1]:3100' }), 'http://[::1]:3100');
  for (const bad of ['http://loki.example:3100', 'http://192.0.2.5:3100', 'http://u:p@127.0.0.1:3100', 'http://127.0.0.1:3100/?x=1', 'http://127.0.0.1:3100/#h', 'http://127.0.0.1:3100/loki', 'http://127.0.0.1:3100/x/', 'ftp://127.0.0.1', 'file:///etc/passwd', 'not a url', '']) {
    assert.equal(lokiUrlFrom({ OBS_LOKI_URL: bad }), null, bad);
    assert.equal(realAvailableFrom({ OBS_LOKI_URL: bad }), false, bad);
  }
  assert.match(realProblemFrom({}), /OBS_LOKI_URL/);
  assert.match(realProblemFrom({ OBS_LOKI_URL: 'http://loki.example:3100' }), /loopback/);
  assert.equal(realProblemFrom({ OBS_LOKI_URL: 'http://127.0.0.1:3100' }), null);
});

test('port-forward hints: placeholders by default, valid OBS_KUBE_* values appear, invalid ones fall back', async () => {
  const { ES_PORT_FORWARD, KIBANA_PORT_FORWARD, KUBE_PLACEHOLDERS, esPortForwardFrom, kibanaFrom, kibanaPortForwardFrom, kubeFrom, siemProblemFrom } = await import('../src/config.js');
  assert.deepEqual(KUBE_PLACEHOLDERS, { context: '<your-context>', namespace: '<your-namespace>' });
  assert.equal(KIBANA_PORT_FORWARD, 'kubectl --context <your-context> -n <your-namespace> port-forward svc/kibana-siem 5601:5601');
  assert.equal(ES_PORT_FORWARD, 'kubectl --context <your-context> -n <your-namespace> port-forward svc/elasticsearch-siem 9200:9200');
  assert.equal(esPortForwardFrom({}), ES_PORT_FORWARD);
  assert.equal(kibanaFrom({}).portForward, KIBANA_PORT_FORWARD);
  const env = { OBS_KUBE_CONTEXT: 'ctx-a.b_1', OBS_KUBE_NAMESPACE: 'ns-x' };
  assert.equal(kibanaPortForwardFrom(env), 'kubectl --context ctx-a.b_1 -n ns-x port-forward svc/kibana-siem 5601:5601');
  assert.equal(esPortForwardFrom(env), 'kubectl --context ctx-a.b_1 -n ns-x port-forward svc/elasticsearch-siem 9200:9200');
  assert.equal(kibanaFrom(env).portForward, kibanaPortForwardFrom(env));
  assert.ok(siemProblemFrom(env).includes(esPortForwardFrom(env)), 'the SIEM hint shows the same command');
  assert.deepEqual(kubeFrom({ OBS_KUBE_CONTEXT: 'only-ctx' }), { context: 'only-ctx', namespace: '<your-namespace>' });
  for (const bad of ['', ' ', 'a b', 'x;rm -rf /', '$(id)', '`id`', 'a/b', 'ctx\n', '<x>', 'é', 'a'.repeat(64), 42]) {
    assert.deepEqual(kubeFrom({ OBS_KUBE_CONTEXT: bad, OBS_KUBE_NAMESPACE: bad }), KUBE_PLACEHOLDERS, JSON.stringify(bad));
  }
  assert.equal(kubeFrom({ OBS_KUBE_CONTEXT: 'a'.repeat(63) }).context, 'a'.repeat(63));
});
