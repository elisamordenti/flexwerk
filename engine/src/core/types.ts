/**
 * Core types of the engine.
 *
 * SIGN CONVENTION (whole engine): one site = one bus behind one grid meter.
 *   power > 0  : the asset DRAWS from the bus   (load, battery charging)
 *   power < 0  : the asset SUPPLIES the bus     (PV, battery discharging)
 *   grid import = sum of all asset powers  (> 0 import, < 0 export)
 */

/** Kinds of flow an asset port can carry. Only 'power' is simulated in v1; heat/work are reserved for later packs. */
export type FlowType = 'power' | 'heat' | 'work';

/** How an asset behaves on the bus. */
export type Role = 'load' | 'source' | 'storage' | 'flexible' | 'grid';

export interface Port {
  id: string;
  flow: FlowType;
  direction: 'in' | 'out' | 'both';
}

/** One parameter, declared once: the UI form, tooltips and docs are generated from this. */
export interface ParamDecl {
  key: string;
  label: string;
  unit: string;
  kind: 'number' | 'select' | 'boolean';
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** Plain-language meaning, shown in the "?" tooltip. */
  help: string;
  /** Citation, or the literal text "example choice". */
  source: string;
  /** Guide page anchor, e.g. "ch3". */
  guide?: string;
}

export type ParamValue = number | string | boolean;
export type ParamValues = Record<string, ParamValue>;

/** An asset placed on a site by the user. */
export interface AssetInstance {
  id: string;
  type: string;
  name: string;
  params: ParamValues;
}

/** Time series available to assets and controllers, all on one axis. */
export interface SiteData {
  /** ISO UTC timestamp of step 0 */
  start: string;
  stepMinutes: number;
  n: number;
  series: Record<string, ArrayLike<number>>;
  /** Annual sums of each series over the full data year, used to scale profiles. */
  annualSums?: Record<string, number>;
  /** Event data (e.g. EV sessions: [vehicle, arrivalStep, departureStep, kWh]) on the same axis. */
  sessions?: Record<string, { vehicles: number; sessions: number[][] }>;
}

/** What a flexible asset tells the MPC about the hours ahead (index 0 = now). */
export type FlexPlan =
  /** EV fleet as one envelope: cumulative energy from now that must / can be delivered by the end of each step */
  | { kind: 'ev'; pmax: Float64Array; emin: Float64Array; emax: Float64Array }
  /** heat pump: heat demand (kW heat), COP, tank now and its size (kWh heat) */
  | { kind: 'heatpump'; pmax: Float64Array; heat: Float64Array; cop: Float64Array; s0: number; smax: number };

/**
 * A load whose timing can move (EV charging, heat pump with a tank). Calls happen in step order.
 * min = what must run now (a van leaving, a cold building), max = the most it can take now.
 */
export interface FlexModel {
  kind: 'ev' | 'heatpump';
  bounds(t: number, dtH: number): { min: number; max: number };
  /** what it does with no control at all (the baseline) */
  uncontrolled(t: number, dtH: number): number;
  /** what its own simple rule asks for (used when the site controller does not decide it) */
  ownChoice(t: number, dtH: number): number;
  /** apply a power (clipped to the bounds), return what was applied */
  apply(t: number, p: number, dtH: number): number;
  state(): Record<string, number>;
  plan(t: number, H: number, mode: 'perfect' | 'realistic', dtH: number): FlexPlan;
}

/** Runtime model of one asset during a simulation. */
export interface AssetModel {
  id: string;
  type: string;
  role: Role;
  /** Uncontrollable power at step t (kW, sign convention above). */
  fixedPower?(t: number): number;
  /** Controllable assets: feasible power range for the next step, given current state. */
  bounds?(dtH: number): { min: number; max: number };
  /** Controllable assets: apply an accepted power for one step, return the power actually applied. */
  apply?(p: number, dtH: number): number;
  /** Snapshot of internal state for results/UI (e.g. soc). */
  state?(): Record<string, number>;
  /** May the safety layer reduce this asset's output (PV curtailment)? */
  curtailable?: boolean;
  /** Static facts the controller / KPIs may need (e.g. battery capacity). */
  info?: Record<string, number>;
  /** Flexible loads (EV fleet, heat pump). */
  flex?: FlexModel;
}

/** A plug-in asset type. Adding a new type = adding one object of this shape to the registry. */
export interface AssetType {
  type: string;
  label: string;
  role: Role;
  ports: Port[];
  params: ParamDecl[];
  /** Key of the icon/illustration the app draws. */
  icon: string;
  /** Colour used for this asset's flows. */
  color: string;
  /** One-sentence description for the palette. */
  description: string;
  /** Guide page anchor. */
  guide: string;
  /** Maximum instances per site (grid connection: 1). */
  maxCount?: number;
  /** false = shown in the catalogue as "coming soon" */
  available: boolean;
  create?(inst: AssetInstance, data: SiteData): AssetModel;
}
