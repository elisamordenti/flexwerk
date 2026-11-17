import { EXAMPLES, simulate, idleController, loadSolver } from '../src/index';
import { loadData, loadTariff } from '../tests/helpers';
const data = loadData(), tariff = loadTariff();
const solver = await loadSolver();
const site = EXAMPLES[0];
const opt = { startStep: 61 * 96 + 4, steps: 7 * 96 };
const base = simulate(site, data, tariff, { ...opt, controller: idleController.create!({}) });
console.log('signal', base.signal, '\nbaseline cost', base.bill.total.toFixed(0), 'peak', base.bill.peakKW.toFixed(0));
for (const c of [{ type: 'peakShave', params: { thresholdKW: 330 } }, { type: 'priceRules', params: { thresholdKW: 330 } }, { type: 'mpc', params: {} }]) {
  for (const f of ['perfect', 'realistic'] as const) {
    const t0 = performance.now();
    const r = simulate({ ...site, controller: c }, data, tariff, { ...opt, forecast: f, solver });
    console.log(c.type.padEnd(11), f.padEnd(9), 'cost', (r.bill.total - base.bill.total).toFixed(0).padStart(6), 'peak', r.bill.peakKW.toFixed(0), 'efc', r.battery.efc.toFixed(2), 'viol', JSON.stringify(r.safety.violations.import.steps), 'resid', r.balanceResidualKW.toExponential(1), 'ms', (performance.now() - t0).toFixed(0), 'plans', r.plans?.atSteps.length ?? 0);
  }
}
