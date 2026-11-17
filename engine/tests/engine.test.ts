import { describe, expect, it } from 'vitest';
import { EXAMPLES, simulate, idleController, batteryAssetForTest } from './testExports';
import { loadData, loadTariff } from './helpers';

const data = loadData();
const tariff = loadTariff();
const EX = (id: string) => EXAMPLES.find((e) => e.id === id)!;
const YEAR = { startStep: 0, steps: data.n };

describe('energy balance', () => {
  for (const site of EXAMPLES) {
    it(`closes every step for the full year: ${site.name}`, () => {
      const r = simulate(site, data, tariff, YEAR);
      expect(r.balanceResidualKW).toBeLessThan(1e-6);
      // meter = sum of asset powers, every step
      for (let k = 0; k < r.steps; k++) {
        const s = r.assets.reduce((acc, a) => acc + a.power[k], 0);
        expect(Math.abs(s - r.gridKW[k])).toBeLessThan(1e-9);
      }
    });
  }

  it('battery energy accounting: ΔE = Σ(charge·η − discharge/η)·dt', () => {
    const site = EX('factory');
    const r = simulate(site, data, tariff, YEAR);
    const bat = r.assets.find((a) => a.type === 'battery')!;
    const eta = Math.sqrt(0.89);
    const cap = 430;
    let e = 0.5 * cap;
    for (let k = 0; k < r.steps; k++) {
      const p = bat.power[k];
      e += p >= 0 ? p * eta * r.dtH : (p / eta) * r.dtH;
      expect(Math.abs(e / cap - r.soc[bat.id][k])).toBeLessThan(1e-6);
    }
  });
});

describe('profiles are scaled to the declared annual consumption', () => {
  it('load sums to annualMWh over the data year', () => {
    const site = { ...EX('factory'), controller: { type: 'idle', params: {} } };
    const r = simulate(site, data, tariff, YEAR);
    const load = r.assets.find((a) => a.type === 'load')!;
    const kwh = load.power.reduce((s, x) => s + x, 0) * r.dtH;
    expect(kwh / 1000).toBeCloseTo(1500, 6);
  });
});

describe('battery state-of-charge limits', () => {
  it('never leaves [socMin, socMax] whatever the controller asks', () => {
    const m = batteryAssetForTest.create!({ id: 'b', type: 'battery', name: 'b', params: { energyKWh: 100, powerKW: 80, socMin: 10, socMax: 90, soc0: 50 } }, data);
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 20000; i++) {
      m.apply!((rnd() - 0.5) * 1000, 0.25);
      const s = m.state!().soc;
      expect(s).toBeGreaterThanOrEqual(0.1 - 1e-12);
      expect(s).toBeLessThanOrEqual(0.9 + 1e-12);
    }
  });

  it('respects the power rating', () => {
    const m = batteryAssetForTest.create!({ id: 'b', type: 'battery', name: 'b', params: { energyKWh: 1000, powerKW: 50 } }, data);
    expect(m.apply!(500, 0.25)).toBe(50);
    expect(m.apply!(-500, 0.25)).toBe(-50);
  });
});

describe('baseline', () => {
  it('idle controller never moves the battery', () => {
    const r = simulate(EX('warehouse'), data, tariff, { ...YEAR, controller: idleController.create!({}) });
    const bat = r.assets.find((a) => a.type === 'battery')!;
    expect(bat.power.every((x) => x === 0)).toBe(true);
    expect(r.battery.efc).toBe(0);
  });

  it('peak shaving lowers the peak vs baseline on the example factory', () => {
    const base = simulate(EX('factory'), data, tariff, { ...YEAR, controller: idleController.create!({}) });
    const run = simulate(EX('factory'), data, tariff, YEAR);
    expect(run.bill.peakKW).toBeLessThan(base.bill.peakKW);
  });
});
