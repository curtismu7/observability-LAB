// One Express app. /api = health, info, the Mock/Real toggle, log queries (LogQL-lite), alert rules, incidents, the relabel switch,
// the diagram, scenarios and reset. State is per workspace id (X-Workspace) so one visitor's incident or relabel switch never
// touches another's. Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { loadCast, verticalFrom, VERTICALS } from './cast.js';
import { lokiUrlFrom, modeFrom, realAvailableFrom, realProblemFrom } from './config.js';
import { buildStory } from './story.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { RELABEL_RULE } from './logData.js';
import { INCIDENTS, incidentEvents, queryMock, toIso } from './logStore.js';
import { QueryError, formatQuery, parseQuery } from './logql.js';
import { LokiError, createLokiClient } from './lokiClient.js';
import { evaluateAlerts } from './alerts.js';
import { buildQueryHops, newTrace } from './trace.js';
import { MAX_INJECTED, createWorkspaces, workspaceFrom } from './workspaces.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');
export const DEFAULT_QUERY = '{service=~"pingone-webhook|pingfederate|ping-gateway"}';
const MIN = 60_000;

const intParam = (raw, def, min, max) => {
  if (raw === undefined) return def;
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
};

export function createApp({
  health = createHealth(), configFile = CONFIG, env = process.env, now = Date.now,
  workspaces = createWorkspaces({ now }),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  // The runtime mode (rule 19): starts from the launch mode, switches without a restart.
  let mode = modeFrom(env);
  const lokiFor = () => { const base = lokiUrlFrom(env); return base ? createLokiClient({ baseUrl: base }) : null; };

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use('/health', health.router);
  const castFor = (req) => loadCast(configFile, verticalFrom(req.query.vertical));
  // customer.config.json is read on every request so editing it shows up on reload.
  api.get('/scenarios', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...buildStory(castFor(req)), verticals: Object.keys(VERTICALS) }); });
  api.get('/diagram', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : DIAGRAM_NAMES[0])); });
  api.get('/info', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ mode, source: mode, simulated: mode === 'mock', realAvailable: realAvailableFrom(env), realHint: realAvailableFrom(env) ? null : realProblemFrom(env) });
  });
  // Rule 19: exactly { source: "mock"|"real" }; 409 when Real is not configured.
  api.post('/mode', (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !['mock', 'real'].includes(body.source)) {
      return res.status(400).json({ error: 'bad_source', detail: 'body must be exactly { source: "mock" | "real" }' });
    }
    if (body.source === 'real' && !realAvailableFrom(env)) return res.status(409).json({ error: 'real_not_configured', detail: realProblemFrom(env) });
    mode = body.source;
    return res.json({ source: mode });
  });

  const withWorkspace = (handler) => (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    res.set('Cache-Control', 'no-store');
    return handler(ws, req, res);
  };
  const mockOnly = (res) => res.status(409).json({ error: 'mock_only', detail: 'This control changes the mock stream. Switch to Mock to use it.' });
  const fail = (res, e) => {
    if (e instanceof QueryError) return res.status(400).json({ error: e.code, detail: e.detail });
    if (e instanceof LokiError) return res.status(e.status).json({ error: e.code, detail: e.detail });
    return res.status(500).json({ error: 'internal_error' });
  };

  // One query against the active source. Returns the rows (newest first) plus what the hops panel needs.
  async function runQuery({ ws, cast, q, windowMs, limit, trace }) {
    const t = now();
    if (mode === 'real') {
      const loki = lokiFor();
      if (!loki) throw new LokiError('real_not_configured', realProblemFrom(env), 409);
      const r = await loki.queryRange({ query: q, now: t, sinceMs: windowMs, limit, traceparent: trace ? `00-${trace.traceId}-${trace.span()}-01` : undefined });
      return { entries: r.entries, truncated: r.truncated, lokiRequest: r.request, lokiResponse: r.response };
    }
    const r = queryMock({ now: t, cast, state: workspaces.state(ws), q, since: t - windowMs, limit });
    return { entries: r.entries, truncated: r.truncated };
  }

  api.get('/logs', withWorkspace(async (ws, req, res) => {
    const minutes = intParam(req.query.minutes, 30, 1, 30);
    const limit = intParam(req.query.limit, 200, 1, 500);
    if (minutes === null || limit === null) return res.status(400).json({ error: 'bad_param', detail: 'minutes must be 1-30 and limit 1-500' });
    if (req.query.query !== undefined && typeof req.query.query !== 'string') return res.status(400).json({ error: 'bad_query', detail: 'query must be a single text value' });
    const queryText = req.query.query === undefined ? DEFAULT_QUERY : req.query.query;
    const trace = newTrace(req.headers.traceparent);
    try {
      const q = parseQuery(queryText);
      const r = await runQuery({ ws, cast: castFor(req), q, windowMs: minutes * MIN, limit, trace });
      const hops = buildQueryHops({ trace, queryText: formatQuery(q), source: mode, count: r.entries.length, lokiRequest: r.lokiRequest, lokiResponse: r.lokiResponse });
      res.set('traceparent', hops[0].traceparent);
      return res.json({ source: mode, query: formatQuery(q), count: r.entries.length, truncated: r.truncated, entries: r.entries.map(toIso), workspace: ws, relabel: workspaces.state(ws).relabel, traceId: trace.traceId, hops });
    } catch (e) { return fail(res, e); }
  }));

  api.get('/alerts', withWorkspace(async (ws, req, res) => {
    const cast = castFor(req);
    try {
      const rules = await evaluateAlerts({ fetch: async ({ query, windowMs }) => (await runQuery({ ws, cast, q: query, windowMs, limit: 1000 })).entries });
      return res.json({ source: mode, rules, workspace: ws });
    } catch (e) { return fail(res, e); }
  }));

  api.post('/incident', withWorkspace((ws, req, res) => {
    if (mode === 'real') return mockOnly(res);
    const name = req.body?.name;
    if (typeof name !== 'string' || !INCIDENTS.includes(name)) return res.status(400).json({ error: 'bad_incident', detail: `name must be one of ${INCIDENTS.join(', ')}` });
    const v = workspaces.state(ws);
    v.seq += 1;
    v.injected = [...v.injected, ...incidentEvents(name, now(), v.seq)].slice(-MAX_INJECTED);
    workspaces.record(ws, { action: 'incident', name });
    return res.json({ injected: name, workspace: ws });
  }));

  api.get('/relabel', withWorkspace((ws, _req, res) => res.json({ enabled: workspaces.state(ws).relabel, rule: RELABEL_RULE, workspace: ws })));
  api.post('/relabel', withWorkspace((ws, req, res) => {
    if (mode === 'real') return mockOnly(res);
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'bad_request', detail: 'body.enabled must be true or false' });
    workspaces.state(ws).relabel = req.body.enabled;
    workspaces.record(ws, { action: 'relabel', enabled: req.body.enabled });
    return res.json({ enabled: req.body.enabled, workspace: ws });
  }));

  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  // Reset clears this workspace's incidents, relabel switch and actions (the mode stays).
  api.post('/reset', withWorkspace((ws, _req, res) => {
    workspaces.resetWorkspace(ws);
    res.json({ reset: 'ok', workspace: ws });
  }));
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // Errors become short JSON. Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
