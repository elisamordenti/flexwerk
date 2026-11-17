import type { AssetType } from '../core/types';
import { num, resolve, str } from '../core/params';

const OPSD = 'Open Power System Data, household_data 2020-04-15 (CoSSMic, Konstanz), CC BY 4.0';

export const loadAsset: AssetType = {
  type: 'load',
  label: 'Building / process load',
  role: 'load',
  ports: [{ id: 'ac', flow: 'power', direction: 'in' }],
  icon: 'factory',
  color: '#52514e',
  description: 'A measured consumption profile (factory, warehouse, cold store), scaled to your annual consumption.',
  guide: 'ch4',
  available: true,
  params: [
    {
      key: 'profile', label: 'Load profile', unit: '', kind: 'select', default: 'load_factory',
      options: [
        { value: 'load_factory', label: 'Industrial building with machines (measured)' },
        { value: 'load_warehouse', label: 'Warehouse / logistics (measured)' },
        { value: 'load_cold_storage', label: 'Cold storage (modelled from sub-meters)' },
      ],
      help: 'The 15-minute shape of consumption over the year. Measured at real sites, then scaled.',
      source: OPSD, guide: 'ch4',
    },
    {
      key: 'annualMWh', label: 'Annual consumption', unit: 'MWh/yr', kind: 'number', default: 1500,
      min: 50, max: 20000, step: 50,
      help: 'Total electricity the site uses in a year. The measured shape is scaled so that it adds up to this number; the peak scales by the same factor.',
      source: 'example choice', guide: 'ch4',
    },
  ],
  create(inst, data) {
    const p = resolve(this.params, inst.params);
    const key = str(p, 'profile');
    const shape = data.series[key];
    if (!shape) throw new Error(`missing series ${key}`);
    const annualKWh = data.annualSums?.[key] ?? sumKWh(shape, data.stepMinutes);
    const scale = (num(p, 'annualMWh') * 1000) / annualKWh;
    return {
      id: inst.id, type: 'load', role: 'load',
      fixedPower: (t) => shape[t] * scale,
      info: { scale },
    };
  },
};

export function sumKWh(s: ArrayLike<number>, stepMinutes: number) {
  let e = 0;
  for (let i = 0; i < s.length; i++) e += s[i];
  return (e * stepMinutes) / 60;
}
