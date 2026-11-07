// Deployment configuration: the Mock/Real toggle (rule 19). Mock is the only fully-offline mode and the default.
// Real (owner-run) reads logs from ONE Loki you point it at, read-only (GET query_range). That Loki must be on
// loopback (for example the AI-DEMO2 observability profile publishes it on 127.0.0.1:3100): the lab's netguard
// refuses every non-loopback socket, so a remote Loki is reported as "not configured" with the reason, never reached.
import { isLoopbackHost } from './safety.js';

// The Loki base URL if Real is usable, else null. Only the PRESENCE and validity are ever reported, never a credential.
export function lokiUrlFrom(env = process.env) {
  const raw = env.OBS_LOKI_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
    if (!isLoopbackHost(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
}

// Why Real is unavailable, in words the toggle's tooltip can show. null when it is available.
export function realProblemFrom(env = process.env) {
  if (!env.OBS_LOKI_URL) return 'Real needs OBS_LOKI_URL (a loopback Loki, e.g. http://127.0.0.1:3100) in the settings file. Mock keeps working.';
  return lokiUrlFrom(env) ? null : 'OBS_LOKI_URL must be a plain http(s) URL on loopback (127.0.0.1 or localhost) with no credentials and no path. Mock keeps working.';
}
export const realAvailableFrom = (env = process.env) => lokiUrlFrom(env) !== null;

// The launch mode. Default: Real if configured, else Mock. The runtime mode (POST /api/mode) starts from this.
export function modeFrom(env = process.env) {
  if (env.MODE === undefined || env.MODE === '') return realAvailableFrom(env) ? 'real' : 'mock';
  const m = env.MODE;
  if (m !== 'mock' && m !== 'real') throw new Error(`MODE=${String(m).slice(0, 20)} is not available: this app has mock and real modes`);
  if (m === 'real' && !realAvailableFrom(env)) throw new Error('MODE=real requested but OBS_LOKI_URL is missing or not a loopback URL');
  return m;
}
