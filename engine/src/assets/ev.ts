import type { AssetType, FlexModel, FlexPlan, SiteData } from '../core/types';
import { num, resolve, str } from '../core/params';
import type { ForecastMode } from '../forecast/forecast';

const SRC = 'Optimise Prime (UK Power Networks et al.), British Gas commercial van sessions, CC BY 4.0';

/**
 * EV fleet charging. Each van brings a measured session: arrival, departure, energy it needs (kWh).
 *   per van and step   0 ≤ p ≤ P_max (the lower of charger and on-board charger)
 *   must-charge        if the energy still needed cannot be delivered in the steps left after this one,
 *                      the difference must be charged now (that is the lower bound `min`)
 * A fleet power the controller asks for is shared: every van first gets its must-charge power, the rest
 * goes to the van that leaves first (earliest-deadline-first). Energy still missing at departure is
 * counted as "unmet" and reported (it must be 0 for the strategy to be acceptable).
 */
interface Sess { v: number; arr: number; dep: number; e: number }
interface Active { dep: number; rem: number; plan?: Set<number> }

export const evAsset: AssetType = {
  type: 'ev',
  label: 'EV fleet chargers',
  role: 'flexible',
  ports: [{ id: 'ac', flow: 'power', direction: 'in' }],
  icon: 'charger',
  color: '#2a9d8f',
  description: 'Company vans that come back to the depot and must be charged before they leave. Measured sessions from a UK commercial fleet.',
  guide: 'ch4',
  available: true,
  params: [
    { key: 'vehicles', label: 'Number of vans', unit: 'vans', kind: 'number', default: 20, min: 1, max: 156, step: 1,
      help: 'How many vans charge at the site. Each van follows the measured sessions of one real van over a year.', source: SRC, guide: 'ch4' },
    { key: 'chargerKW', label: 'Charging power per van', unit: 'kW', kind: 'number', default: 7.4, min: 2.3, max: 50, step: 0.1,
      help: 'Most power one van can take: the lower of the charge point and the van\'s on-board charger. 7.4 kW = single-phase 32 A, common for vans.',
      source: 'example choice', guide: 'ch4' },
    { key: 'strategy', label: 'Charging rule', unit: '', kind: 'select', default: 'asap',
      options: [
        { value: 'asap', label: 'Charge at once (no control)' },
        { value: 'spread', label: 'Spread over the stay (lowest steady power)' },
        { value: 'cheapest', label: 'Cheapest quarter-hours before departure' },
      ],
      help: 'What the chargers do on their own. When the site strategy is the MPC, the planner decides instead. The baseline always uses "charge at once".',
      source: 'example choice', guide: 'ch14' },
  ],
  create(inst, data) {
    const p = resolve(this.params, inst.params);
    const fleet = data.sessions?.ev_fleet_sessions;
    if (!fleet) throw new Error('missing EV session data (ev_fleet_sessions)');
    const N = Math.min(num(p, 'vehicles'), fleet.vehicles);
    const P = num(p, 'chargerKW');
    const rule = str(p, 'strategy');
    const price = data.series.price_da;
    // a session cannot need more than the charger can deliver while the van is plugged in (capped, and reported)
    const dt0 = data.stepMinutes / 60;
    let capped = 0;
    const all: Sess[] = fleet.sessions.filter((s) => s[0] < N).map((s) => {
      const e = Math.min(s[3], P * dt0 * (s[2] - s[1]));
      capped += s[3] - e;
      return { v: s[0], arr: s[1], dep: s[2], e };
    });
    const byArr = new Map<number, Sess[]>();
    for (const s of all) { const l = byArr.get(s.arr) ?? []; l.push(s); byArr.set(s.arr, l); }
    let active: Active[] = [];
    let tNow = -1;
    let unmet = 0, delivered = 0, needed = 0;
    let started = false;

    const cheapestPlan = (s: Active, t: number, dtH: number) => {
      const k = Math.ceil(s.rem / (P * dtH) - 1e-9);
      const steps: number[] = [];
      for (let q = t; q < s.dep; q++) steps.push(q);
      steps.sort((a, b) => price[a] - price[b] || a - b);
      return new Set(steps.slice(0, k));
    };

    /** advance to step t: drop departed vans (count unmet energy), add arrivals */
    const advance = (t: number, dtH: number) => {
      if (t === tNow) return;
      if (!started) {
        // vans already plugged in when the run starts: assume they charged evenly so far
        for (const s of all) if (s.arr < t && s.dep > t) {
          const rem = (s.e * (s.dep - t)) / (s.dep - s.arr);
          active.push({ dep: s.dep, rem }); needed += rem;
        }
        started = true;
      }
      active = active.filter((a) => { if (a.dep <= t) { unmet += a.rem; return false; } return true; });
      for (const s of byArr.get(t) ?? []) { active.push({ dep: s.dep, rem: s.e }); needed += s.e; }
      if (rule === 'cheapest') for (const a of active) if (!a.plan) a.plan = cheapestPlan(a, t, dtH);
      active.sort((a, b) => a.dep - b.dep);
      tNow = t;
    };
    const lim = (a: Active, t: number, dtH: number) => {
      const max = Math.min(P, a.rem / dtH);
      const after = Math.max(0, a.dep - t - 1);
      const min = Math.min(max, Math.max(0, a.rem - P * dtH * after) / dtH);
      return { min, max };
    };

    const flex: FlexModel = {
      kind: 'ev',
      bounds(t, dtH) {
        advance(t, dtH);
        let min = 0, max = 0;
        for (const a of active) { const l = lim(a, t, dtH); min += l.min; max += l.max; }
        return { min, max };
      },
      uncontrolled(t, dtH) { return this.bounds(t, dtH).max; },
      ownChoice(t, dtH) {
        advance(t, dtH);
        let w = 0;
        for (const a of active) {
          const l = lim(a, t, dtH);
          if (rule === 'asap') w += l.max;
          else if (rule === 'spread') w += Math.min(l.max, Math.max(l.min, a.rem / (Math.max(1, a.dep - t) * dtH)));
          else w += a.plan?.has(t) ? l.max : l.min;
        }
        return w;
      },
      apply(t, want, dtH) {
        advance(t, dtH);
        const ls = active.map((a) => lim(a, t, dtH));
        const minSum = ls.reduce((s, l) => s + l.min, 0), maxSum = ls.reduce((s, l) => s + l.max, 0);
        let left = Math.min(maxSum, Math.max(minSum, want)) - minSum;
        let total = 0;
        active.forEach((a, i) => {
          const extra = Math.min(left, ls[i].max - ls[i].min);
          left -= extra;
          const x = ls[i].min + extra;
          a.rem = Math.max(0, a.rem - x * dtH);
          total += x;
        });
        delivered += total * dtH;
        return total;
      },
      state() {
        return { plugged: active.filter((a) => a.rem > 1e-9).length, needKWh: active.reduce((s, a) => s + a.rem, 0), unmetKWh: unmet, deliveredKWh: delivered, demandKWh: needed };
      },
      plan(t, H, mode: ForecastMode, dtH): FlexPlan {
        advance(t, dtH);
        const pmax = new Float64Array(H), emin = new Float64Array(H), emax = new Float64Array(H);
        const add = (arr: number, dep: number, rem: number) => {
          const s0 = Math.max(0, arr - t), steps = dep - t; // steps from now until departure
          if (steps <= 0 || rem <= 1e-9) return;
          rem = Math.min(rem, P * dtH * Math.max(0, steps - s0)); // cannot plan more than fits
          for (let h = 0; h < H; h++) {
            if (h >= s0 && h < steps) pmax[h] += P;
            const done = Math.max(0, Math.min(h + 1, steps) - s0);
            emax[h] += Math.min(rem, P * dtH * done);
            if (h >= s0) emin[h] += Math.max(0, rem - P * dtH * Math.max(0, steps - (h + 1)));
          }
        };
        for (const a of active) add(t, a.dep, a.rem);
        // future arrivals: the real ones (perfect) or last week's at the same time (realistic)
        const lag = mode === 'perfect' ? 0 : 7 * 96;
        for (let h = 1; h < H; h++) {
          for (const s of byArr.get(t + h - lag) ?? []) add(s.arr + lag, s.dep + lag, s.e);
        }
        return { kind: 'ev', pmax, emin, emax };
      },
    };
    return { id: inst.id, type: 'ev', role: 'flexible', flex, info: { vehicles: N, chargerKW: P, cappedKWhYear: capped } };
  },
};

export type EvSessions = NonNullable<SiteData['sessions']>[string];
