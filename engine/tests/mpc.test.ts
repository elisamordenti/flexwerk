import { beforeAll, describe, expect, it } from 'vitest';
import { solveLp, loadSolver, Forecaster, berlinDay, berlinOffsetH, simulate, idleController, EXAMPLES, type Solver } from '../src/index';
import { loadData, loadTariff } from './helpers';

let solver: Solver;
beforeAll(async () => { solver = await loadSolver(); });
const data = loadData();
const tariff = loadTariff();
const EX = (id: string) => EXAMPLES.find((e) => e.id === id)!;

/**
 * Hand-checked case. 3 one-hour steps, load 100, 100, 300 kW, no solar, flat price 0.10 €/kWh,
 * peak price 10 €/kW, battery 100 kW / 100 kWh, empty at the start.
 *
 * Lossless (η = 1): store 100 kWh in hours 1–2, discharge 100 kW in hour 3
 *   -> import 150, 150 (any split), 200; peak 200 kW
 *   -> cost = 0.10·500 + 10·200 = 2,050 € (+ a tiny throughput cost ε = 1e-4 €/kWh on 200 kWh = 0.02 €)
 * With η = 0.9 each way: a full 100 kWh store gives only 90 kW at the bus in hour 3 -> peak 210 kW;
 *   filling it takes 100/0.9 = 111.1 kWh from the grid
 *   -> cost = 0.10·(200 + 111.1 + 210) + 10·210 = 2,152.11 € (+ ε·(111.1 + 90) ≈ 0.02 €)
 */
describe('MPC linear program vs a hand-solved case', () => {
  const base = {
    dtH: [1, 1, 1], netKW: [100, 100, 300], pvKW: [0, 0, 0], buy: [0.1, 0.1, 0.1], sell: [0, 0, 0],
    peakEurPerKW: 10, peakSoFarKW: 0, importLimitKW: 1000, exportLimitKW: 0,
    e0: 0, eMin: 0, eMax: 100, powerKW: 100, wearEurPerKWh: 0, terminalEurPerKWh: 0,
  };
  it('lossless battery', () => {
    const p = solveLp(solver, { ...base, eta: 1 });
    expect(p.status).toBe('Optimal');
    expect(p.peakKW).toBeCloseTo(200, 4);
    expect(p.discharge[2]).toBeCloseTo(100, 4);
    expect(p.energy[2]).toBeCloseTo(0, 4);
    expect(p.objective).toBeCloseTo(2050.02, 2);
  });
  it('with 90 % efficiency each way', () => {
    const p = solveLp(solver, { ...base, eta: 0.9 });
    expect(p.peakKW).toBeCloseTo(210, 4);
    expect(p.discharge[2]).toBeCloseTo(90, 4);
    expect(p.charge[0] + p.charge[1]).toBeCloseTo(100 / 0.9, 4);
    expect(p.objective).toBeCloseTo(2152.11 + 1e-4 * (100 / 0.9 + 90), 2);
  });
  it('never exports from the battery, even when export pays', () => {
    const p = solveLp(solver, { ...base, eta: 1, e0: 100, buy: [0, 0, 0], sell: [1, 1, 1], exportLimitKW: 1000, peakEurPerKW: 0 });
    for (let h = 0; h < 3; h++) expect(p.discharge[h]).toBeLessThanOrEqual(base.netKW[h] + 1e-6);
  });
});

describe('Berlin time', () => {
  it('switches to summer time on 29 Mar 2026 at 01:00 UTC', () => {
    expect(berlinOffsetH(Date.parse('2026-03-29T00:59:00Z'))).toBe(1);
    expect(berlinOffsetH(Date.parse('2026-03-29T01:00:00Z'))).toBe(2);
    expect(berlinOffsetH(Date.parse('2025-10-26T01:00:00Z'))).toBe(1);
  });
  it('step 0 (30 Sep 2025 22:00 UTC) is local midnight of 1 Oct', () => {
    const d = berlinDay(Date.parse(data.start));
    expect(d.minute).toBe(0);
  });
});

describe('forecasts', () => {
  const load = (t: number) => data.series.load_factory[t];
  const pv = (t: number) => -data.series.pv_south30[t];
  // winter time: Berlin midnight of day d (counted from 1 Oct) is step d*96 + 4 on the UTC axis
  const day = 96, mid = 61 * day + 4, t10 = mid + 40; // 1 Dec 2025, 10:00 Berlin
  it('perfect = the real future', () => {
    const w = new Forecaster('perfect', data, load, pv).window(t10, 96);
    for (let h = 0; h < 96; h++) {
      expect(w.netKW[h]).toBeCloseTo(load(t10 + h) + pv(t10 + h), 9);
      expect(w.priceEurMWh[h]).toBe(data.series.price_da[t10 + h]);
    }
  });
  it('realistic: at 10:00 only today\'s prices are public; tomorrow repeats today', () => {
    const w = new Forecaster('realistic', data, load, pv).window(t10, 96);
    const endToday = mid + day - 1 - t10; // last quarter-hour of 1 Dec
    expect(w.priceKnown[endToday]).toBe(1);
    expect(w.priceKnown[endToday + 1]).toBe(0);
    expect(w.priceEurMWh[endToday + 1]).toBe(data.series.price_da[t10 + endToday + 1 - day]);
  });
  it('realistic: at 14:00 tomorrow\'s prices are public too', () => {
    const t14 = mid + 56;
    const w = new Forecaster('realistic', data, load, pv).window(t14, 96);
    expect(Array.from(w.priceKnown).every((x) => x === 1)).toBe(true);
  });
  it('realistic: load = last week, solar = yesterday, now = actual', () => {
    const w = new Forecaster('realistic', data, load, pv).window(t10, 8);
    expect(w.netKW[0]).toBeCloseTo(load(t10) + pv(t10), 9);
    expect(w.netKW[5]).toBeCloseTo(load(t10 + 5 - 7 * day) + pv(t10 + 5 - day), 9);
  });
});

describe('controllers on the example factory, peak week', () => {
  const site = EX('factory');
  const opt = { startStep: 61 * 96 + 4, steps: 7 * 96 };
  it('MPC with perfect forecasts beats static peak shaving and breaks no limit', () => {
    const base = simulate(site, data, tariff, { ...opt, controller: idleController.create!({}) });
    const ps = simulate(site, data, tariff, opt);
    const mpc = simulate({ ...site, controller: { type: 'mpc', params: {} } }, data, tariff, { ...opt, solver, forecast: 'perfect' });
    expect(mpc.bill.total).toBeLessThan(ps.bill.total);
    expect(mpc.bill.total).toBeLessThan(base.bill.total);
    expect(mpc.safety.violations.import.steps).toBe(0);
    expect(mpc.balanceResidualKW).toBeLessThan(1e-6);
    expect(mpc.plans!.atSteps.length).toBe(7 * 24);
  });
  it('rule-based controllers give the same result with either forecast', () => {
    for (const c of [{ type: 'peakShave', params: { thresholdKW: 330 } }, { type: 'priceRules', params: { thresholdKW: 330 } }]) {
      const a = simulate({ ...site, controller: c }, data, tariff, { ...opt, forecast: 'perfect' });
      const b = simulate({ ...site, controller: c }, data, tariff, { ...opt, forecast: 'realistic' });
      expect(a.bill.total).toBe(b.bill.total);
    }
  });
  it('in the peak week, realistic MPC costs more than perfect MPC (a regression check, not a theorem: a 24 h planner is not globally optimal)', () => {
    const p = simulate({ ...site, controller: { type: 'mpc', params: {} } }, data, tariff, { ...opt, solver, forecast: 'perfect' });
    const r = simulate({ ...site, controller: { type: 'mpc', params: {} } }, data, tariff, { ...opt, solver, forecast: 'realistic' });
    expect(r.bill.total).toBeGreaterThanOrEqual(p.bill.total);
  });
});
