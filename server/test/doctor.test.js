import test from 'node:test';
import assert from 'node:assert/strict';
import { allPassed, runChecks } from '../src/doctor.js';
import { DEFAULT_CAST } from '../src/cast.js';

test('every doctor check passes on a clean default environment', async () => {
  const checks = await runChecks({ env: {} });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  for (const id of ['node', 'bind', 'port-range', 'scenarios', 'facts-labelled', 'story-tokens', 'verticals', 'diagrams', 'story-hosts', 'story-keys', 'netguard', 'tenant']) {
    assert.ok(checks.some((c) => c.id === id), id);
  }
});

test('a port other than 7800 fails, and a wildcard bind needs the opt-in', async () => {
  assert.equal((await runChecks({ env: { PORT: '5010' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '7800', OBS_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass');
});

test('MODE other than mock/real fails the doctor, and Real without a loopback Loki is refused', async () => {
  assert.equal((await runChecks({ env: { MODE: 'live' } })).find((c) => c.id === 'mode').level, 'fail');
  assert.equal((await runChecks({ env: { MODE: 'real' } })).find((c) => c.id === 'mode').level, 'fail');
  assert.equal((await runChecks({ env: { MODE: 'real', OBS_LOKI_URL: 'http://loki.example:3100' } })).find((c) => c.id === 'mode').level, 'fail', 'a remote Loki is never reached');
  const real = (await runChecks({ env: { OBS_LOKI_URL: 'http://127.0.0.1:3100' } })).find((c) => c.id === 'mode');
  assert.equal(real.level, 'pass');
  assert.match(real.detail, /mode=real.*Real configured/);
});

test('a scenario that stops teaching its lesson is caught by the doctor', async () => {
  const { checkScenario } = await import('../src/doctor.js');
  const sc = { query: '{service="pingfederate"}', action: null, expect: { alertFiring: 'FailedLoginBurst' } };
  assert.deepEqual(await checkScenario({ ...sc, expect: { alertFiring: 'FailedLoginBurst' } }), ['FailedLoginBurst does not fire']);
  assert.deepEqual(await checkScenario({ ...sc, expect: { alertQuiet: 'FailedLoginBurst' } }), []);
});

test('the doctor host scan catches a real host in the story', async () => {
  const bad = { ...DEFAULT_CAST, castBrand: 'Acme https://acme-airlines.com/x' };
  const hosts = (await runChecks({ env: {}, cast: bad })).find((c) => c.id === 'story-hosts');
  assert.equal(hosts.level, 'fail');
  assert.match(hosts.detail, /acme-airlines\.com/);
  assert.equal((await runChecks({ env: {} })).find((c) => c.id === 'story-hosts').level, 'pass');
});
