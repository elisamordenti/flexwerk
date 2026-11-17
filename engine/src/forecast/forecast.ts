import { berlinDay } from '../core/time';
import type { SiteData } from '../core/types';

/**
 * What a controller is allowed to know about the next hours.
 *
 * perfect   : the true future (an upper bound no real controller reaches).
 * realistic : only what a real site controller could know at decision time t
 *   price  — the day-ahead auction for day D+1 closes at 12:00 CET and results are public ~12:45;
 *            we treat them as known from 13:00 Berlin time. Before that only day D is known.
 *            Unknown quarter-hours repeat the same quarter-hour of the last known day.
 *   load   — same quarter-hour one week earlier (weekly persistence: Monday looks like last Monday)
 *   solar  — same quarter-hour one day earlier (daily persistence)
 *   now    — the current quarter-hour is always the true value (see LIMITS L-010)
 * Earlier than the data year, persistence wraps around the year.
 */
export type ForecastMode = 'perfect' | 'realistic';

export interface ForecastWindow {
  /** forecast net uncontrollable power (load + PV), kW, + = site draws */
  netKW: Float64Array;
  /** forecast PV alone (≤ 0), kW: the export room for solar */
  pvKW: Float64Array;
  priceEurMWh: Float64Array;
  /** 1 where the price is a published auction result, 0 where it is a persistence guess */
  priceKnown: Uint8Array;
}

export const PRICE_PUBLISH_MINUTE = 13 * 60;

export class Forecaster {
  private loadAt: (t: number) => number;
  private pvAt: (t: number) => number;
  private price: ArrayLike<number>;
  private n: number;
  private startMs: number;
  private stepMs: number;
  readonly perStepDay: number;

  constructor(public mode: ForecastMode, data: SiteData, loadAt: (t: number) => number, pvAt: (t: number) => number, priceKey = 'price_da') {
    this.loadAt = loadAt; this.pvAt = pvAt;
    this.price = data.series[priceKey];
    this.n = data.n;
    this.startMs = Date.parse(data.start);
    this.stepMs = data.stepMinutes * 60000;
    this.perStepDay = Math.round(1440 / data.stepMinutes);
  }

  private wrap(t: number) { return ((t % this.n) + this.n) % this.n; }

  /** Last step index (inclusive) whose day-ahead price is public at decision step t. */
  knownPriceEnd(t: number): number {
    const ms = this.startMs + t * this.stepMs;
    const { day, minute } = berlinDay(ms);
    const lastDay = minute >= PRICE_PUBLISH_MINUTE ? day + 1 : day;
    // UTC instant of local midnight that ends lastDay
    const localMidnight = (lastDay + 1) * 86400000;
    let endMs = localMidnight - 3600000; // try UTC+1
    if (berlinDay(endMs).minute !== 0) endMs = localMidnight - 7200000; // summer time
    return Math.ceil((endMs - this.startMs) / this.stepMs) - 1;
  }

  window(t: number, H: number): ForecastWindow {
    const netKW = new Float64Array(H), pvKW = new Float64Array(H), priceEurMWh = new Float64Array(H);
    const priceKnown = new Uint8Array(H);
    const D = this.perStepDay;
    const known = this.mode === 'perfect' ? Infinity : this.knownPriceEnd(t);
    for (let h = 0; h < H; h++) {
      const tt = t + h;
      let load: number, pv: number;
      if (this.mode === 'perfect' || h === 0) { load = this.loadAt(this.wrap(tt)); pv = this.pvAt(this.wrap(tt)); }
      else { load = this.loadAt(this.wrap(tt - 7 * D)); pv = this.pvAt(this.wrap(tt - D)); }
      netKW[h] = load + pv; pvKW[h] = pv;
      let pt = tt;
      while (pt > known) pt -= D;
      priceEurMWh[h] = this.price[this.wrap(pt)];
      priceKnown[h] = pt === tt ? 1 : 0;
    }
    return { netKW, pvKW, priceEurMWh, priceKnown };
  }
}
