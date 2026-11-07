import http from 'node:http';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';

// env: the settings the app sees (never process.env, so a developer's real OBS_LOKI_URL cannot leak into a test).
export async function withServer(fn, { configFile = '/nonexistent/customer.config.json', env = {}, now } = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, configFile, env, ...(now ? { now } : {}) }) });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}

export const post = (url, path, body, headers = {}) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: JSON.stringify(body) });

// A fake Loki on loopback. handler(req, res) answers; returns { base, close, requests }.
export async function fakeLoki(handler) {
  const requests = [];
  const server = http.createServer((req, res) => { requests.push({ url: req.url, headers: req.headers, method: req.method }); handler(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
