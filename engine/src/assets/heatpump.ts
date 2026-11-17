import type { AssetType, FlexModel, FlexPlan } from '../core/types';
import { num, resolve, str } from '../core/params';
import { berlinDay } from '../core/time';
import type { ForecastMode } from '../forecast/forecast';

const W2H = 'Heating degree days G20/15 (VDI 3807) on DWD Leipzig temperatures; COP curve: When2Heat (Ruhnau et al. 2019, Scientific Data)';

/**
 * Air-source heat pump with a hot-water buffer tank.
 *   heat demand  Q(t) = annual space heat × profile + annual hot water × profile          [kW heat]
 *   efficiency   COP(t) from outdoor temperature (radiators or floor heating; hot water at 50 °C)
 *   tank         S(t+1) = S(t) + (COP·p − Q)·dt,  0 ≤ S ≤ S_max                          [kWh heat]
 *   bounds       min = what must run so the tank does not run dry; max = rated power, or less if the tank is full
 * "On demand" (baseline): p = Q / COP, the tank level stays where it is.
 * Heat that cannot be delivered (tank empty and heat pump at full power) is counted as unmet and reported.
 * Not modelled: tank heat losses, defrost cycles, minimum run times (LIMITS L-016).
 */
export const heatPumpAsset: AssetType = {
  type: 'heatpump',
  label: 'Heat pump + buffer tank',
  role: 'flexible',
  ports: [{ id: 'ac', flow: 'power', direction: 'in' }, { id: 'heat', flow: 'heat', direction: 'out' }],
  icon: 'heatpump',
  color: '#d9466b',
  description: 'Air-source heat pump heating the building, with a hot-water tank so it can heat earlier, when power is cheap or the peak is low.',
  guide: 'ch5',
  available: true,
  params: [
    { key: 'annualHeatMWh', label: 'Space heating per year', unit: 'MWh heat', kind: 'number', default: 300, min: 10, max: 10000, step: 10,
      help: 'Heat the building needs for rooms in a year. Spread over the year by how cold it is in Leipzig: more on cold days and cold hours, none on days warmer than 15 °C.',
      source: 'example choice; profile: ' + W2H, guide: 'ch5' },
    { key: 'annualWaterMWh', label: 'Hot water per year', unit: 'MWh heat', kind: 'number', default: 20, min: 0, max: 2000, step: 5,
      help: 'Heat for washing water, roughly even over the year.', source: 'example choice; profile: ' + W2H, guide: 'ch5' },
    { key: 'emitter', label: 'Heating system', unit: '', kind: 'select', default: 'radiator',
      options: [{ value: 'radiator', label: 'Radiators (needs hotter water, lower efficiency)' }, { value: 'floor', label: 'Floor heating (cooler water, higher efficiency)' }],
      help: 'The hotter the water must be, the harder the heat pump works. Radiators need about 40 °C minus the outdoor temperature; floor heating 30 °C minus half of it.',
      source: W2H, guide: 'ch5' },
    { key: 'powerKW', label: 'Electric power', unit: 'kW', kind: 'number', default: 110, min: 5, max: 5000, step: 5,
      help: 'Most electricity the heat pump can draw. Heat output = electric power × COP.', source: 'example choice', guide: 'ch5' },
    { key: 'tankKWh', label: 'Buffer tank', unit: 'kWh heat', kind: 'number', default: 200, min: 0, max: 20000, step: 10,
      help: 'Heat the tank can store. 200 kWh ≈ 5 m³ of water heated by 35 °C. A bigger tank lets the heat pump shift more.', source: 'example choice', guide: 'ch5' },
    { key: 'strategy', label: 'Operating rule', unit: '', kind: 'select', default: 'onDemand',
      options: [{ value: 'onDemand', label: 'On demand (no control)' }, { value: 'cheapHours', label: 'Pre-heat in the 6 cheapest hours of the day' }],
      help: 'What the heat pump does on its own. When the site strategy is the MPC, the planner decides instead. The baseline always uses "on demand".',
      source: 'example choice', guide: 'ch14' },
  ],
  create(inst, data) {
    const p = resolve(this.params, inst.params);
    const sp = data.series.heat_space_com, wa = data.series.heat_water_com;
    const copS = data.series[str(p, 'emitter') === 'floor' ? 'cop_air_floor' : 'cop_air_radiator'], copW = data.series.cop_air_water;
    if (!sp || !wa || !copS || !copW) throw new Error('missing heat data (heat_space_com, cop_air_*)');
    const aS = num(p, 'annualHeatMWh'), aW = num(p, 'annualWaterMWh');
    const P = num(p, 'powerKW'), Smax = num(p, 'tankKWh');
    const cheap = str(p, 'strategy') === 'cheapHours';
    const price = data.series.price_da;
    const start = Date.parse(data.start), stepMs = data.stepMinutes * 60000;
    let S = Smax / 2, unmet = 0, heatOut = 0, elec = 0;
    const heat = (t: number) => aS * sp[t] + aW * wa[t];
    /** one COP for the step: total heat / total electricity of the two uses */
    const cop = (t: number) => {
      const qs = aS * sp[t], qw = aW * wa[t];
      const e = qs / copS[t] + qw / copW[t];
      return e > 1e-9 ? (qs + qw) / e : copS[t];
    };
    const bnd = (t: number, dtH: number) => {
      const Q = heat(t), c = cop(t);
      const max = Math.min(P, Math.max(0, (Smax - S + Q * dtH) / (c * dtH)));
      const min = Math.min(max, Math.max(0, (Q * dtH - S) / (c * dtH)));
      return { min, max, Q, c };
    };
    let dayKey = NaN; let cheapSet = new Set<number>();
    const flex: FlexModel = {
      kind: 'heatpump',
      bounds: (t, dtH) => { const b = bnd(t, dtH); return { min: b.min, max: b.max }; },
      uncontrolled(t, dtH) { const b = bnd(t, dtH); return Math.min(b.max, Math.max(b.min, b.Q / b.c)); },
      ownChoice(t, dtH) {
        if (!cheap) return this.uncontrolled(t, dtH);
        const { day, minute } = berlinDay(start + t * stepMs);
        if (day !== dayKey) {
          dayKey = day;
          const first = t - Math.round(minute / data.stepMinutes), steps: number[] = [];
          for (let k = Math.max(0, first); k < first + 100 && k < data.n; k++) if (berlinDay(start + k * stepMs).day === day) steps.push(k);
          cheapSet = new Set([...steps].sort((a, b) => price[a] - price[b]).slice(0, 24));
        }
        const b = bnd(t, dtH);
        return cheapSet.has(t) ? b.max : b.min;
      },
      apply(t, want, dtH) {
        const b = bnd(t, dtH);
        const x = Math.min(b.max, Math.max(b.min, want));
        S += (b.c * x - b.Q) * dtH;
        if (S < 0) { unmet += -S; S = 0; }
        if (S > Smax) S = Smax;
        heatOut += b.c * x * dtH; elec += x * dtH;
        return x;
      },
      state: () => ({ tank: Smax > 0 ? S / Smax : 0, tankKWh: S, unmetKWh: unmet, heatKWh: heatOut, elecKWh: elec }),
      plan(t, H, mode: ForecastMode): FlexPlan {
        const heatF = new Float64Array(H), copF = new Float64Array(H), pmax = new Float64Array(H).fill(P);
        for (let h = 0; h < H; h++) {
          // realistic: same quarter-hour yesterday (persistence of weather); now is known
          const k = Math.min(data.n - 1, mode === 'perfect' || h === 0 ? t + h : Math.max(0, t + h - 96));
          heatF[h] = heat(k); copF[h] = cop(k);
        }
        return { kind: 'heatpump', pmax, heat: heatF, cop: copF, s0: S, smax: Smax };
      },
    };
    return { id: inst.id, type: 'heatpump', role: 'flexible', flex, info: { powerKW: P, tankKWh: Smax } };
  },
};
