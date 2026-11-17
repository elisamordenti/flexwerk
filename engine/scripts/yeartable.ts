/**
 * Full-year results table: every example site × every strategy × both forecast modes.
 * Writes app/public/data/results_year.json (shown in the app) and prints a table.
 *   npx tsx scripts/yeartable.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLES, simulate, loadSolver, type SimResult } from '../src/index';
import { loadData, loadTariff } from '../tests/helpers';

const data = loadData(), tariff = loadTariff();
let solver = await loadSolver();
const YEAR = { startStep: 0, steps: data.n };
// placeholder wear cost (DECISIONS D-022), the same number the MPC plans with, applied to every strategy
const WEAR_EUR_PER_KWH = 78 / 1000;
const row = (r: SimResult, base: SimResult) => ({
  costEur: Math.round(r.bill.total), savingEur: Math.round(base.bill.total - r.bill.total),
  dischargeMWh: +(r.battery.dischargeKWh / 1000).toFixed(1),
  wearEur: Math.round(r.battery.dischargeKWh * WEAR_EUR_PER_KWH),
  savingAfterWearEur: Math.round(base.bill.total - r.bill.total - r.battery.dischargeKWh * WEAR_EUR_PER_KWH),
  peakKW: +r.bill.peakKW.toFixed(1), peakChargeEur: Math.round(r.bill.peakCharge),
  energyEur: Math.round(r.bill.spotCost + r.bill.adderCost), exportEur: Math.round(r.bill.exportRevenue),
  efc: +r.battery.efc.toFixed(1), regime: r.bill.regime, fullLoadHours: Math.round(r.bill.fullLoadHours),
  limitBreaches: r.safety.violations.import.steps + r.safety.violations.export.steps + r.safety.violations.fuse.steps,
  balanceOk: r.balanceResidualKW < 1e-6,
  evUnmetKWh: +r.flexSummary.evUnmetKWh.toFixed(2), heatUnmetKWh: +r.flexSummary.heatUnmetKWh.toFixed(2),
});
const out: Record<string, unknown> = {};
for (const site of EXAMPLES) {
  const base = simulate(site, data, tariff, { ...YEAR, baseline: true });
  const th = Number(site.controller.params.thresholdKW);
  const res: Record<string, unknown> = { baseline: row(base, base), signal: base.signal };
  for (const c of [{ type: 'peakShave', params: { thresholdKW: th } }, { type: 'priceRules', params: { thresholdKW: th } }, { type: 'mpc', params: {} }]) {
    for (const f of ['perfect', 'realistic'] as const) {
      const t0 = performance.now();
      let r: SimResult;
      try { r = simulate({ ...site, controller: c }, data, tariff, { ...YEAR, forecast: f, solver }); }
      catch (e) { console.error('solver failed, reloading once:', e); solver = await loadSolver(); r = simulate({ ...site, controller: c }, data, tariff, { ...YEAR, forecast: f, solver }); }
      res[`${c.type}/${f}`] = { ...row(r, base), seconds: +((performance.now() - t0) / 1000).toFixed(1) };
      const x = res[`${c.type}/${f}`] as ReturnType<typeof row>;
      console.log(site.id.padEnd(10), c.type.padEnd(11), f.padEnd(9), 'saving', String(x.savingEur).padStart(7), 'after wear', String(x.savingAfterWearEur).padStart(7), 'peak', x.peakKW, 'efc', x.efc, 'breaches', x.limitBreaches, (performance.now() - t0).toFixed(0), 'ms');
    }
  }
  out[site.id] = res;
}
const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/public/data/results_year.json');
writeFileSync(file, JSON.stringify({ generated: 'scripts/yeartable.ts', period: 'Oct 2025 - Sep 2026, full year, 15-min', wearEurPerMWh: 78, sites: out }, null, 1));
console.log('wrote', file);
