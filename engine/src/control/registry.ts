import type { ControllerType } from './types';
import { idleController, peakShaveController } from './rules';
import { priceRulesController } from './priceRules';
import { mpcController } from './mpc';

export const CONTROLLERS: ControllerType[] = [idleController, peakShaveController, priceRulesController, mpcController];

export function controllerType(type: string): ControllerType {
  const c = CONTROLLERS.find((x) => x.type === type);
  if (!c || !c.available || !c.create) throw new Error(`controller ${type} not available`);
  return c;
}
