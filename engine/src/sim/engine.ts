import { resolve, num, bool, str } from '../core/params';
import type { AssetInstance, AssetModel, ParamValues, SiteData } from '../core/types';
import { assetType } from '../assets/registry';
import { gridAsset } from '../assets/grid';
import type { Controller, ControllerContext, Observation } from '../control/types';
import { controllerType } from '../control/registry';
import type { Solver } from '../control/lp';
import { computeBill, tariffSignal, type Bill, type TariffDE, type TariffSignal } from '../tariff/de';
import { Forecaster, type ForecastMode } from '../forecast/forecast';
import { applySafety } from './safety';

export interface SiteSpec {
  name: string;
  description?: string;
  assets: AssetInstance[];
  controller: { type: string; params: ParamValues };
  /** what look-ahead controllers may know (default: perfect) */
  forecast?: ForecastMode;
}

export interface RunOptions {
  /** first step on the data axis */
  startStep: number;
  /** number of 15-min steps */
  steps: number;
  /** override the controller (used to run the idle baseline on the same site) */
  controller?: Controller;
  /** price series key */
  priceKey?: string;
  /** override the site's forecast mode (used by "Compare forecasts") */
  forecast?: ForecastMode;
  /** LP solver, required by the MPC */
  solver?: Solver;
  /** called about 50 times per run with the share done (0-1) */
  onProgress?: (share: number) => void;
  /** the reference run: battery idle, EV chargers and heat pumps without control */
  baseline?: boolean;
}

/** Every plan the controller made: plan i was made at step atSteps[i] (run index) and covers `horizon` quarter-hours. */
export interface PlanLog {
  horizon: number;
  atSteps: Int32Array;
  soc: Float32Array;
  netForecastKW: Float32Array;
}

export interface AssetTrace {
  id: string;
  type: string;
  name: string;
  /** power per step, kW, sign convention: + draws from bus */
  power: Float64Array;
}

export interface SimResult {
  site: string;
  controller: string;
  startStep: number;
  steps: number;
  dtH: number;
  startISO: string;
  assets: AssetTrace[];
  gridKW: Float64Array;
  priceEurMWh: Float64Array;
  curtailedKW: Float64Array;
  soc: Record<string, Float64Array>;
  safety: {
    actions: Record<string, number>;
    violations: Record<'import' | 'fuse' | 'export', { steps: number; maxKW: number }>;
  };
  /** max |supply - demand| over all steps, kW (must be ~0) */
  balanceResidualKW: number;
  battery: { chargeKWh: number; dischargeKWh: number; capacityKWh: number; efc: number };
  bill: Bill;
  forecast: ForecastMode;
  /** prices the controller planned with (expected regime, see D-010) */
  signal: TariffSignal;
  plans: PlanLog | null;
  /** flexible loads over time: EV energy still needed (kWh) and vans plugged in; heat-pump tank level (0-1) */
  flexState: Record<string, { kind: 'ev' | 'heatpump'; level: Float64Array; count?: Float64Array }>;
  /** energy the vans still lacked when they left; heat the building did not get (both kWh, should be 0) */
  flexSummary: { evUnmetKWh: number; evDeliveredKWh: number; heatUnmetKWh: number; heatDeliveredKWh: number; hpElecKWh: number };
}

/** Simulate one site over a window of the data year. Pure: same inputs give the same outputs. */
export function simulate(site: SiteSpec, data: SiteData, tariff: TariffDE, opt: RunOptions): SimResult {
  const dtH = data.stepMinutes / 60;
  const gridInst = site.assets.filter((a) => a.type === 'grid');
  if (gridInst.length !== 1) throw new Error('a site needs exactly one grid connection');
  const gp = resolve(gridAsset.params, gridInst[0].params);
  const importLimit = num(gp, 'importLimitKW');
  const exportLimit = num(gp, 'exportLimitKW');
  const fuse = num(gp, 'fuseKW');

  const insts = site.assets.filter((a) => a.type !== 'grid');
  const models: AssetModel[] = insts.map((a) => {
    const t = assetType(a.type);
    if (!t.available || !t.create) throw new Error(`asset type ${a.type} is not available yet`);
    return t.create(a, data);
  });
  const batts = models.filter((m) => m.role === 'storage');
  const flexIdx = models.map((m, i) => (m.flex ? i : -1)).filter((i) => i >= 0);
  const fixedIdx = models.map((m, i) => (m.fixedPower && !m.curtailable ? i : -1)).filter((i) => i >= 0);
  const pvIdx = models.map((m, i) => (m.curtailable ? i : -1)).filter((i) => i >= 0);

  const fixedAt = (t: number) => fixedIdx.reduce((s, i) => s + models[i].fixedPower!(t), 0);
  const pvAt = (t: number) => pvIdx.reduce((s, i) => s + models[i].fixedPower!(t), 0);
  const billOpt = { level: str(gp, 'level'), manufacturing: bool(gp, 'manufacturing'), supplierMarginCt: num(gp, 'supplierMarginCt') };
  // expected tariff regime: the site WITHOUT battery and WITHOUT control over the whole data year (D-010).
  // Flexible loads are stateful, so fresh copies run uncontrolled through the year.
  const flexCopies = insts.filter((a) => a.type === 'ev' || a.type === 'heatpump').map((a) => assetType(a.type).create!(a, data).flex!);
  let baseImp = 0, basePeak = 0;
  for (let t = 0; t < data.n; t++) {
    let g = fixedAt(t) + pvAt(t);
    for (const fx of flexCopies) g += fx.apply(t, fx.uncontrolled(t, dtH), dtH);
    if (g > 0) { baseImp += g * dtH; if (g > basePeak) basePeak = g; }
  }
  const signal = tariffSignal(tariff, billOpt, (baseImp * 365 * 24) / (data.n * dtH), basePeak);
  const mode: ForecastMode = opt.forecast ?? site.forecast ?? 'perfect';
  const forecaster = new Forecaster(mode, data, fixedAt, pvAt, opt.priceKey);
  const ctx: ControllerContext = { signal, solver: opt.solver };
  const ctrl = opt.baseline ? controllerType('idle').create!({}, ctx)
    : opt.controller ?? controllerType(site.controller.type).create!(site.controller.params, ctx);
  const flexState: SimResult['flexState'] = Object.fromEntries(flexIdx.map((i) => [models[i].id, {
    kind: models[i].flex!.kind, level: new Float64Array(opt.steps), ...(models[i].flex!.kind === 'ev' ? { count: new Float64Array(opt.steps) } : {}),
  }]));
  const planAt: number[] = [], planSoc: Float32Array[] = [], planNet: Float32Array[] = [];
  const price = data.series[opt.priceKey ?? 'price_da'];
  const N = opt.steps;
  const traces: AssetTrace[] = insts.map((a) => ({ id: a.id, type: a.type, name: a.name, power: new Float64Array(N) }));
  const gridKW = new Float64Array(N);
  const priceOut = new Float64Array(N);
  const curtailed = new Float64Array(N);
  const soc: Record<string, Float64Array> = Object.fromEntries(batts.map((b) => [b.id, new Float64Array(N)]));
  const actions: Record<string, number> = { noExport: 0, import: 0, fuse: 0, export: 0 };
  const viol = { import: { steps: 0, maxKW: 0 }, fuse: { steps: 0, maxKW: 0 }, export: { steps: 0, maxKW: 0 } };
  let peakSoFar = 0, maxResidual = 0, chKWh = 0, disKWh = 0;

  for (let k = 0; k < N; k++) {
    const t = opt.startStep + k;
    // 1. uncontrollable assets
    const fixedP = models.map((m) => (m.fixedPower ? m.fixedPower(t) : 0));
    const fixedKW = fixedIdx.reduce((s, i) => s + fixedP[i], 0);
    const pvKW = pvIdx.reduce((s, i) => s + fixedP[i], 0);
    // 2. flexible loads: what they must / can take, and what their own rule (or no control, in the baseline) asks
    const fb = flexIdx.map((i) => models[i].flex!.bounds(t, dtH));
    const fRule = flexIdx.map((i) => (opt.baseline ? models[i].flex!.uncontrolled(t, dtH) : models[i].flex!.ownChoice(t, dtH)));
    const flexRuleKW = fRule.reduce((s, x) => s + x, 0);
    // 3. controller asks
    const bnds = batts.map((b) => b.bounds!(dtH));
    const obs: Observation = {
      t, dtH, netFixedKW: fixedKW + pvKW + flexRuleKW, loadPvKW: fixedKW + pvKW, priceEurMWh: price[t], peakSoFarKW: peakSoFar,
      importLimitKW: importLimit, exportLimitKW: exportLimit, data,
      flex: flexIdx.map((i, j) => ({
        id: models[i].id, kind: models[i].flex!.kind, min: fb[j].min, max: fb[j].max, rule: fRule[j],
        plan: (H: number) => models[i].flex!.plan(t, H, mode, dtH),
      })),
      forecast: (H: number) => forecaster.window(t, H),
      batteries: batts.map((b, i) => ({
        id: b.id, soc: b.state!().soc, energyKWh: b.state!().energyKWh,
        capacityKWh: b.info!.capacityKWh, powerKW: b.info!.powerKW, min: bnds[i].min, max: bnds[i].max,
        eMin: b.info!.eMin, eMax: b.info!.eMax, eta: b.info!.eta,
      })),
    };
    const ask = ctrl.decide(obs);
    if (ctrl.lastPlan && ctrl.lastPlan.atStep === t) { planAt.push(k); planSoc.push(ctrl.lastPlan.soc); planNet.push(ctrl.lastPlan.netForecastKW); }
    if (opt.onProgress && k % Math.max(1, Math.floor(N / 50)) === 0) opt.onProgress(k / N);
    // 4. physics clips the request (flexible loads the controller left out follow their own rule)
    const clipped = batts.map((b, i) => Math.min(bnds[i].max, Math.max(bnds[i].min, ask[b.id] ?? 0)));
    const fClipped = flexIdx.map((i, j) => Math.min(fb[j].max, Math.max(fb[j].min, opt.baseline ? fRule[j] : ask[models[i].id] ?? fRule[j])));
    // 5. safety layer enforces site rules, in fixed order
    const s = applySafety({ fixedKW, pvKW, batt: clipped, importLimitKW: importLimit, exportLimitKW: exportLimit, fuseKW: fuse, batteryNoExport: true,
      flex: fClipped.map((x, j) => ({ p: x, min: fb[j].min })) });
    for (const a of s.actions) actions[a]++;
    // 6. apply
    const actual = batts.map((b, i) => b.apply!(s.batt[i], dtH));
    const fActual = flexIdx.map((i, j) => models[i].flex!.apply(t, s.flex[j], dtH));
    const pvScale = pvKW < 0 ? s.pvKW / pvKW : 1;
    let grid = 0;
    let load = 0, gen = 0, ch = 0, dis = 0;
    models.forEach((m, i) => {
      let p = fixedP[i];
      if (m.curtailable) p *= pvScale;
      const bi = batts.indexOf(m);
      if (bi >= 0) p = actual[bi];
      const fi = flexIdx.indexOf(i);
      if (fi >= 0) p = fActual[fi];
      traces[i].power[k] = p;
      grid += p;
      if (m.role === 'storage') { if (p > 0) ch += p; else dis -= p; }
      else if (p > 0) load += p; else gen -= p;
    });
    gridKW[k] = grid;
    priceOut[k] = price[t];
    curtailed[k] = s.curtailedKW;
    batts.forEach((b) => (soc[b.id][k] = b.state!().soc));
    flexIdx.forEach((i) => {
      const st = models[i].flex!.state(), fs = flexState[models[i].id];
      if (fs.kind === 'ev') { fs.level[k] = st.needKWh; fs.count![k] = st.plugged; } else fs.level[k] = st.tank;
    });
    // 6. checks: energy balance at the bus, limits
    const imp = Math.max(0, grid), exp = Math.max(0, -grid);
    maxResidual = Math.max(maxResidual, Math.abs(imp + gen + dis - (exp + load + ch)));
    chKWh += ch * dtH; disKWh += dis * dtH;
    if (grid > peakSoFar) peakSoFar = grid;
    const v = { import: Math.max(0, grid - importLimit), fuse: Math.max(0, Math.abs(grid) - fuse), export: Math.max(0, -grid - exportLimit) };
    (Object.keys(v) as (keyof typeof v)[]).forEach((key) => {
      if (v[key] > 1e-6) { viol[key].steps++; viol[key].maxKW = Math.max(viol[key].maxKW, v[key]); }
    });
  }

  const capacity = batts.reduce((s, b) => s + b.info!.capacityKWh, 0);
  const flexSummary = { evUnmetKWh: 0, evDeliveredKWh: 0, heatUnmetKWh: 0, heatDeliveredKWh: 0, hpElecKWh: 0 };
  for (const i of flexIdx) {
    const st = models[i].flex!.state();
    if (models[i].flex!.kind === 'ev') { flexSummary.evUnmetKWh += st.unmetKWh; flexSummary.evDeliveredKWh += st.deliveredKWh; }
    else { flexSummary.heatUnmetKWh += st.unmetKWh; flexSummary.heatDeliveredKWh += st.heatKWh; flexSummary.hpElecKWh += st.elecKWh; }
  }
  const bill = computeBill(gridKW, priceOut, dtH, tariff, billOpt);
  let plans: PlanLog | null = null;
  if (planAt.length) {
    const hz = planSoc[0].length;
    const soc = new Float32Array(planAt.length * hz), net = new Float32Array(planAt.length * hz);
    planSoc.forEach((a, i) => soc.set(a.subarray(0, hz), i * hz));
    planNet.forEach((a, i) => net.set(a.subarray(0, hz), i * hz));
    plans = { horizon: hz, atSteps: Int32Array.from(planAt), soc, netForecastKW: net };
  }
  const startMs = Date.parse(data.start) + opt.startStep * data.stepMinutes * 60000;
  return {
    site: site.name, controller: ctrl.name, startStep: opt.startStep, steps: N, dtH,
    startISO: new Date(startMs).toISOString(),
    assets: traces, gridKW, priceEurMWh: priceOut, curtailedKW: curtailed, soc,
    safety: { actions, violations: viol },
    balanceResidualKW: maxResidual,
    battery: { chargeKWh: chKWh, dischargeKWh: disKWh, capacityKWh: capacity, efc: capacity > 0 ? (chKWh + disKWh) / 2 / capacity : 0 },
    bill, forecast: mode, signal, plans, flexState, flexSummary,
  };
}
