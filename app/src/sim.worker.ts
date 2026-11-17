/// <reference lib="webworker" />
/**
 * Runs every simulation off the main thread so the page never freezes.
 * The MPC solves one small linear program per hour of simulated time (HiGHS in WebAssembly).
 *
 *   main -> worker   { kind: 'init', site, tariff }      once, the open data
 *   main -> worker   { kind: 'run', id, spec, startStep, steps, compare }
 *   worker -> main   { kind: 'progress', id, share } | { kind: 'done', id, ... } | { kind: 'error', id, message }
 */
import { simulate, loadSolver, controllerType, type SimResult, type SiteData, type SiteSpec, type Solver, type TariffDE } from '@cibl/engine';
import wasmUrl from 'highs/runtime?url';

export interface RunJob { kind: 'run'; id: number; spec: SiteSpec; startStep: number; steps: number; compare: boolean }
export type WorkerIn = { kind: 'init'; site: SiteData; tariff: TariffDE } | RunJob;
export type WorkerOut =
  | { kind: 'progress'; id: number; share: number; label: string }
  | { kind: 'done'; id: number; run: SimResult; base: SimResult; compare: { perfect: SimResult; realistic: SimResult } | null; ms: number }
  | { kind: 'error'; id: number; message: string };

let data: SiteData | null = null;
let tariff: TariffDE | null = null;
let solver: Promise<Solver> | null = null;
const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.kind === 'init') { data = m.site; tariff = m.tariff; return; }
  const { id, spec, startStep, steps } = m;
  try {
    if (!data || !tariff) throw new Error('data not loaded');
    const t0 = performance.now();
    const ctl = controllerType(spec.controller.type);
    let s: Solver | undefined;
    if (ctl.needsSolver) {
      solver ??= loadSolver({ locateFile: () => wasmUrl });
      s = await solver;
    }
    const base = simulate(spec, data, tariff, { startStep, steps, baseline: true });
    const modes = m.compare ? (['perfect', 'realistic'] as const) : ([spec.forecast ?? 'perfect'] as const);
    const out: Partial<Record<'perfect' | 'realistic', SimResult>> = {};
    modes.forEach((f, i) => {
      out[f] = simulate(spec, data!, tariff!, {
        startStep, steps, solver: s, forecast: f,
        onProgress: (sh) => post({ kind: 'progress', id, share: (i + sh) / modes.length, label: modes.length > 1 ? `${f} forecasts` : '' }),
      });
    });
    const shown = out[spec.forecast ?? 'perfect']!;
    post({ kind: 'done', id, run: shown, base, compare: m.compare ? { perfect: out.perfect!, realistic: out.realistic! } : null, ms: performance.now() - t0 });
  } catch (err) {
    post({ kind: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
