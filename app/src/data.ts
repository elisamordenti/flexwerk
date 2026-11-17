import type { SiteData, TariffDE } from '@cibl/engine';

export const SERIES = ['price_da', 'load_factory', 'load_warehouse', 'load_cold_storage', 'pv_south30', 'pv_eastwest15',
  'heat_space_com', 'heat_water_com', 'cop_air_radiator', 'cop_air_floor', 'cop_air_water', 'temp_air'] as const;

export interface SeriesMeta { [k: string]: unknown }

export interface AppData {
  site: SiteData;
  tariff: TariffDE & Record<string, unknown>;
  battery: Record<string, unknown>;
  validation: { summary: Record<string, number>; results: Record<string, Record<string, unknown>[]> };
  meta: Record<string, SeriesMeta>;
  /** pre-computed full-year table (engine/scripts/yeartable.ts); null if not built yet */
  yearTable: YearTable | null;
}

export interface YearRow {
  costEur: number; savingEur: number; dischargeMWh?: number; wearEur?: number; savingAfterWearEur?: number; peakKW: number; peakChargeEur: number; energyEur: number; exportEur: number;
  efc: number; regime: string; fullLoadHours: number; limitBreaches: number; balanceOk: boolean; seconds?: number;
}
export interface YearTable { period: string; sites: Record<string, Record<string, YearRow | Record<string, unknown>>> }

const url = (f: string) => `${import.meta.env.BASE_URL}data/${f}.json`;
const get = async (f: string) => {
  const r = await fetch(url(f));
  if (!r.ok) throw new Error(`could not load ${f}: ${r.status}`);
  return r.json();
};

export async function loadAppData(): Promise<AppData> {
  const docs = await Promise.all(SERIES.map(get));
  const series: Record<string, Float64Array> = {};
  const annualSums: Record<string, number> = {};
  const meta: Record<string, SeriesMeta> = {};
  docs.forEach((d, i) => {
    const k = SERIES[i];
    series[k] = Float64Array.from(d.values as number[]);
    annualSums[k] = (series[k].reduce((s, x) => s + x, 0) * d.stepMinutes) / 60;
    meta[k] = { ...d.meta, unit: d.unit };
  });
  const [tariff, battery, validation, yearTable, ev] = await Promise.all([
    get('tariff_de_netzleipzig_2026'), get('battery_defaults'), get('validation'), get('results_year').catch(() => null), get('ev_fleet_sessions'),
  ]);
  meta.ev_fleet_sessions = { ...ev.meta, unit: 'sessions' };
  return {
    site: { start: docs[0].start, stepMinutes: docs[0].stepMinutes, n: docs[0].n, series, annualSums,
      sessions: { ev_fleet_sessions: { vehicles: ev.vehicles, sessions: ev.sessions } } },
    tariff, battery, validation, meta, yearTable,
  };
}
