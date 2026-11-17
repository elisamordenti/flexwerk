import type { Solver } from './lp';

/** Load HiGHS (MIT) compiled to WebAssembly. In the browser pass `locateFile` so it can find highs.wasm. */
export async function loadSolver(opts?: { locateFile?: (file: string) => string }): Promise<Solver> {
  const mod = (await import('highs')).default as unknown as (o?: object) => Promise<Solver>;
  return mod(opts);
}
