import { fileURLToPath } from 'node:url';
import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { modeFrom, realAvailableFrom } from './config.js';

installNetguard(); // before anything else can open a socket

try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env */ }

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[observability-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
console.log(`[observability-lab] starting in ${modeFrom()} mode`);
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp() });
console.log(`[observability-lab] lab at ${url} (loopback${realAvailableFrom() ? ', Real configured (read-only loopback Loki)' : ', Mock only — no outbound network'})`);
console.log(`[observability-lab] health: ${url}api/health`);
