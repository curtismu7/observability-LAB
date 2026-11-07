// Mock alert rules over whatever source is active. The ratio-plus-traffic-floor idea comes from AI-DEMO2 monitoring/alerts.yml (its door rule
// uses a 4xx ratio; this lab applies the idea to 5xx as its own design), plus a lab-own silence rule. Each rule reads entries through `fetch({ query, windowMs })`, so it runs the same over the mock store or Real.
import { parseQuery } from './logql.js';
import { SERVICES } from './logStore.js';
import { ALERT_RULES } from './logData.js';

const MIN = 60_000;
export const THRESHOLDS = { loginFailures: 5, loginWindowMs: 5 * MIN, gatewayRatio: 0.5, gatewayFloor: 10, gatewayWindowMs: 5 * MIN, silenceWindowMs: 10 * MIN };

const meta = (id) => ALERT_RULES.find((r) => r.id === id);
const result = (id, firing, summary, evidence, query) => ({ id, title: meta(id).title, lesson: meta(id).lesson, state: firing ? 'firing' : 'ok', summary, evidence, query });

export async function evaluateAlerts({ fetch }) {
  const out = [];

  const failQ = '{service="pingfederate"} |= "FAILURE"';
  const fails = (await fetch({ query: parseQuery(failQ), windowMs: THRESHOLDS.loginWindowMs })).length;
  out.push(result('FailedLoginBurst', fails >= THRESHOLDS.loginFailures,
    `${fails} failed sign-ins in 5 minutes (threshold ${THRESHOLDS.loginFailures})`,
    { failures: fails, threshold: THRESHOLDS.loginFailures, windowMinutes: 5 }, failQ));

  const totalQ = '{service="ping-gateway"} |= "route=/mcp"';
  const badQ = '{service="ping-gateway"} |= "route=/mcp" |~ "status=502|status=503|status=504"';
  const total = (await fetch({ query: parseQuery(totalQ), windowMs: THRESHOLDS.gatewayWindowMs })).length;
  const bad = (await fetch({ query: parseQuery(badQ), windowMs: THRESHOLDS.gatewayWindowMs })).length;
  const ratio = total ? bad / total : 0;
  const gwFiring = total >= THRESHOLDS.gatewayFloor && ratio >= THRESHOLDS.gatewayRatio;
  out.push(result('GatewayMostlyRejecting', gwFiring,
    total < THRESHOLDS.gatewayFloor ? `${total} requests in 5 minutes: under the traffic floor of ${THRESHOLDS.gatewayFloor}, so no ratio is judged` : `${bad} of ${total} requests were 5xx (${Math.round(ratio * 100)}%, threshold ${THRESHOLDS.gatewayRatio * 100}%)`,
    { total, serverErrors: bad, ratio: Number(ratio.toFixed(2)), floor: THRESHOLDS.gatewayFloor, threshold: THRESHOLDS.gatewayRatio }, badQ));

  const silent = [];
  for (const service of Object.values(SERVICES)) {
    const n = (await fetch({ query: parseQuery(`{service="${service}"}`), windowMs: THRESHOLDS.silenceWindowMs })).length;
    if (n === 0) silent.push(service);
  }
  out.push(result('ProductLogSilence', silent.length > 0,
    silent.length ? `No lines in 10 minutes for: ${silent.join(', ')}` : 'Every product has logged in the last 10 minutes',
    { silentServices: silent, windowMinutes: 10 }, '{service="<each product>"}'));
  return out;
}
