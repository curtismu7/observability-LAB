import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RUNS, WORKSPACE_RE, createWorkspaces, workspaceFrom } from '../src/workspaces.js';

test('workspaceFrom defaults, accepts a good id and refuses a bad one', () => {
  assert.equal(workspaceFrom({ headers: {} }), 'default');
  assert.equal(workspaceFrom({ headers: { 'x-workspace': 'abc-1' } }), 'abc-1');
  for (const bad of ['', 'A', 'a b', 'a/b', 'x'.repeat(41), ['a']]) assert.equal(workspaceFrom({ headers: { 'x-workspace': bad } }), null);
  assert.ok(WORKSPACE_RE.test('a'));
});

test('workspaces are isolated, runs are bounded, reset is per workspace', () => {
  const w = createWorkspaces();
  for (let i = 0; i < MAX_RUNS + 5; i++) w.record('a', { scenario: 's', decision: 'denied' });
  w.record('b', { scenario: 's', decision: 'forward' });
  assert.equal(w.runs('a').runs.length, MAX_RUNS);
  w.resetWorkspace('a');
  assert.equal(w.runs('a').runs.length, 0);
  assert.equal(w.runs('b').runs.length, 1);
});

test('incidents and the relabel switch are per workspace, survive a touch, and reset to defaults', () => {
  const w = createWorkspaces({});
  assert.equal(w.state('a').relabel, true);
  assert.deepEqual(w.state('a').injected, []);
  w.state('a').relabel = false;
  w.state('a').injected = [{ id: 'x' }];
  assert.equal(w.state('a').relabel, false);
  assert.equal(w.state('b').relabel, true);
  assert.deepEqual(w.state('b').injected, []);
  w.resetWorkspace('a');
  assert.equal(w.state('a').relabel, true);
  assert.deepEqual(w.state('a').injected, []);
});

test('the store expires old workspaces and caps their count', () => {
  let t = 0;
  const w = createWorkspaces({ max: 3, ttlMs: 100, now: () => t });
  for (const id of ['a', 'b', 'c', 'd']) w.record(id, { scenario: 's', decision: 'allow' });
  assert.equal(w.size(), 3);
  t = 500;
  assert.equal(w.runs('d').runs.length, 0);
  assert.equal(w.size(), 0);
});
