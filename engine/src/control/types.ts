import type { FlexPlan, ParamDecl, ParamValues, SiteData } from '../core/types';
import type { ForecastWindow } from '../forecast/forecast';
import type { TariffSignal } from '../tariff/de';
import type { Solver } from './lp';

/** What a controller sees at one step. It never sees the future except through `forecast`. */
export interface Observation {
  t: number;
  dtH: number;
  /** Net power of everything except batteries now (kW, + = site draws): loads, solar, and flexible loads
   *  at what their own rule asks. Known at decision time (simplification, see LIMITS L-010). */
  netFixedKW: number;
  /** Loads + solar only (no flexible loads), kW. */
  loadPvKW: number;
  /** Flexible loads (EV fleet, heat pump): what they must take now (min), can take (max), and their own rule's choice. */
  flex: { id: string; kind: 'ev' | 'heatpump'; min: number; max: number; rule: number; plan(H: number): FlexPlan }[];
  /** Day-ahead price now (EUR/MWh). Always public: it was set the day before. */
  priceEurMWh: number;
  /** Highest grid import so far in the simulated period (kW). */
  peakSoFarKW: number;
  batteries: {
    id: string; soc: number; energyKWh: number; capacityKWh: number; powerKW: number;
    /** feasible power this step (kW): min ≤ 0 (discharge), max ≥ 0 (charge) */
    min: number; max: number;
    eMin: number; eMax: number; eta: number;
  }[];
  importLimitKW: number;
  exportLimitKW: number;
  /** The next H quarter-hours as the chosen forecast mode sees them (index 0 = now). */
  forecast(H: number): ForecastWindow;
  data: SiteData;
}

/** A plan the controller made, kept so the app can draw "what it intended" next to "what happened". */
export interface PlanSnapshot {
  atStep: number;
  /** planned state of charge (0–1) at the end of each quarter-hour ahead */
  soc: Float32Array;
  /** the net load it expected for each quarter-hour ahead (kW) */
  netForecastKW: Float32Array;
}

/** "A controller can only ask": it returns desired powers per asset id (batteries, and flexible loads if it
 *  plans them); the engine clips and enforces limits. Flexible loads it leaves out follow their own rule. */
export interface Controller {
  name: string;
  decide(obs: Observation): Record<string, number>;
  /** set by planners after each new plan */
  lastPlan?: PlanSnapshot;
}

/** Facts and tools handed to a controller when a run starts. */
export interface ControllerContext {
  signal: TariffSignal;
  solver?: Solver;
}

export interface ControllerType {
  type: string;
  label: string;
  description: string;
  params: ParamDecl[];
  guide: string;
  available: boolean;
  /** does it look ahead? (if not, perfect and realistic forecasts give the same result) */
  usesForecast?: boolean;
  needsSolver?: boolean;
  create?(params: ParamValues, ctx?: ControllerContext): Controller;
}
