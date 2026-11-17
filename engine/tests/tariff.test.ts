import { describe, expect, it } from 'vitest';
import { computeBill } from '../src/tariff/de';
import { loadTariff } from './helpers';

const tariff = loadTariff();

describe('German C&I bill, hand-checked', () => {
  it('one day, flat 100 kW import at 100 €/MWh, MS level, manufacturing', () => {
    // 96 steps x 100 kW x 0.25 h = 2400 kWh/day; annualised 876,000 kWh; peak 100 kW -> 8760 h (>= 2500)
    const grid = new Array(96).fill(100);
    const price = new Array(96).fill(100);
    const b = computeBill(grid, price, 0.25, tariff, { level: 'MS', manufacturing: true, supplierMarginCt: 1.0 });
    expect(b.importKWh).toBeCloseTo(2400);
    expect(b.regime).toBe('atOrAbove2500h');
    expect(b.spotCost).toBeCloseTo(240);                       // 2400 kWh x 0.10 €/kWh
    // adders: grid 1.62 + KWKG 0.446 + offshore 0.941 + special 1.559 (below 1 GWh) + concession 0.11 + tax 0.05 + margin 1.0 = 5.726 ct
    expect(b.adderCost).toBeCloseTo(2400 * 0.05726, 6);
    expect(b.peakCharge).toBeCloseTo((100 * 101.62) / 365, 6);  // pro rata, one day
    expect(b.exportRevenue).toBe(0);
  });

  it('peaky site falls in the < 2500 h regime with the cheap peak price', () => {
    const grid = new Array(96).fill(10); grid[50] = 400;        // annualised ~ 98,000 kWh / 400 kW ~ 245 h
    const b = computeBill(grid, new Array(96).fill(50), 0.25, tariff, { level: 'MS', manufacturing: false, supplierMarginCt: 0 });
    expect(b.regime).toBe('below2500h');
    expect(b.peakCharge).toBeCloseTo((400 * 12.16) / 365, 6);
    expect(b.addersCt.gridEnergy).toBe(5.19);
    expect(b.addersCt.electricityTax).toBe(2.05);
  });

  it('the two price pairs meet near 2500 h (continuity of the grid fee)', () => {
    const ms = tariff.gridFee.levels['MS'];
    const at = (r: 'below2500h' | 'atOrAbove2500h') => ms[r].peakEurPerKWYear + (ms[r].energyCtPerKWh / 100) * 2500;
    expect(Math.abs(at('below2500h') - at('atOrAbove2500h'))).toBeLessThan(1); // 141.91 vs 142.12 €/kW
  });

  it('export earns the spot price, nothing when the price is negative', () => {
    const b = computeBill([-100, -100], [80, -20], 0.25, tariff, { level: 'MS', manufacturing: true, supplierMarginCt: 0 });
    expect(b.exportKWh).toBeCloseTo(50);
    expect(b.exportRevenue).toBeCloseTo(25 * 0.08);
  });
});
