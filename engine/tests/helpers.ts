import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteData } from '../src/core/types';
import type { TariffDE } from '../src/tariff/de';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../app/public/data');
const SERIES = ['price_da', 'load_factory', 'load_warehouse', 'load_cold_storage', 'pv_south30', 'pv_eastwest15',
  'heat_space_com', 'heat_water_com', 'cop_air_radiator', 'cop_air_floor', 'cop_air_water', 'temp_air'];

export function loadData(): SiteData {
  const series: Record<string, number[]> = {};
  const annualSums: Record<string, number> = {};
  let start = '', n = 0, stepMinutes = 15;
  for (const k of SERIES) {
    const d = JSON.parse(readFileSync(resolve(DIR, `${k}.json`), 'utf8'));
    series[k] = d.values;
    annualSums[k] = d.values.reduce((s: number, x: number) => s + x, 0) * (d.stepMinutes / 60);
    start = d.start; n = d.n; stepMinutes = d.stepMinutes;
  }
  const ev = JSON.parse(readFileSync(resolve(DIR, 'ev_fleet_sessions.json'), 'utf8'));
  return { start, n, stepMinutes, series, annualSums, sessions: { ev_fleet_sessions: { vehicles: ev.vehicles, sessions: ev.sessions } } };
}

export function loadTariff(): TariffDE {
  return JSON.parse(readFileSync(resolve(DIR, 'tariff_de_netzleipzig_2026.json'), 'utf8'));
}
