import type { AssetType } from '../core/types';
import { batteryAsset } from './battery';
import { gridAsset } from './grid';
import { loadAsset } from './load';
import { pvAsset } from './pv';
import { evAsset } from './ev';
import { heatPumpAsset } from './heatpump';

/** Catalogue entries planned but not yet modelled: listed so the plug-in slots are visible. */
const comingSoon = (type: string, label: string, icon: string, role: AssetType['role'], description: string, guide: string): AssetType => ({
  type, label, icon, role, description, guide, color: '#898781', available: false, params: [],
  ports: [{ id: 'ac', flow: 'power', direction: 'in' }],
});

/** The asset catalogue. Adding a type = adding one entry here. */
export const REGISTRY: AssetType[] = [
  loadAsset,
  pvAsset,
  batteryAsset,
  gridAsset,
  evAsset,
  heatPumpAsset,
  comingSoon('chp', 'CHP / backup generator', 'chp', 'source', 'On-site generator. Added only if a sourced model is available.', 'ch5'),
];

export function assetType(type: string): AssetType {
  const t = REGISTRY.find((a) => a.type === type);
  if (!t) throw new Error(`unknown asset type ${type}`);
  return t;
}
