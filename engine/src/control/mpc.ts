import { num, resolve } from '../core/params';
import { solveLp, type LpInput, type LpPlan } from './lp';
import type { Controller, ControllerType, Observation } from './types';

/**
 * Model predictive control (MPC).
 *   every hour:  look H hours ahead through the forecast, solve the linear program in lp.ts
 *                (lowest energy cost + peak charge + wear), keep the plan
 *   every step:  do what the plan says for this quarter-hour, with a real-time peak guard:
 *                if the actual load is higher than forecast, discharge more so import stays at the planned peak
 * Plan resolution (DECISIONS D-019): the first 4 h in quarter-hours, the rest in hourly blocks.
 */
const FINE_STEPS = 16;   // 4 h of quarter-hours
const BLOCK = 4;         // then 1 h blocks

export const mpcController: ControllerType = {
  type: 'mpc',
  label: 'MPC (optimiser)',
  description: 'Every hour, plans the next 24 h with a linear program: lowest energy cost + peak charge + battery wear. It plans the battery, the EV fleet and the heat pump together, then follows the plan.',
  guide: 'ch16',
  available: true,
  usesForecast: true,
  needsSolver: true,
  params: [
    { key: 'horizonH', label: 'Look-ahead', unit: 'h', kind: 'select', default: '24',
      options: [{ value: '12', label: '12 h' }, { value: '24', label: '24 h' }, { value: '36', label: '36 h' }],
      help: 'How far ahead each plan looks. Day-ahead prices are known at most ~35 h ahead; beyond that the forecast is a guess.',
      source: 'example choice', guide: 'ch16' },
    { key: 'wearEurPerMWh', label: 'Wear cost', unit: '€/MWh', kind: 'number', default: 78, min: 0, max: 500, step: 1,
      help: 'Cost the planner charges itself per MWh discharged, for battery ageing. 78 = 625 €/kWh investment ÷ 8,000 full cycles (datasheet). A simple placeholder until the wear model (step 3).',
      source: 'Fraunhofer ISE 2024 capex midpoint ÷ FoxESS datasheet cycle life; the division is our simplification', guide: 'ch11' },
  ],
  create(params, ctx) {
    const p = resolve(this.params, params);
    const H15 = Number(p.horizonH) * 4;
    const wear = num(p, 'wearEurPerMWh') / 1000;
    const solver = ctx?.solver;
    if (!ctx || !solver) throw new Error('The MPC needs the HiGHS solver. Load it first (loadSolver).');
    const sig = ctx.signal;
    let plan: LpPlan | null = null, planAt = -1, blocks: number[] = [];
    let planFlex: { id: string; kind: 'ev' | 'heatpump'; j: number }[] = [];
    const self: Controller = { name: 'mpc', decide: () => ({}) };
    self.decide = (o: Observation) => {
      const bs = o.batteries;
      const P = bs.reduce((s, b) => s + b.powerKW, 0);
      if (P <= 0 && !o.flex.length) return {};
      const minsInto = Math.round((o.t * o.data.stepMinutes) % 60);
      if (!plan || o.t - planAt >= 4 || minsInto === 0) {
        // ---- re-plan ----
        const fc = o.forecast(H15);
        // block layout: quarter-hours first, then hourly blocks
        blocks = [];
        for (let h = 0; h < H15;) { const len = h < FINE_STEPS ? 1 : Math.min(BLOCK, H15 - h); blocks.push(len); h += len; }
        const B = blocks.length;
        const ends: number[] = [];
        const net = new Float64Array(B), pv = new Float64Array(B), buy = new Float64Array(B), sell = new Float64Array(B), dt = new Float64Array(B);
        let h = 0;
        blocks.forEach((len, j) => {
          for (let q = 0; q < len; q++, h++) {
            net[j] += fc.netKW[h] / len; pv[j] += fc.pvKW[h] / len;
            buy[j] += (fc.priceEurMWh[h] / 1000 + sig.addersEurPerKWh) / len;
            sell[j] += Math.max(0, fc.priceEurMWh[h]) / 1000 / len;
          }
          dt[j] = len * o.dtH;
          ends.push(h - 1);
        });
        // flexible loads, aggregated onto the same blocks
        const avg = (a: Float64Array) => { let i = 0; return blocks.map((len) => { let x = 0; for (let q = 0; q < len; q++, i++) x += a[i]; return x / len; }); };
        const atEnd = (a: Float64Array) => ends.map((e) => a[e]);
        const evs: NonNullable<LpInput['evs']> = [], hps: NonNullable<LpInput['hps']> = [];
        const flexIds: { id: string; kind: 'ev' | 'heatpump'; j: number }[] = [];
        const sortedBuy = Array.from(buy).sort((a, b) => a - b);
        const medBuy = sortedBuy[Math.floor(B / 2)];
        for (const fx of o.flex) {
          const fp = fx.plan(H15);
          if (fp.kind === 'ev') { flexIds.push({ id: fx.id, kind: 'ev', j: evs.length }); evs.push({ pmax: avg(fp.pmax), emin: atEnd(fp.emin), emax: atEnd(fp.emax) }); }
          else {
            // block COP: heat over electricity, so the block needs the same electricity as its quarter-hours
            let i = 0;
            const cop = blocks.map((len) => { let qh = 0, el = 0; for (let q = 0; q < len; q++, i++) { qh += fp.heat[i]; el += fp.heat[i] / fp.cop[i]; } return el > 1e-9 ? qh / el : fp.cop[i - 1]; });
            const meanCop = cop.reduce((s, x) => s + x, 0) / B;
            flexIds.push({ id: fx.id, kind: 'heatpump', j: hps.length });
            hps.push({ pmax: avg(fp.pmax), heat: avg(fp.heat), cop, s0: fp.s0, smax: fp.smax, terminalEurPerKWhHeat: Math.max(0, medBuy / meanCop) });
          }
        }
        const e0 = bs.reduce((s, b) => s + b.energyKWh, 0);
        const cap = bs.reduce((s, b) => s + b.capacityKWh, 0);
        const eta = cap > 0 ? bs.reduce((s, b) => s + b.eta * b.capacityKWh, 0) / cap : 1;
        const terminal = Math.max(0, eta * (medBuy - wear));
        plan = solveLp(solver, {
          dtH: dt, netKW: net, pvKW: pv, buy, sell,
          peakEurPerKW: sig.peakEurPerKWYear, peakSoFarKW: o.peakSoFarKW,
          importLimitKW: o.importLimitKW, exportLimitKW: o.exportLimitKW,
          e0, eMin: bs.reduce((s, b) => s + b.eMin, 0), eMax: bs.reduce((s, b) => s + b.eMax, 0),
          powerKW: P, eta, wearEurPerKWh: wear, terminalEurPerKWh: terminal, evs, hps,
        });
        planFlex = flexIds;
        planAt = o.t;
        // snapshot for the app: planned SoC per quarter-hour (linear inside hourly blocks)
        const soc = new Float32Array(H15);
        let q = 0, ePrev = e0;
        blocks.forEach((len, j) => {
          for (let r = 1; r <= len; r++, q++) soc[q] = cap > 0 ? (ePrev + ((plan!.energy[j] - ePrev) * r) / len) / cap : 0;
          ePrev = plan!.energy[j];
        });
        self.lastPlan = { atStep: o.t, soc, netForecastKW: Float32Array.from(fc.netKW) };
      }
      // ---- follow the plan for this quarter-hour ----
      const k = o.t - planAt; // 0..3, all inside the quarter-hour part of the plan
      const out: Record<string, number> = {};
      let flexKW = 0;
      const flexNow = planFlex.map((pf) => {
        const fx = o.flex.find((x) => x.id === pf.id)!;
        const v = pf.kind === 'ev' ? plan!.ev[pf.j][k] : plan!.hp[pf.j][k];
        const x = Math.min(fx.max, Math.max(fx.min, v));
        flexKW += x;
        return { fx, x };
      });
      let want = P > 0 ? plan.charge[k] - plan.discharge[k] : 0;
      // real-time peak guard: keep import at or below the planned peak even if the load is higher than forecast:
      // first slow flexible loads (down to what they must take), then discharge the battery more
      const capKW = Math.max(plan.peakKW, o.peakSoFarKW);
      let over = o.loadPvKW + flexKW + want - capKW;
      for (const f of flexNow) {
        if (over <= 1e-6) break;
        const cut = Math.min(over, f.x - f.fx.min);
        f.x -= cut; over -= cut;
      }
      if (over > 1e-6) want -= over;
      for (const f of flexNow) out[f.fx.id] = f.x;
      if (P > 0) for (const b of bs) out[b.id] = (want * b.powerKW) / P;
      return out;
    };
    return self;
  },
};
