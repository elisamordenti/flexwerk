import { EXAMPLES, simulate, idleController } from '../src/index';
import { loadData, loadTariff } from '../tests/helpers';
const data = loadData(), tariff = loadTariff();
for (const site of EXAMPLES) {
  const base = simulate(site, data, tariff, { startStep: 0, steps: data.n, controller: idleController.create!({}) });
  const t = new Date(Date.parse(data.start) + base.bill.peakStep * 15 * 60000);
  console.log(site.id, 'annual peak', base.bill.peakKW.toFixed(0), 'kW at', t.toLocaleString('en-GB', { timeZone: 'Europe/Berlin' }), 'day index', Math.floor(base.bill.peakStep / 96));
}
