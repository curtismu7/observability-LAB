import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CAST, VERTICALS, loadCast, unfilled } from '../src/cast.js';
import { buildStory, rawStory, renderTalkTrackMarkdown } from '../src/story.js';
import { parseQuery } from '../src/logql.js';
import { ALERT_RULES, FACTS, PRODUCTS, SCENARIOS } from '../src/logData.js';
import { evaluateAlerts } from '../src/alerts.js';

test('every {{token}} in the story is defined in every vertical pack', () => {
  const text = JSON.stringify(rawStory());
  for (const [name, cast] of Object.entries(VERTICALS)) assert.deepEqual(unfilled(text, cast), [], name);
  assert.ok(!JSON.stringify(buildStory(DEFAULT_CAST)).includes('{{'));
});

test('docs/talk-track.md is exactly what the data generates (no drift)', () => {
  const doc = fs.readFileSync(new URL('../../docs/talk-track.md', import.meta.url), 'utf8');
  assert.equal(doc, renderTalkTrackMarkdown(DEFAULT_CAST));
});

test('every scenario query parses under LogQL-lite once the cast is filled, and names a known alert if it expects one', () => {
  const ids = new Set(ALERT_RULES.map((r) => r.id));
  for (const cast of Object.values(VERTICALS)) {
    for (const sc of buildStory(cast).scenarios) {
      assert.doesNotThrow(() => parseQuery(sc.query), sc.id);
      for (const k of ['alertFiring', 'alertQuiet']) if (sc.expect?.[k]) assert.ok(ids.has(sc.expect[k]), `${sc.id}: ${sc.expect[k]}`);
    }
  }
  assert.ok(SCENARIOS.length >= 5);
});

test('honesty: every fact and every product source carries a status; measured claims name their source file', () => {
  const ok = new Set(['measured', 'inferred', 'UNVERIFIED']);
  for (const f of FACTS) { assert.ok(ok.has(f.status), f.id); if (f.status === 'measured') assert.match(f.text, /AI-DEMO2 [\w/.-]+/, `${f.id} names a source`); }
  for (const p of PRODUCTS) for (const s of p.sources) { assert.ok(ok.has(s.status), `${p.id}/${s.id}`); if (s.status === 'measured') assert.match(s.note, /AI-DEMO2 [\w/.-]+/, `${p.id}/${s.id} names a source`); }
  const unverified = [...FACTS, ...PRODUCTS.flatMap((p) => p.sources)].filter((x) => x.status === 'UNVERIFIED');
  assert.ok(unverified.length >= 3, 'line shapes stay labelled UNVERIFIED');
});

test('every alert rule the engine returns is described in the story data, in the same order', async () => {
  const rules = await evaluateAlerts({ fetch: async () => [] });
  assert.deepEqual(rules.map((r) => r.id), ALERT_RULES.map((r) => r.id));
});

test('customer.config can only set the four cast values, as short plain text with no host or markup', () => {
  const file = new URL('../../.tmp-cast.json', import.meta.url).pathname;
  fs.writeFileSync(file, JSON.stringify({ cast: { brand: 'Acme https://evil.example/x', agentId: 'Bad Id!', clientId: 'ok-client', host: 'a@b.c', other: 'x' } }));
  try {
    const cast = loadCast(file);
    assert.equal(cast.castBrand, VERTICALS.retail.castBrand, 'a brand with a URL is ignored');
    assert.equal(cast.castAgentId, VERTICALS.retail.castAgentId);
    assert.equal(cast.castClientId, 'ok-client');
    assert.equal(cast.castHost, VERTICALS.retail.castHost);
  } finally { fs.rmSync(file, { force: true }); }
});
