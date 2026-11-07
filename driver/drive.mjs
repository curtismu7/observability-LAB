// A headless browser that visits each lab through the lab-proxy, so the proxy writes real access-log lines.
// GET traffic only: it loads the page, reads /api/health, and clicks tabs (role=tab), which only switch views.
// It never submits a form, signs in, or sends a POST. One pass per round, with a pause between steps (low load on purpose).
import { chromium } from 'playwright';
import { baseFrom, labsFrom } from './targets.mjs';

const base = baseFrom();
const labs = labsFrom();
const rounds = Math.min(Math.max(Number(process.env.DRIVE_ROUNDS) || 1, 1), 20);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
page.setDefaultTimeout(10_000);

for (let round = 1; round <= rounds; round++) {
  for (const lab of labs) {
    const row = { round, lab, status: null, health: null, tabs: 0 };
    try {
      const res = await page.goto(`${base}/${lab}/`, { waitUntil: 'load' });
      row.status = res ? res.status() : null;
      if (row.status && row.status < 400) {
        const h = await context.request.get(`${base}/api/health`).catch(() => null);
        row.health = h ? h.status() : null;
        const tabs = page.locator('[role="tab"]');
        const n = Math.min(await tabs.count().catch(() => 0), 4);
        for (let i = 0; i < n; i++) {
          if (await tabs.nth(i).isVisible().catch(() => false)) { await tabs.nth(i).click().catch(() => {}); row.tabs++; await pause(400); }
        }
      }
    } catch (e) {
      row.error = String(e.message || e).split('\n')[0].slice(0, 120);
    }
    results.push(row);
    console.log(JSON.stringify(row));
    await pause(500);
  }
}
await browser.close();
const reached = results.filter((r) => r.status && r.status < 400).length;
console.log(JSON.stringify({ summary: true, base, rounds, labs: labs.length, reached, skipped: results.length - reached }));
process.exit(reached ? 0 : 1);
