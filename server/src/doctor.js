// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import { assertBindAllowed, bindHost, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { DEFAULT_CAST, VERTICALS, unfilled } from './cast.js';
import { buildStory, rawStory } from './story.js';
import { modeFrom, realAvailableFrom } from './config.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { parseQuery } from './logql.js';
import { incidentEvents, queryMock } from './logStore.js';
import { evaluateAlerts } from './alerts.js';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

// Runs one scenario on a fresh mock workspace and reports whether it teaches what it says it does.
export async function checkScenario(sc, cast = DEFAULT_CAST) {
  const state = { injected: [], relabel: true };
  if (sc.action?.kind === 'incident') state.injected = incidentEvents(sc.action.name, NOW, 1);
  if (sc.action?.kind === 'relabel') state.relabel = sc.action.enabled;
  const q = parseQuery(sc.query.replace(/\{\{(\w+)\}\}/g, (m, k) => cast[k] ?? m));
  const rows = queryMock({ now: NOW, cast, state, q, since: NOW - 30 * 60_000, limit: 500 }).entries;
  const rules = await evaluateAlerts({ fetch: async ({ query, windowMs }) => queryMock({ now: NOW, cast, state, q: query, since: NOW - windowMs, limit: 1000 }).entries });
  const byId = Object.fromEntries(rules.map((r) => [r.id, r.state]));
  const e = sc.expect || {};
  const problems = [];
  if (e.minProducts !== undefined && new Set(rows.map((r) => r.product)).size < e.minProducts) problems.push(`fewer than ${e.minProducts} products in the result`);
  if (e.minProducts === 0 && rows.length !== 0) problems.push('expected an empty result');
  if (e.alertFiring && byId[e.alertFiring] !== 'firing') problems.push(`${e.alertFiring} does not fire`);
  if (e.alertQuiet && byId[e.alertQuiet] !== 'ok') problems.push(`${e.alertQuiet} fires but should be quiet`);
  return problems;
}

export async function runChecks({ env = process.env, cast = DEFAULT_CAST } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `v${process.versions.node} (need >= 20)`);

  try { add('mode', 'pass', `mode=${modeFrom(env)}${realAvailableFrom(env) ? ' (Real configured)' : ' (Mock only)'}`); }
  catch (e) { add('mode', 'fail', e.message); }

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.OBS_BIND ? ' (OBS_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is the allocated port ${PORT_MIN} and not reserved`);

  const raw = rawStory();
  const wrong = [];
  for (const sc of raw.scenarios) {
    try { const p = await checkScenario(sc, cast); if (p.length) wrong.push(`${sc.id} (${p.join('; ')})`); } catch (e) { wrong.push(`${sc.id} (${e.message})`); }
  }
  add('scenarios', raw.scenarios.length >= 5 && !wrong.length ? 'pass' : 'fail', wrong.length ? `scenarios that do not teach what they claim: ${wrong.join(', ')}` : `${raw.scenarios.length} scenarios each behave as their lesson says`);
  const facts = raw.facts.filter((f) => !['measured', 'inferred', 'UNVERIFIED'].includes(f.status));
  add('facts-labelled', facts.length ? 'fail' : 'pass', facts.length ? 'a fact has no status label' : 'every fact is labelled measured, inferred or UNVERIFIED');
  const text = JSON.stringify([raw]);
  const holes = unfilled(text, DEFAULT_CAST);
  add('story-tokens', holes.length ? 'fail' : 'pass', holes.length ? `unfilled {{tokens}}: ${[...new Set(holes)].join(', ')}` : 'every {{cast}} token is filled');
  const badVert = Object.entries(VERTICALS).filter(([, v]) => unfilled(text, v).length).map(([k]) => k);
  add('verticals', badVert.length ? 'fail' : 'pass', badVert.length ? `verticals missing a token: ${badVert.join(', ')}` : `${Object.keys(VERTICALS).length} vertical packs fill every token`);

  const filled = JSON.stringify([buildStory(cast)]);
  const hosts = scanHosts(filled);
  add('story-hosts', hosts.length ? 'fail' : 'pass', hosts.length ? `non-reserved hosts: ${hosts.join(', ')}` : 'every host in the story is .invalid or .example');
  const keys = scanKeys(filled);
  add('story-keys', keys.length ? 'fail' : 'pass', keys.length ? 'key-looking values that are not sk-MOCK-' : 'no key-looking values in the story');
  add('diagrams', DIAGRAM_NAMES.every((n) => buildDiagram(cast, n).steps.length > 0) ? 'pass' : 'fail', `${DIAGRAM_NAMES.length} diagram-studio/1 diagram loads and validates`);

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);

  add('tenant', 'pass', 'mock needs no tenant or credentials and makes no outbound network call; Real reads one loopback Loki, read-only');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
