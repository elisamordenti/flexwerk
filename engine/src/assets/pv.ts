import type { AssetType } from '../core/types';
import { num, resolve, str } from '../core/params';

const DWD = 'DWD Climate Data Center, 10-min station 02932 Leipzig/Halle (CC BY 4.0), modelled with PVWatts-type model (data/solar_model.py)';

export const pvAsset: AssetType = {
  type: 'pv',
  label: 'Solar PV',
  role: 'source',
  ports: [{ id: 'ac', flow: 'power', direction: 'out' }],
  icon: 'solar',
  color: '#eda100',
  description: 'Rooftop solar driven by measured Leipzig irradiance. Can be curtailed if exports exceed the limit.',
  guide: 'ch2',
  available: true,
  params: [
    {
      key: 'profile', label: 'Orientation', unit: '', kind: 'select', default: 'pv_eastwest15',
      options: [
        { value: 'pv_south30', label: 'South, 30° tilt' },
        { value: 'pv_eastwest15', label: 'East-west flat roof, 15° tilt' },
      ],
      help: 'Which way the panels face. East-west roofs produce less per kWp but spread output over the day.',
      source: DWD, guide: 'ch2',
    },
    {
      key: 'kWp', label: 'Installed capacity', unit: 'kWp', kind: 'number', default: 300,
      min: 0, max: 10000, step: 10,
      help: 'Peak DC power of the panels under standard test conditions (1000 W/m², 25 °C).',
      source: 'example choice', guide: 'ch2',
    },
    {
      key: 'derate', label: 'Extra derating', unit: '×', kind: 'number', default: 1,
      min: 0.5, max: 1.1, step: 0.01,
      help: 'Multiplier on output. Our model reads 3–5 % above PVGIS on the same years; set 0.96 to align with PVGIS.',
      source: 'validation result, see SOURCES.md', guide: 'ch8',
    },
  ],
  create(inst, data) {
    const p = resolve(this.params, inst.params);
    const shape = data.series[str(p, 'profile')];
    if (!shape) throw new Error(`missing series ${str(p, 'profile')}`);
    const k = num(p, 'kWp') * num(p, 'derate');
    return {
      id: inst.id, type: 'pv', role: 'source', curtailable: true,
      fixedPower: (t) => -shape[t] * k,
      info: { kWp: num(p, 'kWp') },
    };
  },
};
