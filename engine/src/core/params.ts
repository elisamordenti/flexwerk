import type { ParamDecl, ParamValues } from './types';

/** Default values for a parameter list. */
export function defaults(decls: ParamDecl[]): ParamValues {
  const out: ParamValues = {};
  for (const d of decls) out[d.key] = d.default;
  return out;
}

/** Merge user values over defaults, clamp numbers to declared ranges. */
export function resolve(decls: ParamDecl[], values: ParamValues = {}): ParamValues {
  const out = defaults(decls);
  for (const d of decls) {
    const v = values[d.key];
    if (v === undefined) continue;
    if (d.kind === 'number') {
      let x = Number(v);
      if (!Number.isFinite(x)) continue;
      if (d.min !== undefined) x = Math.max(d.min, x);
      if (d.max !== undefined) x = Math.min(d.max, x);
      out[d.key] = x;
    } else {
      out[d.key] = v;
    }
  }
  return out;
}

export const num = (p: ParamValues, k: string) => Number(p[k]);
export const str = (p: ParamValues, k: string) => String(p[k]);
export const bool = (p: ParamValues, k: string) => Boolean(p[k]);
