/**
 * German C&I electricity bill for a metered (RLM) site, net of VAT.
 * Structure and numbers come from app/public/data/tariff_de_netzleipzig_2026.json (all sourced there).
 *
 *   energy cost  = sum_t import_kWh(t) * (spot(t)/1000 + adders)          [EUR]
 *   adders       = grid energy price(regime) + KWKG + offshore + special-grid-use levy
 *                  + concession fee + electricity tax + supplier margin   [ct/kWh]
 *   peak charge  = max_t import_kW(t) * peak price(regime) * days/365      [EUR]
 *   export       = sum_t export_kWh(t) * max(spot(t), 0)/1000               [EUR, revenue]
 *   regime       = full-load hours h = annualised import kWh / peak kW;  h < 2500 -> 'below2500h'
 */

export interface TariffDE {
  gridFee: {
    thresholdHours: number;
    levels: Record<string, Record<'below2500h' | 'atOrAbove2500h', { energyCtPerKWh: number; peakEurPerKWYear: number }>>;
  };
  levies: {
    kwkg: { ctPerKWh: number };
    offshore: { ctPerKWh: number };
    specialGridUse: { firstGWhCtPerKWh: number; aboveGWhCtPerKWh: number; aboveGWhManufacturingCtPerKWh: number };
    concession: { ctPerKWh: number };
    electricityTax: { standardCtPerKWh: number; manufacturingCtPerKWh: number };
  };
}

export interface BillOptions {
  level: string;
  manufacturing: boolean;
  supplierMarginCt: number;
  /** force a regime instead of deriving it from the run ('auto' = derive) */
  regime?: 'auto' | 'below2500h' | 'atOrAbove2500h';
}

export interface Bill {
  days: number;
  importKWh: number;
  exportKWh: number;
  peakKW: number;
  peakStep: number;
  fullLoadHours: number;
  regime: 'below2500h' | 'atOrAbove2500h';
  spotCost: number;
  adderCost: number;
  peakCharge: number;
  exportRevenue: number;
  /** spot + adders + peak - export  (EUR, for the simulated period) */
  total: number;
  addersCt: Record<string, number>;
}

export function computeBill(gridKW: ArrayLike<number>, priceEurMWh: ArrayLike<number>, dtH: number, tariff: TariffDE, o: BillOptions): Bill {
  const n = gridKW.length;
  const days = (n * dtH) / 24;
  let imp = 0, exp = 0, spot = 0, expRev = 0, peak = 0, peakStep = 0;
  for (let t = 0; t < n; t++) {
    const g = gridKW[t];
    if (g > 0) {
      imp += g * dtH;
      spot += ((g * dtH) * priceEurMWh[t]) / 1000;
      if (g > peak) { peak = g; peakStep = t; }
    } else {
      exp += -g * dtH;
      expRev += ((-g * dtH) * Math.max(0, priceEurMWh[t])) / 1000;
    }
  }
  const annualImport = (imp * 365) / days;
  const flh = peak > 0 ? annualImport / peak : 0;
  const regime = o.regime && o.regime !== 'auto' ? o.regime : flh < tariff.gridFee.thresholdHours ? 'below2500h' : 'atOrAbove2500h';
  const lvl = tariff.gridFee.levels[o.level];
  if (!lvl) throw new Error(`unknown voltage level ${o.level}`);
  const fee = lvl[regime];
  const L = tariff.levies;
  // special grid-use levy: first GWh per year at the full rate (annualised average rate)
  const above = o.manufacturing ? L.specialGridUse.aboveGWhManufacturingCtPerKWh : L.specialGridUse.aboveGWhCtPerKWh;
  const sgu = annualImport > 0
    ? (Math.min(annualImport, 1e6) * L.specialGridUse.firstGWhCtPerKWh + Math.max(0, annualImport - 1e6) * above) / annualImport
    : L.specialGridUse.firstGWhCtPerKWh;
  const addersCt = {
    gridEnergy: fee.energyCtPerKWh,
    kwkg: L.kwkg.ctPerKWh,
    offshore: L.offshore.ctPerKWh,
    specialGridUse: sgu,
    concession: L.concession.ctPerKWh,
    electricityTax: o.manufacturing ? L.electricityTax.manufacturingCtPerKWh : L.electricityTax.standardCtPerKWh,
    supplierMargin: o.supplierMarginCt,
  };
  const adderSum = Object.values(addersCt).reduce((s, x) => s + x, 0);
  const adderCost = (imp * adderSum) / 100;
  const peakCharge = (peak * fee.peakEurPerKWYear * days) / 365;
  return {
    days, importKWh: imp, exportKWh: exp, peakKW: peak, peakStep, fullLoadHours: flh, regime,
    spotCost: spot, adderCost, peakCharge, exportRevenue: expRev,
    total: spot + adderCost + peakCharge - expRev, addersCt,
  };
}

/**
 * Prices a controller plans with (DECISIONS D-010): the bill's regime is decided by the whole year,
 * so the planner uses the regime the site would have WITHOUT the battery (its baseline full-load hours).
 */
export interface TariffSignal {
  regime: 'below2500h' | 'atOrAbove2500h';
  baselineFullLoadHours: number;
  /** all per-kWh charges on top of the spot price, EUR/kWh */
  addersEurPerKWh: number;
  /** annual peak price, EUR per kW of the year's highest quarter-hour */
  peakEurPerKWYear: number;
}

export function tariffSignal(tariff: TariffDE, o: BillOptions, baselineAnnualImportKWh: number, baselinePeakKW: number): TariffSignal {
  const flh = baselinePeakKW > 0 ? baselineAnnualImportKWh / baselinePeakKW : 0;
  // reuse computeBill on a synthetic one-year, two-value series so the adder logic lives in one place
  const steps = 35040, dtH = 0.25;
  const g = new Float64Array(steps).fill(baselineAnnualImportKWh / 8760);
  g[0] = baselinePeakKW;
  const regime = o.regime && o.regime !== 'auto' ? o.regime : flh < tariff.gridFee.thresholdHours ? 'below2500h' : 'atOrAbove2500h';
  const b = computeBill(g, new Float64Array(steps), dtH, tariff, { ...o, regime });
  const adderCt = Object.values(b.addersCt).reduce((s, x) => s + x, 0);
  return { regime, baselineFullLoadHours: flh, addersEurPerKWh: adderCt / 100, peakEurPerKWYear: tariff.gridFee.levels[o.level][regime].peakEurPerKWYear };
}
