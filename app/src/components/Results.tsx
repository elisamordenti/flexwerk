import { useMemo } from 'react';
import { assetType, checks, CONTROLLERS, kpis, type SimResult } from '@cibl/engine';
import { Help } from './Help';
import { LineChart, type Line } from './Charts';
import type { YearRow, YearTable } from '../data';

const fmt = (v: number, unit: string) => {
  if (unit === '€') return `${v < 0 ? '−' : ''}€${Math.abs(v).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
  if (unit === 'cycles') return v.toFixed(1);
  return `${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })} ${unit}`;
};
const eur = (v: number) => fmt(v, '€');

const COLORS: Record<string, string> = { load: '#52514e', pv: '#eda100', battery: '#1baf7a' };

interface Props {
  run: SimResult; base: SimResult;
  compare: { perfect: SimResult; realistic: SimResult } | null;
  controllerType: string; exampleId: string; yearTable: YearTable | null;
  k: number; onSeek: (k: number) => void; timeLabel: (k: number) => string; onGuide: (g: string) => void;
}

/** The plan in force at step k, spread onto the run's time axis (NaN outside its horizon). */
function planLines(run: SimResult, k: number) {
  const P = run.plans;
  if (!P) return null;
  let lo = 0, hi = P.atSteps.length - 1, i = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (P.atSteps[m] <= k) { i = m; lo = m + 1; } else hi = m - 1; }
  if (i < 0) return null;
  const at = P.atSteps[i], soc = new Float64Array(run.steps).fill(NaN), net = new Float64Array(run.steps).fill(NaN);
  for (let h = 0; h < P.horizon && at + h < run.steps; h++) {
    soc[at + h] = P.soc[i * P.horizon + h] * 100;
    net[at + h] = P.netForecastKW[i * P.horizon + h];
  }
  return { at, soc, net };
}

export function Results({ run, base, compare, controllerType, exampleId, yearTable, k, onSeek, timeLabel, onGuide }: Props) {
  const ks = kpis(run, base);
  const cs = checks(run);
  const ctl = CONTROLLERS.find((c) => c.type === controllerType);
  // re-derive plan lines only when the playhead enters a new plan (every hour of simulated time)
  let planIdx = -1;
  if (run.plans) for (let lo = 0, hi = run.plans.atSteps.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (run.plans.atSteps[m] <= k) { planIdx = m; lo = m + 1; } else hi = m - 1; }
  const plan = useMemo(() => planLines(run, k), [run, planIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  const powerLines: Line[] = [
    { label: 'Grid', color: '#2a78d6', values: run.gridKW },
    { label: 'Grid (baseline)', color: '#2a78d6', values: base.gridKW, dashed: true },
    ...run.assets.map((a) => ({ label: a.name, color: COLORS[a.type] ?? assetType(a.type).color, values: a.power })),
    ...(plan ? [{ label: 'Load − solar, as forecast', color: '#898781', values: plan.net, dashed: true }] : []),
  ];
  const socIds = Object.keys(run.soc);
  const socLines: Line[] = [
    ...socIds.map((id, i) => ({ label: run.assets.find((a) => a.id === id)?.name ?? id, color: i ? '#199e70' : '#1baf7a', values: Array.from(run.soc[id], (x) => x * 100) })),
    ...(plan ? [{ label: 'Planned', color: '#0d7a54', values: plan.soc, dashed: true }] : []),
  ];

  return (
    <section className="bottom" data-tour="results">
      <div className="res-head">
        <span className="chip">Showing: {run.forecast} forecasts</span>
        <span className="small muted">vs baseline = same site and period with the battery idle</span>
      </div>
      {compare ? <CompareCard compare={compare} base={base} looksAhead={!!ctl?.usesForecast} onGuide={onGuide} /> : null}
      <div className="kpis">
        {ks.map((x) => {
          const better = x.lowerIsBetter ? x.delta < -1e-6 : x.delta > 1e-6;
          const worse = x.lowerIsBetter ? x.delta > 1e-6 : x.delta < -1e-6;
          return (
            <div className="kpi" key={x.key}>
              <div className="k">{x.label} <Help text={x.help} unit={x.unit} guide="ch18" onGuide={onGuide} /></div>
              <div className="v num">{fmt(x.value, x.unit)}</div>
              <div className={`d num ${better ? 'good' : worse ? 'bad' : ''}`}>
                {x.delta === 0 ? 'same as baseline' : `${x.delta > 0 ? '+' : '−'}${fmt(Math.abs(x.delta), x.unit).replace('−', '')} vs baseline`}
              </div>
            </div>
          );
        })}
      </div>
      <div className="checks">
        {cs.map((c) => <span key={c.key} className={`check ${c.pass ? 'pass' : 'fail'}`} title={c.detail}>{c.label}</span>)}
        <span className="check" title="Annual full-load hours decide which grid-fee price pair applies">
          Grid-fee regime: {run.bill.regime === 'atOrAbove2500h' ? '≥ 2,500 h' : '< 2,500 h'} ({run.bill.fullLoadHours.toFixed(0)} h)
        </span>
      </div>
      {plan ? (
        <p className="small muted" style={{ margin: '0 0 6px' }}>
          Dashed grey and dark-green lines: the plan the MPC made at {timeLabel(plan.at)} for the next {(run.plans!.horizon / 4).toFixed(0)} h. Where they part from the solid lines, the forecast or the plan was wrong.
        </p>
      ) : null}
      <div className="charts">
        <LineChart title="Power by asset" unit="kW, + = draws from site" lines={powerLines} k={k} onSeek={onSeek} timeLabel={timeLabel} height={170} zeroLine />
        {socIds.length ? <LineChart title="Battery state of charge" unit="%" k={k} onSeek={onSeek} timeLabel={timeLabel} height={100} lines={socLines} /> : null}
        {Object.entries(run.flexState ?? {}).filter(([, f]) => f.kind === 'ev').map(([id, f]) => (
          <LineChart key={id} title={`${run.assets.find((a) => a.id === id)?.name ?? 'Vans'}: energy still to charge`} unit="kWh" k={k} onSeek={onSeek} timeLabel={timeLabel} height={90}
            lines={[{ label: 'Still needed', color: '#2a9d8f', values: f.level }, { label: 'Baseline', color: '#2a9d8f', values: base.flexState?.[id]?.level ?? f.level, dashed: true }]} />
        ))}
        {Object.entries(run.flexState ?? {}).filter(([, f]) => f.kind === 'heatpump').map(([id, f]) => (
          <LineChart key={id} title={`${run.assets.find((a) => a.id === id)?.name ?? 'Heat pump'}: hot-water tank`} unit="% full" k={k} onSeek={onSeek} timeLabel={timeLabel} height={90}
            lines={[{ label: 'Tank', color: '#d9466b', values: Array.from(f.level, (x) => x * 100) }]} />
        ))}
        <LineChart title="Day-ahead price" unit="€/MWh" lines={[{ label: 'Price', color: '#6250d6', values: run.priceEurMWh }]} k={k} onSeek={onSeek} timeLabel={timeLabel} height={90} zeroLine />
      </div>
      {yearTable?.sites[exampleId] ? <YearCard rows={yearTable.sites[exampleId] as Record<string, YearRow>} onGuide={onGuide} /> : null}
    </section>
  );
}

function CompareCard({ compare, base, looksAhead, onGuide }: { compare: { perfect: SimResult; realistic: SimResult }; base: SimResult; looksAhead: boolean; onGuide: (g: string) => void }) {
  const p = compare.perfect, r = compare.realistic;
  const rows: [string, number, number, (v: number) => string, boolean][] = [
    ['Total cost', p.bill.total, r.bill.total, eur, true],
    ['Saving vs baseline', base.bill.total - p.bill.total, base.bill.total - r.bill.total, eur, false],
    ['Peak import', p.bill.peakKW, r.bill.peakKW, (v) => fmt(v, 'kW'), true],
    ['Battery full cycles', p.battery.efc, r.battery.efc, (v) => v.toFixed(1), true],
  ];
  const sp = base.bill.total - p.bill.total, sr = base.bill.total - r.bill.total;
  const same = Math.abs(p.bill.total - r.bill.total) < 0.5;
  return (
    <div className="card compare">
      <div className="card-head">
        <b>Perfect vs realistic forecasts</b> <Help text="The same site run twice. 'Perfect' knows the future exactly; 'realistic' knows only what a real controller could. The gap is the cost of not knowing the future." guide="ch17" onGuide={onGuide} />
        <div className="small muted">
          {!looksAhead ? 'This strategy never looks ahead, so the realistic run is identical. Only a planner (MPC) can gain from a forecast or lose from a bad one.'
            : same ? 'Here, realistic forecasts cost nothing.'
              : `Not knowing the future costs ${eur(r.bill.total - p.bill.total)} over this period. Realistic forecasts keep ${sp > 0 ? Math.round((sr / sp) * 100) : 0} % of the perfect-forecast saving.`}
        </div>
      </div>
      <table>
        <thead><tr><th>Metric</th><th className="r">Perfect</th><th className="r">Realistic</th><th className="r">Difference</th></tr></thead>
        <tbody>
          {rows.map(([label, a, b, f, lowerBetter]) => {
            const d = b - a;
            return (
              <tr key={label}>
                <td>{label}</td><td className="r num">{f(a)}</td><td className="r num">{f(b)}</td>
                <td className={`r num ${Math.abs(d) < 1e-6 ? 'muted' : (d > 0) === lowerBetter ? 'bad' : 'good'}`}>{Math.abs(d) < 0.05 ? 'Same' : `${d > 0 ? '+' : '−'}${f(Math.abs(d)).replace('−', '')}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const STRATS: [string, string][] = [['peakShave', 'Static peak shaving'], ['priceRules', 'Price-aware rules'], ['mpc', 'MPC (optimiser)']];

function YearCard({ rows, onGuide }: { rows: Record<string, YearRow>; onGuide: (g: string) => void }) {
  const base = rows.baseline;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-head">
        <b>Full year, all strategies (this example, default settings)</b> <Help text="Pre-computed over Oct 2025 – Sep 2026 with the example's default settings, so your edits are not included. The full year is what counts: the peak charge is set by the single highest quarter-hour of the year." guide="ch18" onGuide={onGuide} />
        <div className="small muted">Bill without battery: {eur(base.costEur)} per year · peak {fmt(base.peakKW, 'kW')} · {base.fullLoadHours.toLocaleString('en-GB')} full-load hours</div>
      </div>
      <table>
        <thead>
          <tr><th>Strategy</th><th className="r">Bill saving</th><th className="r">Wear cost</th><th className="r">Net saving, perfect</th><th className="r">Net saving, realistic</th><th className="r">Peak</th><th className="r">Cycles / yr</th><th className="r">Limits</th></tr>
        </thead>
        <tbody>
          {STRATS.map(([key, label]) => {
            const p = rows[`${key}/perfect`], r = rows[`${key}/realistic`];
            if (!p || !r) return null;
            return (
              <tr key={key}>
                <td>{label}</td>
                <td className="r num">{eur(r.savingEur)}</td>
                <td className="r num">{r.wearEur !== undefined ? eur(-r.wearEur) : '–'}</td>
                <td className="r num">{eur(p.savingAfterWearEur ?? p.savingEur)}</td>
                <td className="r num"><b>{eur(r.savingAfterWearEur ?? r.savingEur)}</b></td>
                <td className="r num">{fmt(r.peakKW, 'kW')}</td>
                <td className="r num">{r.efc.toFixed(0)}</td>
                <td className="r">{r.limitBreaches === 0 && r.balanceOk ? <span className="good">✓ kept</span> : <span className="bad">✗ {r.limitBreaches}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted" style={{ padding: '6px 14px' }}>Bill saving, wear cost, peak and cycles are for realistic forecasts. Wear = 78 € per MWh discharged, a placeholder until the wear model (DECISIONS D-022).</p>
    </div>
  );
}
