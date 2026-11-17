/**
 * Safety layer: enforces site rules AFTER the controller has asked and the physics has clipped.
 * Fixed order (tested): 0 battery-no-export rule -> 1 import limit -> 2 connection rating -> 3 export limit.
 * For import and the connection rating it first cuts battery charging, then slows flexible loads
 * (EV charging, heat pump) down to the power they must have (vans leaving, building heat).
 * It can only REDUCE what was asked (less charging, less discharging, PV curtailment). It never adds
 * discharge on its own. Overloads it cannot fix are recorded and reported, never hidden.
 */

export interface SafetyInput {
  /** uncontrollable, non-curtailable power (loads), kW */
  fixedKW: number;
  /** PV (curtailable) power, kW (<= 0) */
  pvKW: number;
  /** battery powers after physical clipping, kW */
  batt: number[];
  importLimitKW: number;
  exportLimitKW: number;
  fuseKW: number;
  /** v1 rule: batteries may not cause export (behind-the-meter only) */
  batteryNoExport: boolean;
  /** flexible loads: requested power and the minimum they must keep */
  flex?: { p: number; min: number }[];
}

export interface SafetyOutput {
  batt: number[];
  flex: number[];
  pvKW: number;
  curtailedKW: number;
  /** what the safety layer changed, in order applied */
  actions: ('noExport' | 'import' | 'fuse' | 'export')[];
  /** limits still violated after all actions (kW above limit) */
  violations: { import: number; fuse: number; export: number };
}

const EPS = 1e-9;

/** Reduce the positive (charging) parts of b by up to `amount`, proportionally. Returns amount achieved. */
function reduceCharging(b: number[], amount: number): number {
  const pos = b.reduce((s, x) => s + Math.max(0, x), 0);
  if (pos <= EPS || amount <= EPS) return 0;
  const cut = Math.min(amount, pos);
  for (let i = 0; i < b.length; i++) if (b[i] > 0) b[i] -= (b[i] / pos) * cut;
  return cut;
}

/** Reduce the negative (discharging) parts of b by up to `amount` (move toward 0). Returns amount achieved. */
function reduceDischarging(b: number[], amount: number): number {
  const neg = b.reduce((s, x) => s + Math.max(0, -x), 0);
  if (neg <= EPS || amount <= EPS) return 0;
  const cut = Math.min(amount, neg);
  for (let i = 0; i < b.length; i++) if (b[i] < 0) b[i] += (-b[i] / neg) * cut;
  return cut;
}

export function applySafety(inp: SafetyInput): SafetyOutput {
  const b = inp.batt.slice();
  const f = (inp.flex ?? []).map((x) => x.p);
  const fmin = (inp.flex ?? []).map((x) => x.min);
  let pv = inp.pvKW;
  const pv0 = pv;
  const actions: SafetyOutput['actions'] = [];
  const flexSum = () => f.reduce((s, x) => s + x, 0);
  const grid = () => inp.fixedKW + flexSum() + pv + b.reduce((s, x) => s + x, 0);
  /** slow flexible loads toward their minimum, proportionally to their room */
  const reduceFlex = (amount: number) => {
    const room = f.reduce((s, x, i) => s + Math.max(0, x - fmin[i]), 0);
    if (room <= EPS || amount <= EPS) return;
    const cut = Math.min(amount, room);
    for (let i = 0; i < f.length; i++) f[i] -= (Math.max(0, f[i] - fmin[i]) / room) * cut;
  };

  // 0. battery may discharge only to cover the site's own net consumption
  if (inp.batteryNoExport) {
    const net = inp.fixedKW + flexSum() + pv; // site without battery
    const dis = b.reduce((s, x) => s + Math.max(0, -x), 0);
    const ch = b.reduce((s, x) => s + Math.max(0, x), 0);
    const allowedDis = Math.max(0, net + ch);
    if (dis > allowedDis + EPS) {
      reduceDischarging(b, dis - allowedDis);
      actions.push('noExport');
    }
  }
  // 1. import limit: cut battery charging
  if (grid() > inp.importLimitKW + EPS) {
    reduceCharging(b, grid() - inp.importLimitKW);
    reduceFlex(grid() - inp.importLimitKW);
    actions.push('import');
  }
  // 2. connection rating, both directions
  if (grid() > inp.fuseKW + EPS) {
    reduceCharging(b, grid() - inp.fuseKW);
    reduceFlex(grid() - inp.fuseKW);
    actions.push('fuse');
  }
  if (grid() < -inp.fuseKW - EPS) {
    const need = -inp.fuseKW - grid();
    const got = reduceDischarging(b, need);
    pv += Math.min(-pv, need - got);
    actions.push('fuse');
  }
  // 3. export limit: cut battery discharge first, then curtail PV
  if (grid() < -inp.exportLimitKW - EPS) {
    const need = -inp.exportLimitKW - grid();
    const got = reduceDischarging(b, need);
    pv += Math.min(-pv, need - got);
    actions.push('export');
  }
  const g = grid();
  return {
    batt: b,
    flex: f,
    pvKW: pv,
    curtailedKW: pv - pv0,
    actions,
    violations: {
      import: Math.max(0, g - inp.importLimitKW),
      fuse: Math.max(0, Math.abs(g) - inp.fuseKW),
      export: Math.max(0, -g - inp.exportLimitKW),
    },
  };
}
