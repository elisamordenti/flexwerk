import type { SimResult } from '../sim/engine';

export interface Kpi {
  key: string;
  label: string;
  unit: string;
  value: number;
  baseline: number;
  /** value - baseline */
  delta: number;
  /** true if a lower value is better */
  lowerIsBetter: boolean;
  help: string;
}

export interface Check {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

/** KPIs of a run, each shown as a difference to the idle-battery baseline on the same site and period. */
export function kpis(run: SimResult, base: SimResult): Kpi[] {
  const k = (key: string, label: string, unit: string, v: number, b: number, lowerIsBetter: boolean, help: string): Kpi =>
    ({ key, label, unit, value: v, baseline: b, delta: v - b, lowerIsBetter, help });
  return [
    k('cost', 'Total electricity cost', '€', run.bill.total, base.bill.total, true,
      'Energy (spot + grid fee + levies + taxes) + peak charge − export revenue, for the simulated period. Battery wear is not included yet.'),
    k('peak', 'Peak import', 'kW', run.bill.peakKW, base.bill.peakKW, true,
      'Highest 15-minute average import in the period. The grid fee charges this peak for the whole year.'),
    k('peakCharge', 'Peak charge (pro rata)', '€', run.bill.peakCharge, base.bill.peakCharge, true,
      'Peak × annual peak price × days/365.'),
    k('energyCost', 'Energy cost', '€', run.bill.spotCost + run.bill.adderCost, base.bill.spotCost + base.bill.adderCost, true,
      'Imported kWh × (spot price + grid energy price + levies + taxes + margin).'),
    k('efc', 'Equivalent full cycles', 'cycles', run.battery.efc, base.battery.efc, true,
      '(energy charged + energy discharged) / 2 / capacity. One full cycle = one complete charge and discharge.'),
    k('selfConsumption', 'Exported energy', 'kWh', run.bill.exportKWh, base.bill.exportKWh, true,
      'Energy fed into the grid (mostly PV surplus).'),
  ];
}

export function checks(run: SimResult): Check[] {
  const v = run.safety.violations;
  const c = (key: string, label: string, x: { steps: number; maxKW: number }): Check => ({
    key, label, pass: x.steps === 0,
    detail: x.steps === 0 ? 'respected in every step' : `exceeded in ${x.steps} steps, worst by ${x.maxKW.toFixed(1)} kW`,
  });
  return [
    c('import', 'Import limit', v.import),
    c('export', 'Export limit', v.export),
    c('fuse', 'Connection rating', v.fuse),
    { key: 'balance', label: 'Energy balance', pass: run.balanceResidualKW < 1e-6, detail: `max residual ${run.balanceResidualKW.toExponential(1)} kW` },
    ...(Object.values(run.flexState ?? {}).some((f) => f.kind === 'ev') ? [{ key: 'ev', label: 'Vans charged', pass: run.flexSummary.evUnmetKWh < 0.01,
      detail: run.flexSummary.evUnmetKWh < 0.01 ? 'every van left with the energy it needed' : `${run.flexSummary.evUnmetKWh.toFixed(1)} kWh missing at departure` }] : []),
    ...(Object.values(run.flexState ?? {}).some((f) => f.kind === 'heatpump') ? [{ key: 'heat', label: 'Heat delivered', pass: run.flexSummary.heatUnmetKWh < 0.01,
      detail: run.flexSummary.heatUnmetKWh < 0.01 ? 'the building got all the heat it needed' : `${run.flexSummary.heatUnmetKWh.toFixed(1)} kWh of heat missing` }] : []),
  ];
}
