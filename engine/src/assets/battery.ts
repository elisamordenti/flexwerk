import type { AssetType } from '../core/types';
import { num, resolve } from '../core/params';

const DS = 'FoxESS T-MAX TM215kWh-100kW-2hF datasheet V1.6 (215 kWh / 100 kW per cabinet, RTE >89 %, DoD 0–100 %)';

/**
 * Energy-reservoir battery model.
 *   eta_c = eta_d = sqrt(RTE)
 *   charging    p > 0 : E += p * eta_c * dt
 *   discharging p < 0 : E += p / eta_d * dt     (more energy leaves the cells than reaches the bus)
 * Power limits: |p| <= P_rated; energy limits: E_min <= E <= E_max with E = soc * capacity.
 */
export const batteryAsset: AssetType = {
  type: 'battery',
  label: 'Battery storage',
  role: 'storage',
  ports: [{ id: 'ac', flow: 'power', direction: 'both' }],
  icon: 'battery',
  color: '#1baf7a',
  description: 'A lithium-iron-phosphate (LFP) battery behind the meter. It charges and discharges on the controller’s request.',
  guide: 'ch3',
  available: true,
  params: [
    { key: 'energyKWh', label: 'Usable capacity', unit: 'kWh', kind: 'number', default: 430, min: 10, max: 20000, step: 5,
      help: 'Energy the battery can store between its lower and upper limit. Default = 2 cabinets of 215 kWh.', source: DS, guide: 'ch3' },
    { key: 'powerKW', label: 'Power rating', unit: 'kW', kind: 'number', default: 200, min: 5, max: 10000, step: 5,
      help: 'Maximum charge or discharge power at the grid connection. Default = 2 cabinets of 100 kW.', source: DS, guide: 'ch3' },
    { key: 'rte', label: 'Round-trip efficiency', unit: '%', kind: 'number', default: 89, min: 70, max: 99, step: 0.5,
      help: 'Share of the energy put in that comes back out. 89 % means 11 kWh of every 100 kWh is lost as heat.', source: DS, guide: 'ch3' },
    { key: 'socMin', label: 'Lowest state of charge', unit: '%', kind: 'number', default: 0, min: 0, max: 50, step: 1,
      help: 'The battery is never discharged below this level.', source: DS + ' (DoD 0–100 %)', guide: 'ch3' },
    { key: 'socMax', label: 'Highest state of charge', unit: '%', kind: 'number', default: 100, min: 50, max: 100, step: 1,
      help: 'The battery is never charged above this level.', source: DS + ' (DoD 0–100 %)', guide: 'ch3' },
    { key: 'soc0', label: 'Starting state of charge', unit: '%', kind: 'number', default: 50, min: 0, max: 100, step: 1,
      help: 'State of charge at the first time step.', source: 'example choice', guide: 'ch3' },
    { key: 'capexEurPerKWh', label: 'Investment cost', unit: '€/kWh', kind: 'number', default: 625, min: 100, max: 2000, step: 5,
      help: 'Installed cost per kWh of usable capacity, excl. VAT. 625 = midpoint of the 450–800 €/kWh range for C&I storage.',
      source: 'Kost et al., Fraunhofer ISE LCOE study 2024, p. 20 (midpoint is our choice)', guide: 'ch3' },
  ],
  create(inst) {
    const p = resolve(this.params, inst.params);
    const cap = num(p, 'energyKWh');
    const pr = num(p, 'powerKW');
    const eta = Math.sqrt(num(p, 'rte') / 100);
    const eMin = (num(p, 'socMin') / 100) * cap;
    const eMax = (num(p, 'socMax') / 100) * cap;
    let e = Math.min(eMax, Math.max(eMin, (num(p, 'soc0') / 100) * cap));
    return {
      id: inst.id, type: 'battery', role: 'storage',
      info: { capacityKWh: cap, powerKW: pr, eta, eMin, eMax },
      bounds(dtH) {
        const chargeMax = Math.min(pr, Math.max(0, (eMax - e) / (eta * dtH)));
        const dischargeMax = Math.min(pr, Math.max(0, ((e - eMin) * eta) / dtH));
        return { min: -dischargeMax, max: chargeMax };
      },
      apply(pw, dtH) {
        const b = this.bounds!(dtH);
        const x = Math.min(b.max, Math.max(b.min, pw));
        e += x >= 0 ? x * eta * dtH : (x / eta) * dtH;
        // guard against floating-point drift past the limits
        e = Math.min(eMax, Math.max(eMin, e));
        return x;
      },
      state: () => ({ soc: e / cap, energyKWh: e }),
    };
  },
};
