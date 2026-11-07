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
