/**
 * The MPC's linear program: one battery (several batteries are planned as one, see DECISIONS D-020),
 * H quarter-hours ahead. All powers in kW, energies in kWh, money in EUR.
 *
 * Variables, per step h:
 *   c_h, d_h   charge / discharge power at the bus         0 ≤ c_h, d_h ≤ P
 *   e_h        stored energy at the END of step h           Emin ≤ e_h ≤ Emax
 *   i_h, x_h   grid import / export                         i_h ≥ 0, 0 ≤ x_h ≤ min(exportLimit, solar surplus)
 *   u_h        solar curtailed                              0 ≤ u_h ≤ solar output
 *   s_h        import above the connection limit (slack, heavily penalised so the LP is always feasible)
 *   pk         highest import in the billing period         pk ≥ peak so far
 *
 * Flexible loads (optional, any number):
 *   EV fleet f    v_fh  fleet charging power, 0 ≤ v ≤ P_fh (vans plugged in)
 *                 C_fh = C_f,h−1 + v_fh·dt   cumulative energy from now, C_fh ≤ E^max_fh,  C_fh + z_fh ≥ E^min_fh
 *                 (E^min: what must be delivered by then because vans leave; E^max: the most that could be;
 *                  z = shortfall slack, heavily penalised)
 *   heat pump g   q_gh  electric power, 0 ≤ q ≤ P_g;  tank T_gh = T_g,h−1 + (COP_gh·q_gh − Q_gh + w_gh)·dt,  0 ≤ T ≤ T_max
 *                 (w = heat not delivered, heavily penalised); tank heat left at the end is valued like battery energy
 *
 * Constraints:
 *   bus balance   i_h − x_h = net_h + c_h − d_h + u_h + Σ_f v_fh + Σ_g q_gh
 *   storage       e_h = e_{h−1} + η·c_h·dt − d_h/η·dt
 *   peak          i_h ≤ pk
 *   limit         i_h − s_h ≤ importLimit
 *
 * Objective (minimise):
 *   Σ_h dt·[ buy_h·i_h − sell_h·x_h + wear·d_h + ε·(c_h + d_h) + M·s_h ]   energy, export, wear
 *   + peakPrice·pk                                                         peak charge (annual €/kW)
 *   − terminal·e_{H−1}                                                     value of energy left at the end
 * The x_h bound "≤ solar surplus" is what stops the battery exporting (DECISIONS D-011).
 */
export interface LpInput {
  /** step length per step, hours (steps may differ: fine near-term, coarse far ahead) */
  dtH: ArrayLike<number>;
  netKW: ArrayLike<number>;
  pvKW: ArrayLike<number>;
  /** EUR/kWh paid per kWh imported (spot + all per-kWh charges) */
  buy: ArrayLike<number>;
  /** EUR/kWh earned per kWh exported */
  sell: ArrayLike<number>;
  peakEurPerKW: number;
  peakSoFarKW: number;
  importLimitKW: number;
  exportLimitKW: number;
  e0: number; eMin: number; eMax: number; powerKW: number; eta: number;
  wearEurPerKWh: number;
  terminalEurPerKWh: number;
  /** EV fleets: per step max power, and cumulative must / can energy from now (kWh) */
  evs?: { pmax: ArrayLike<number>; emin: ArrayLike<number>; emax: ArrayLike<number> }[];
  /** heat pumps: per step max electric power, heat demand (kW heat), COP; tank now and size (kWh heat) */
  hps?: { pmax: ArrayLike<number>; heat: ArrayLike<number>; cop: ArrayLike<number>; s0: number; smax: number; terminalEurPerKWhHeat: number }[];
}

export interface LpPlan {
  status: string;
  objective: number;
  charge: Float64Array;
  discharge: Float64Array;
  energy: Float64Array;
  importKW: Float64Array;
  peakKW: number;
  /** planned power per EV fleet / heat pump (same order as the input) */
  ev: Float64Array[];
  hp: Float64Array[];
  hpTank: Float64Array[];
}

const EPS = 1e-4; // EUR/kWh: tiny throughput cost so the LP never charges and discharges in the same step
const M = 10;     // EUR/kWh: penalty for import above the connection limit (the safety layer will clip anyway)
const f = (x: number) => (Math.abs(x) < 1e-12 ? '0' : Number(x.toPrecision(10)).toString());
const term = (coef: number, v: string) => (coef >= 0 ? ` + ${f(coef)} ${v}` : ` - ${f(-coef)} ${v}`);

/** Build the problem in CPLEX LP text format (read by HiGHS). */
export function buildLp(p: LpInput): string {
  const H = p.netKW.length;
  const obj: string[] = [];
  const st: string[] = [];
  const bd: string[] = [];
  obj.push(term(p.peakEurPerKW, 'pk'));
  for (let h = 0; h < H; h++) {
    const dt = p.dtH[h];
    obj.push(term(dt * p.buy[h], `i${h}`), term(-dt * p.sell[h], `x${h}`),
      term(dt * (p.wearEurPerKWh + EPS), `d${h}`), term(dt * EPS, `c${h}`), term(dt * M, `s${h}`));
    if (h === H - 1) obj.push(term(-p.terminalEurPerKWh, `e${h}`));
    // bus balance: i − x − c + d − u − Σv − Σq = net
    const flexTerms = (p.evs ?? []).map((_, j) => ` - v${j}_${h}`).join('') + (p.hps ?? []).map((_, j) => ` - q${j}_${h}`).join('');
    st.push(` b${h}: i${h} - x${h} - c${h} + d${h} - u${h}${flexTerms} = ${f(p.netKW[h])}`);
    (p.evs ?? []).forEach((ev, j) => {
      const prevC = h === 0 ? '' : ` - C${j}_${h - 1}`;
      st.push(` ec${j}_${h}: C${j}_${h}${prevC}${term(-dt, `v${j}_${h}`)} = 0`);
      st.push(` em${j}_${h}: C${j}_${h} + z${j}_${h} >= ${f(ev.emin[h])}`);
      obj.push(term(M, `z${j}_${h}`));
      bd.push(` 0 <= v${j}_${h} <= ${f(ev.pmax[h])}`, ` 0 <= C${j}_${h} <= ${f(Math.max(ev.emax[h], 0))}`);
    });
    (p.hps ?? []).forEach((hp, j) => {
      const prevT = h === 0 ? '' : ` - T${j}_${h - 1}`;
      st.push(` ht${j}_${h}: T${j}_${h}${prevT}${term(-hp.cop[h] * dt, `q${j}_${h}`)}${term(-dt, `w${j}_${h}`)} = ${f((h === 0 ? hp.s0 : 0) - hp.heat[h] * dt)}`);
      obj.push(term(dt * M, `w${j}_${h}`));
      if (h === H - 1) obj.push(term(-hp.terminalEurPerKWhHeat, `T${j}_${h}`));
      bd.push(` 0 <= q${j}_${h} <= ${f(hp.pmax[h])}`, ` 0 <= T${j}_${h} <= ${f(hp.smax)}`);
    });
    // storage: e_h − e_{h−1} − η dt c + dt/η d = 0   (e_{−1} = e0 on the right-hand side)
    const prev = h === 0 ? '' : ` - e${h - 1}`;
    st.push(` s${h}: e${h}${prev}${term(-p.eta * dt, `c${h}`)}${term(dt / p.eta, `d${h}`)} = ${h === 0 ? f(p.e0) : '0'}`);
    st.push(` p${h}: i${h} - pk <= 0`);
    st.push(` l${h}: i${h} - s${h} <= ${f(p.importLimitKW)}`);
    const solar = Math.max(0, -p.pvKW[h]);
    const surplus = Math.max(0, -p.netKW[h]);
    bd.push(` 0 <= c${h} <= ${f(p.powerKW)}`, ` 0 <= d${h} <= ${f(p.powerKW)}`,
      ` ${f(p.eMin)} <= e${h} <= ${f(p.eMax)}`, ` 0 <= x${h} <= ${f(Math.min(p.exportLimitKW, surplus))}`,
      ` 0 <= u${h} <= ${f(solar)}`);
  }
  bd.push(` pk >= ${f(p.peakSoFarKW)}`);
  // HiGHS reads "Minimize obj: ..." with terms on one line
  return `Minimize\n obj:${obj.join('')}\nSubject To\n${st.join('\n')}\nBounds\n${bd.join('\n')}\nEnd\n`;
}

/** Minimal shape of a HiGHS solve result that we use. */
export interface HighsResult {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, { Primal: number }>;
}
export interface Solver { solve(lp: string, opts?: Record<string, unknown>): HighsResult }

export function solveLp(solver: Solver, p: LpInput): LpPlan {
  const r = solver.solve(buildLp(p), { presolve: 'off' });
  const H = p.netKW.length;
  const get = (k: string) => r.Columns[k]?.Primal ?? 0;
  const plan: LpPlan = {
    status: r.Status, objective: r.ObjectiveValue,
    charge: new Float64Array(H), discharge: new Float64Array(H), energy: new Float64Array(H), importKW: new Float64Array(H),
    peakKW: get('pk'),
    ev: (p.evs ?? []).map(() => new Float64Array(H)),
    hp: (p.hps ?? []).map(() => new Float64Array(H)),
    hpTank: (p.hps ?? []).map(() => new Float64Array(H)),
  };
  for (let h = 0; h < H; h++) {
    plan.charge[h] = get(`c${h}`); plan.discharge[h] = get(`d${h}`);
    plan.energy[h] = get(`e${h}`); plan.importKW[h] = get(`i${h}`);
    plan.ev.forEach((a, j) => (a[h] = get(`v${j}_${h}`)));
    plan.hp.forEach((a, j) => { a[h] = get(`q${j}_${h}`); plan.hpTank[j][h] = get(`T${j}_${h}`); });
  }
  return plan;
}
