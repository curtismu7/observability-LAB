// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const story = buildStory(DEFAULT_CAST);
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = { 'follow-a-signin': ['trace-join'], 'login-burst': ['ratio-rule'], 'the-401-is-normal': ['ratio-rule'], 'gateway-failing': ['ratio-rule'], 'everything-went-quiet': ['relabel'], 'more-products': ['relabel'] };
  return {
    schema: 'demo-content-pack/1',
    id: 'observability-lab',
    title: 'Observability Lab',
    version,
    demo: { id: 'observability-lab', name: 'Observability Lab', catalog: 'D123', baseUrl: 'http://localhost:7800', doctor: '/api/health', tags: ['logging', 'observability', 'loki', 'alerting', 'pingfederate', 'pingone', 'gateway', 'mock-only'] },
    glossary: [
      { id: 'relabel', term: 'Service label and relabel rule', definition: 'The collector turns a container name such as /obs-demo-pingfederate into the service label pingfederate. Every query and alert uses the bare name, so a missing or wrong rule empties every panel without an error.', aliases: ['service label'] },
      { id: 'trace-join', term: 'Trace or client id as the join', definition: 'A shared id carried by every product is what lets one sign-in be followed across PingOne, PingFederate and the gateway. Without it you can only line up clocks.', aliases: ['correlation id'] },
      { id: 'ratio-rule', term: 'Ratio rule with a traffic floor', definition: 'An alert on a ratio of failures to traffic, ignored below a minimum amount of traffic, so a normal 401 or one failed probe on an idle route does not page anyone.', aliases: ['traffic floor'] },
    ],
    sources: [
      { id: 'rfc9728', title: 'RFC 9728: OAuth 2.0 Protected Resource Metadata', url: 'https://www.rfc-editor.org/rfc/rfc9728', kind: 'standard', use: 'Why a healthy MCP client starts a session with a 401 (discovery).', status: 'not-read', checked: '2026-11-07' },
      { id: 'trace-context', title: 'W3C Trace Context', url: 'https://www.w3.org/TR/trace-context/', kind: 'standard', use: 'The traceparent header shown on every hop.', status: 'not-read', checked: '2026-11-07' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Scenario ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: `/#scenario-${sc.id}` }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'concept-label-lab', label: 'The label lab', description: 'Turn the collector relabel rule off and watch every by-service query return nothing, with no error.', group: 'concept', action: { type: 'route', href: '/#label' }, terms: ['relabel'] },
      { id: 'concept-alerts', label: 'Alert rules', description: 'Three rules over the stream: a burst, a ratio with a traffic floor, and silence.', group: 'concept', action: { type: 'route', href: '/#alerts' }, terms: ['ratio-rule'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.lesson })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
