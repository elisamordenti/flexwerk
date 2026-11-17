import type { SiteSpec } from '../sim/engine';

/**
 * Example sites. Sizes are EXAMPLE CHOICES (see DECISIONS.md D-013); batteries are whole multiples
 * of the cited 215 kWh / 100 kW cabinet. Connection limits are example choices sized above the site peak.
 */
/** defaultPeriod: the week (Mon-Sun) containing the site's annual baseline peak, days counted from 1 Oct 2025. */
export const EXAMPLES: (SiteSpec & { id: string; defaultPeriod: { startDay: number; days: number } })[] = [
  {
    id: 'depot',
    defaultPeriod: { startDay: 110, days: 7 }, // baseline peak 22 Jan 2026 (cold week: heat pump + vans)
    name: 'Logistics depot with van fleet',
    description: 'Warehouse depot, 0.6 GWh/yr, 400 kWp roof PV, 40 electric vans (measured sessions), heat pump with buffer tank, 2 battery cabinets.',
    assets: [
      { id: 'grid', type: 'grid', name: 'Grid connection', params: { level: 'MS', importLimitKW: 500, exportLimitKW: 350, fuseKW: 600, manufacturing: false } },
      { id: 'load1', type: 'load', name: 'Warehouse', params: { profile: 'load_warehouse', annualMWh: 600 } },
      { id: 'pv1', type: 'pv', name: 'Roof PV', params: { profile: 'pv_south30', kWp: 400 } },
      { id: 'bat1', type: 'battery', name: 'Battery', params: { energyKWh: 430, powerKW: 200 } },
      { id: 'ev1', type: 'ev', name: 'Van fleet', params: { vehicles: 40, chargerKW: 7.4, strategy: 'asap' } },
      { id: 'hp1', type: 'heatpump', name: 'Heat pump', params: { annualHeatMWh: 300, annualWaterMWh: 20, powerKW: 110, tankKWh: 200, strategy: 'onDemand' } },
    ],
    controller: { type: 'peakShave', params: { thresholdKW: 250 } },
  },
  {
    id: 'factory',
    defaultPeriod: { startDay: 61, days: 7 }, // peak 2 Dec 2025 15:15
    name: 'Small factory with solar',
    description: 'Measured industrial building (machines, cooling, offices), 1.5 GWh/yr, east-west roof PV, 2 battery cabinets.',
    assets: [
      { id: 'grid', type: 'grid', name: 'Grid connection', params: { level: 'MS', importLimitKW: 600, exportLimitKW: 300, fuseKW: 700, manufacturing: true } },
      { id: 'load1', type: 'load', name: 'Factory', params: { profile: 'load_factory', annualMWh: 1500 } },
      { id: 'pv1', type: 'pv', name: 'Roof PV', params: { profile: 'pv_eastwest15', kWp: 300 } },
      { id: 'bat1', type: 'battery', name: 'Battery', params: { energyKWh: 430, powerKW: 200 } },
    ],
    controller: { type: 'peakShave', params: { thresholdKW: 330 } },
  },
  {
    id: 'warehouse',
    defaultPeriod: { startDay: 264, days: 7 }, // peak 25 Jun 2026 19:45
    name: 'Logistics warehouse',
    description: 'Measured warehouse, 0.8 GWh/yr, large south roof PV, 2 battery cabinets.',
    assets: [
      { id: 'grid', type: 'grid', name: 'Grid connection', params: { level: 'MS', importLimitKW: 400, exportLimitKW: 350, fuseKW: 500, manufacturing: false } },
      { id: 'load1', type: 'load', name: 'Warehouse', params: { profile: 'load_warehouse', annualMWh: 800 } },
      { id: 'pv1', type: 'pv', name: 'Roof PV', params: { profile: 'pv_south30', kWp: 500 } },
      { id: 'bat1', type: 'battery', name: 'Battery', params: { energyKWh: 430, powerKW: 200 } },
    ],
    controller: { type: 'peakShave', params: { thresholdKW: 230 } },
  },
  {
    id: 'cold',
    defaultPeriod: { startDay: 264, days: 7 }, // peak 26 Jun 2026 19:45
    name: 'Cold storage',
    description: 'Refrigeration-dominated load (modelled from sub-meters), 1.2 GWh/yr, south roof PV, 3 battery cabinets.',
    assets: [
      { id: 'grid', type: 'grid', name: 'Grid connection', params: { level: 'MS', importLimitKW: 500, exportLimitKW: 200, fuseKW: 600, manufacturing: false } },
      { id: 'load1', type: 'load', name: 'Cold store', params: { profile: 'load_cold_storage', annualMWh: 1200 } },
      { id: 'pv1', type: 'pv', name: 'Roof PV', params: { profile: 'pv_south30', kWp: 250 } },
      { id: 'bat1', type: 'battery', name: 'Battery', params: { energyKWh: 645, powerKW: 300 } },
    ],
    controller: { type: 'peakShave', params: { thresholdKW: 300 } },
  },
];
