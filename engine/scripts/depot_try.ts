import { simulate, loadSolver, type SiteSpec } from '../src/index';
import { loadData, loadTariff } from '../tests/helpers';
const data = loadData(), tariff = loadTariff();
const solver = await loadSolver();
const site: SiteSpec = {
  name: 'Logistics depot', controller: { type: 'peakShave', params: { thresholdKW: 250 } },
  assets: [
    { id: 'grid', type: 'grid', name: 'Grid', params: { level: 'MS', importLimitKW: 500, exportLimitKW: 350, fuseKW: 600, manufacturing: false } },
    { id: 'load1', type: 'load', name: 'Warehouse', params: { profile: 'load_warehouse', annualMWh: 600 } },
    { id: 'pv1', type: 'pv', name: 'Roof PV', params: { profile: 'pv_south30', kWp: 400 } },
    { id: 'bat1', type: 'battery', name: 'Battery', params: { energyKWh: 430, powerKW: 200 } },
    { id: 'ev1', type: 'ev', name: 'Van fleet', params: { vehicles: 40, chargerKW: 7.4 } },
    { id: 'hp1', type: 'heatpump', name: 'Heat pump', params: { annualHeatMWh: 300, annualWaterMWh: 20, powerKW: 110, tankKWh: 200 } },
  ],
};
const base = simulate(site, data, tariff, { startStep: 0, steps: data.n, baseline: true });
const pk = base.bill.peakStep; console.log('baseline year peak', base.bill.peakKW.toFixed(0), 'at step', pk, 'day', Math.floor(pk / 96), 'flh', base.bill.fullLoadHours.toFixed(0));
const day0 = Math.floor(pk / 96) - ((Math.floor(pk / 96) + 2) % 7); // back to Monday (1 Oct 2025 = Wednesday)
const W = { startStep: day0 * 96 + 4, steps: 7 * 96 };
const b = simulate(site, data, tariff, { ...W, baseline: true });
console.log('week from day', day0, 'baseline cost', b.bill.total.toFixed(0), 'peak', b.bill.peakKW.toFixed(0));
for (const c of [{ type: 'peakShave', params: { thresholdKW: 250 } }, { type: 'priceRules', params: { thresholdKW: 250 } }, { type: 'mpc', params: {} }]) for (const f of ['perfect', 'realistic'] as const) {
  if (c.type !== 'mpc' && f === 'realistic') continue;
  const t0 = performance.now();
  const r = simulate({ ...site, controller: c }, data, tariff, { ...W, solver, forecast: f });
  console.log(c.type.padEnd(10), f.padEnd(9), 'saving', (b.bill.total - r.bill.total).toFixed(0).padStart(5), 'peak', r.bill.peakKW.toFixed(0), 'efc', r.battery.efc.toFixed(1),
    'EVunmet', r.flexSummary.evUnmetKWh.toFixed(1), 'heatUnmet', r.flexSummary.heatUnmetKWh.toFixed(1), 'viol', r.safety.violations.import.steps, 'resid', r.balanceResidualKW.toExponential(1), (performance.now() - t0).toFixed(0), 'ms');
}
