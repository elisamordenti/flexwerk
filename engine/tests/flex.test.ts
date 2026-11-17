import { beforeAll, describe, expect, it } from 'vitest';
import { applySafety, assetType, EXAMPLES, loadSolver, simulate, solveLp, type Solver } from '../src/index';
import { loadData, loadTariff } from './helpers';

let solver: Solver;
beforeAll(async () => { solver = await loadSolver(); });
const data = loadData();
const tariff = loadTariff();
const depot = EXAMPLES.find((e) => e.id === 'depot')!;
const MONTH = { startStep: 92 * 96 + 4, steps: 31 * 96 }; // January 2026

const evModel = (params: Record<string, number | string>) =>
  assetType('ev').create!({ id: 'ev', type: 'ev', name: 'ev', params }, data).flex!;

describe('EV fleet', () => {
  for (const strategy of ['asap', 'spread', 'cheapest']) {
    it(`every van leaves with its energy, rule "${strategy}"`, () => {
      const m = evModel({ vehicles: 20, chargerKW: 7.4, strategy });
      for (let t = MONTH.startStep; t < MONTH.startStep + MONTH.steps; t++) {
        const b = m.bounds(t, 0.25);
        expect(b.min).toBeLessThanOrEqual(b.max + 1e-9);
        expect(b.max).toBeLessThanOrEqual(20 * 7.4 + 1e-9);
        m.apply(t, m.ownChoice(t, 0.25), 0.25);
      }
      expect(m.state().unmetKWh).toBeLessThan(1e-6);
    });
  }

  it('asking for zero still charges what the deadlines require', () => {
    const m = evModel({ vehicles: 20, chargerKW: 7.4 });
    for (let t = MONTH.startStep; t < MONTH.startStep + MONTH.steps; t++) { m.bounds(t, 0.25); m.apply(t, 0, 0.25); }
    expect(m.state().unmetKWh).toBeLessThan(1e-6);
    expect(m.state().deliveredKWh).toBeGreaterThan(1000);
  });
});

describe('heat pump with tank', () => {
  it('tank stays within its size and the building always gets its heat (depot defaults, full year, on demand)', () => {
    const inst = depot.assets.find((a) => a.type === 'heatpump')!;
    const m = assetType('heatpump').create!(inst, data).flex!;
    let demand = 0;
    for (let t = 0; t < data.n; t++) {
      m.apply(t, m.uncontrolled(t, 0.25), 0.25);
      const s = m.state();
      expect(s.tank).toBeGreaterThanOrEqual(-1e-9);
      expect(s.tank).toBeLessThanOrEqual(1 + 1e-9);
    }
    const s = m.state();
    expect(s.unmetKWh).toBeLessThan(1e-6);
    // heat delivered = annual demand + change of tank content (the tank started half full)
    demand = Number(inst.params.annualHeatMWh) * 1000 + Number(inst.params.annualWaterMWh) * 1000;
    expect(Math.abs(s.heatKWh - (demand + (s.tankKWh - Number(inst.params.tankKWh) / 2)))).toBeLessThan(1);
  });
});

describe('safety layer and flexible loads', () => {
  it('slows flexible loads at the import limit, but never below what they must take', () => {
    const s = applySafety({ fixedKW: 400, pvKW: 0, batt: [50], importLimitKW: 500, exportLimitKW: 100, fuseKW: 600, batteryNoExport: true,
      flex: [{ p: 150, min: 120 }] });
    expect(s.batt[0]).toBeCloseTo(0, 9);       // battery charging cut first
    expect(s.flex[0]).toBeCloseTo(120, 9);     // then the flexible load down to its minimum
    expect(s.violations.import).toBeCloseTo(20, 9); // what is left is reported, not hidden
  });
});

describe('linear program with an EV fleet (hand-checked)', () => {
  // 2 one-hour steps, base load 0 then 50 kW, one van needs 10 kWh by the end of step 2, 10 kW max.
  const base = { dtH: [1, 1], netKW: [0, 50], pvKW: [0, 0], sell: [0, 0], peakSoFarKW: 0, importLimitKW: 1000, exportLimitKW: 0,
    e0: 0, eMin: 0, eMax: 0, powerKW: 0, eta: 1, wearEurPerKWh: 0, terminalEurPerKWh: 0,
    evs: [{ pmax: [10, 10], emin: [0, 10], emax: [10, 10] }] };
  it('without a peak price it charges in the cheaper hour', () => {
    const p = solveLp(solver, { ...base, buy: [0.3, 0.1], peakEurPerKW: 0 });
    expect(p.ev[0][0]).toBeCloseTo(0, 6); expect(p.ev[0][1]).toBeCloseTo(10, 6);
  });
  it('with a high peak price it charges away from the 50 kW hour, even though energy is dearer then', () => {
    const p = solveLp(solver, { ...base, buy: [0.3, 0.1], peakEurPerKW: 10 });
    expect(p.ev[0][0]).toBeCloseTo(10, 6); expect(p.peakKW).toBeCloseTo(50, 6);
  });
});

describe('joint planner on the depot (cold week)', () => {
  const W = { startStep: 110 * 96 + 4, steps: 7 * 96 };
  it('MPC plans battery, vans and heat pump: lower cost and peak than the baseline, no van short, no heat missing', () => {
    const base = simulate(depot, data, tariff, { ...W, baseline: true });
    const r = simulate({ ...depot, controller: { type: 'mpc', params: {} } }, data, tariff, { ...W, solver, forecast: 'realistic' });
    expect(r.bill.total).toBeLessThan(base.bill.total);
    expect(r.bill.peakKW).toBeLessThan(base.bill.peakKW);
    expect(r.flexSummary.evUnmetKWh).toBeLessThan(1e-6);
    expect(r.flexSummary.heatUnmetKWh).toBeLessThan(1e-6);
    expect(r.safety.violations.import.steps).toBe(0);
    expect(r.balanceResidualKW).toBeLessThan(1e-6);
  });
});
