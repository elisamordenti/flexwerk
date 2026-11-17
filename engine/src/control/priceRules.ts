import { num, resolve } from '../core/params';
import { berlinDay } from '../core/time';
import type { ControllerType } from './types';

/**
 * Price-aware rules: a fixed rule book, no optimisation.
 *   1. import would exceed the peak threshold      -> discharge the excess        (peak protection first)
 *   2. solar surplus (site would export)           -> charge with the surplus     (free energy)
 *   3. now is one of today's N most expensive hours -> discharge to cover the load (never export)
 *   4. now is one of today's N cheapest hours       -> charge, but keep import ≤ threshold
 *   otherwise wait.
 * "Today" = the Berlin calendar day. Its prices are always known: the day-ahead auction set them yesterday.
 * So this controller does not depend on the forecast mode.
 */
export const priceRulesController: ControllerType = {
  type: 'priceRules',
  label: 'Price-aware rules',
  description: 'Charge in the cheapest hours of the day, discharge in the most expensive, never let import exceed the peak threshold.',
  guide: 'ch14',
  available: true,
  usesForecast: false,
  params: [
    { key: 'thresholdKW', label: 'Peak threshold', unit: 'kW', kind: 'number', default: 350, min: 0, max: 50000, step: 5,
      help: 'Import level the battery always defends first. Cheap-hour charging never pushes import above it.', source: 'example choice', guide: 'ch14' },
    { key: 'chargeHours', label: 'Cheapest hours to charge', unit: 'h/day', kind: 'number', default: 3, min: 0, max: 12, step: 0.25,
      help: 'Each day, the battery charges during this many of the cheapest hours.', source: 'example choice', guide: 'ch14' },
    { key: 'dischargeHours', label: 'Dearest hours to discharge', unit: 'h/day', kind: 'number', default: 3, min: 0, max: 12, step: 0.25,
      help: 'Each day, the battery discharges during this many of the most expensive hours.', source: 'example choice', guide: 'ch14' },
  ],
  create(params) {
    const p = resolve(this.params, params);
    const th = num(p, 'thresholdKW');
    const nC = Math.round(num(p, 'chargeHours') * 4), nD = Math.round(num(p, 'dischargeHours') * 4);
    let dayKey = NaN; let cheap = new Set<number>(); let dear = new Set<number>();
    return {
      name: 'priceRules',
      decide(o) {
        const stepMs = o.data.stepMinutes * 60000, start = Date.parse(o.data.start);
        const { day, minute } = berlinDay(start + o.t * stepMs);
        if (day !== dayKey) {
          // the quarter-hours of today (92, 96 or 100 on clock-change days)
          dayKey = day;
          const first = o.t - Math.round(minute / o.data.stepMinutes);
          const steps: number[] = [];
          for (let k = first; k < first + 104 && k < o.data.n; k++) if (k >= 0 && berlinDay(start + k * stepMs).day === day) steps.push(k);
          const pr = o.data.series.price_da;
          const sorted = [...steps].sort((a, b) => pr[a] - pr[b]);
          cheap = new Set(sorted.slice(0, nC));
          dear = new Set(sorted.slice(Math.max(nC, sorted.length - nD)));
        }
        const P = o.batteries.reduce((s, b) => s + b.powerKW, 0) || 1;
        const net = o.netFixedKW;
        let want = 0;
        if (net > th) want = -(net - th);
        else if (net < 0) want = Math.min(P, -net);
        else if (dear.has(o.t)) want = -Math.min(P, net);
        else if (cheap.has(o.t)) want = Math.max(0, Math.min(P, th - net));
        return Object.fromEntries(o.batteries.map((b) => [b.id, (want * b.powerKW) / P]));
      },
    };
  },
};
