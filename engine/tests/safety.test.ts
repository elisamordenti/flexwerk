import { describe, expect, it } from 'vitest';
import { applySafety } from '../src/sim/safety';

const base = { importLimitKW: 100, exportLimitKW: 50, fuseKW: 120, batteryNoExport: true };

describe('safety layer, fixed order: noExport -> import -> fuse -> export', () => {
  it('cuts battery charging to respect the import limit', () => {
    const s = applySafety({ ...base, fixedKW: 80, pvKW: 0, batt: [40] });
    expect(s.batt[0]).toBeCloseTo(20);
    expect(s.actions).toEqual(['import']);
    expect(s.violations.import).toBe(0);
  });

  it('import limit acts before the connection rating (rating never triggered when import fixed first)', () => {
    const s = applySafety({ ...base, fixedKW: 90, pvKW: 0, batt: [60] });
    expect(s.actions).toEqual(['import']);
    expect(s.batt[0]).toBeCloseTo(10);
  });

  it('connection rating applies when it is tighter than the import limit', () => {
    const s = applySafety({ ...base, importLimitKW: 200, fixedKW: 90, pvKW: 0, batt: [60] });
    expect(s.actions).toEqual(['fuse']);
    expect(s.batt[0]).toBeCloseTo(30);
  });

  it('never adds discharge: an uncontrollable overload is recorded, not hidden', () => {
    const s = applySafety({ ...base, fixedKW: 150, pvKW: 0, batt: [0] });
    expect(s.batt[0]).toBe(0);
    expect(s.violations.import).toBeCloseTo(50);
    expect(s.violations.fuse).toBeCloseTo(30);
  });

  it('battery may not cause export (behind-the-meter rule) before any limit is checked', () => {
    const s = applySafety({ ...base, fixedKW: 30, pvKW: 0, batt: [-80] });
    expect(s.batt[0]).toBeCloseTo(-30);
    expect(s.actions[0]).toBe('noExport');
  });

  it('export limit: curtails PV when the battery is not discharging', () => {
    const s = applySafety({ ...base, fixedKW: 20, pvKW: -150, batt: [0] });
    // grid = 20 - 150 = -130 -> rating 120 first (curtail 10), then export 50 (curtail 70 more)
    expect(s.actions).toEqual(['fuse', 'export']);
    expect(s.pvKW).toBeCloseTo(-70);
    expect(s.curtailedKW).toBeCloseTo(80);
    expect(s.violations.export).toBe(0);
  });

  it('export limit: battery charging is left alone and absorbs PV first', () => {
    const s = applySafety({ ...base, fixedKW: 20, pvKW: -150, batt: [80] });
    expect(s.actions).toEqual([]);
    expect(s.pvKW).toBe(-150);
  });
});
