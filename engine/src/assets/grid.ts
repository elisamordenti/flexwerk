import type { AssetType } from '../core/types';

const NL = 'Netz Leipzig, Preisblatt Netznutzungsentgelte Strom 2026 (final)';

/**
 * The grid connection: exactly one per site. It is not stepped like other assets;
 * the engine computes its power as the balance of the bus and the safety layer enforces its limits.
 */
export const gridAsset: AssetType = {
  type: 'grid',
  label: 'Grid connection',
  role: 'grid',
  ports: [{ id: 'ac', flow: 'power', direction: 'both' }],
  icon: 'pylon',
  color: '#2a78d6',
  description: 'The one meter between the site and the public grid. Holds the connection limits and the tariff.',
  guide: 'ch1',
  maxCount: 1,
  available: true,
  params: [
    { key: 'level', label: 'Voltage level', unit: '', kind: 'select', default: 'MS',
      options: [
        { value: 'NS', label: 'Low voltage (NS)' },
        { value: 'MS/NS', label: 'MV/LV transformer (MS/NS)' },
        { value: 'MS', label: 'Medium voltage (MS)' },
        { value: 'HS/MS', label: 'HV/MV transformer (HS/MS)' },
      ],
      help: 'Where the site connects to the grid. Each level has its own grid-fee prices.', source: NL, guide: 'ch6' },
    { key: 'importLimitKW', label: 'Import limit', unit: 'kW', kind: 'number', default: 600, min: 10, max: 50000, step: 10,
      help: 'Maximum power the site may draw (contracted connection capacity).', source: 'example choice', guide: 'ch1' },
    { key: 'exportLimitKW', label: 'Export limit', unit: 'kW', kind: 'number', default: 300, min: 0, max: 50000, step: 10,
      help: 'Maximum power the site may feed into the grid. PV is curtailed above it.', source: 'example choice', guide: 'ch1' },
    { key: 'fuseKW', label: 'Connection rating', unit: 'kW', kind: 'number', default: 700, min: 10, max: 50000, step: 10,
      help: 'Physical rating of the connection (transformer / main fuse), in either direction.', source: 'example choice', guide: 'ch1' },
    { key: 'manufacturing', label: 'Manufacturing company', unit: '', kind: 'boolean', default: true,
      help: 'Manufacturers can claim the reduced electricity tax (0.05 instead of 2.05 ct/kWh) and a lower grid-use levy above 1 GWh.',
      source: '§ 9b StromStG; Aufschlag für besondere Netznutzung 2026 (group C’)', guide: 'ch6' },
    { key: 'supplierMarginCt', label: 'Supplier margin', unit: 'ct/kWh', kind: 'number', default: 1.0, min: 0, max: 10, step: 0.1,
      help: 'What the electricity supplier adds on top of the spot price.', source: 'example choice', guide: 'ch6' },
  ],
};
