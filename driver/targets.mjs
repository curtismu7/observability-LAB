// Which labs the driver visits, as paths on the lab-proxy. A lab that is not running answers 502/404 and is skipped.
export const DEFAULT_LABS = [
  'observability-lab', 'hitl-mfa-lab', 'delegation-lab', 'agent-kill-switch', 'no-tool-no-promise',
  'ai-guard-sidecar', 'token-workbench', 'hostile-mcp', 'agent-registry-demo', 'learning-hub', 'demo-shelf',
];

const SAFE = /^[a-z0-9][a-z0-9-]{0,40}$/;

// DRIVE_LABS="a,b" overrides the list. Anything that is not a plain lab name is dropped, so the env can never
// point the browser at another host or path.
export function labsFrom(env = process.env) {
  const raw = (env.DRIVE_LABS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return raw.length ? raw.filter((s) => SAFE.test(s)) : DEFAULT_LABS;
}

// DRIVE_BASE must be https on the proxy's own name; nothing else is accepted.
export function baseFrom(env = process.env) {
  const base = env.DRIVE_BASE || 'https://local.ping-devops.com:8443';
  const u = new URL(base);
  if (u.protocol !== 'https:' || u.hostname !== 'local.ping-devops.com') throw new Error('DRIVE_BASE must be https://local.ping-devops.com[:port]');
  return `${u.protocol}//${u.host}`;
}
