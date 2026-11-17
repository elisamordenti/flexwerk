// Full-year sanity report: every example site, idle baseline vs its configured controller.
import { EXAMPLES, simulate, idleController, kpis, checks } from '../src/index';
import { loadData, loadTariff } from '../tests/helpers';

const data = loadData();
const tariff = loadTariff();
const year = { startStep: 0, steps: data.n };
for (const site of EXAMPLES) {
  const base = simulate(site, data, tariff, { ...year, controller: idleController.create!({}) });
  const run = simulate(site, data, tariff, year);
  console.log(`\n== ${site.name}  (controller: ${run.controller})`);
  console.log(`   baseline: import ${(base.bill.importKWh / 1000).toFixed(0)} MWh, peak ${base.bill.peakKW.toFixed(0)} kW, FLH ${base.bill.fullLoadHours.toFixed(0)} h (${base.bill.regime}), export ${(base.bill.exportKWh / 1000).toFixed(0)} MWh`);
  for (const k of kpis(run, base)) console.log(`   ${k.label.padEnd(26)} ${k.value.toFixed(1).padStart(10)} ${k.unit.padEnd(6)} vs ${k.baseline.toFixed(1).padStart(10)}  Δ ${k.delta.toFixed(1)}`);
  console.log('   checks:', checks(run).map((c) => `${c.label}: ${c.pass ? 'PASS' : 'FAIL ' + c.detail}`).join(' | '));
  console.log('   safety actions:', JSON.stringify(run.safety.actions), ' curtailed PV MWh:', (run.curtailedKW.reduce((s, x) => s + x, 0) * 0.25 / 1000).toFixed(1));
}
