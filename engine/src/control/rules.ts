import { num, resolve } from '../core/params';
import type { ControllerType } from './types';

/** Baseline: the battery never moves. Every run is compared against the same site with this controller. */
export const idleController: ControllerType = {
  type: 'idle',
  label: 'Idle (baseline)',
  description: 'The battery does nothing. Used as the reference every result is compared with.',
  params: [],
  guide: 'ch14',
  available: true,
  create: () => ({ name: 'idle', decide: (o) => Object.fromEntries(o.batteries.map((b) => [b.id, 0])) }),
};

/**
 * Static peak shaving at a fixed threshold.
 *   net load above threshold  -> discharge the difference
 *   net load below threshold  -> recharge with the headroom, but never above the highest import seen so far
 *                                in the period (so recharging cannot create a new peak), nor above the threshold
 * With several batteries, the request is split in proportion to power rating.
 */
export const peakShaveController: ControllerType = {
  type: 'peakShave',
  label: 'Static peak shaving',
  description: 'Discharge whenever site import would exceed a fixed threshold; recharge below it.',
  guide: 'ch14',
  available: true,
  params: [
    { key: 'thresholdKW', label: 'Peak threshold', unit: 'kW', kind: 'number', default: 350, min: 0, max: 50000, step: 5,
      help: 'Import level the controller tries to stay under. Too low and the battery runs empty; too high and it saves little.',
      source: 'example choice', guide: 'ch14' },
    { key: 'rechargeShare', label: 'Recharge power share', unit: '%', kind: 'number', default: 100, min: 0, max: 100, step: 5,
      help: 'Share of the battery power rating used when recharging. Recharging never pushes import above the threshold or above the highest import seen so far.', source: 'example choice', guide: 'ch14' },
  ],
  create(params) {
    const p = resolve(this.params, params);
    const th = num(p, 'thresholdKW');
    const share = num(p, 'rechargeShare') / 100;
    return {
      name: 'peakShave',
      decide(o) {
        const totalP = o.batteries.reduce((s, b) => s + b.powerKW, 0) || 1;
        const cap = Math.min(th, Math.max(o.peakSoFarKW, o.netFixedKW));
        const want = o.netFixedKW > th ? -(o.netFixedKW - th) : Math.max(0, Math.min(cap - o.netFixedKW, totalP * share));
        return Object.fromEntries(o.batteries.map((b) => [b.id, (want * b.powerKW) / totalP]));
      },
    };
  },
};
