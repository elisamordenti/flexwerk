import { useEffect, useMemo, useRef, useState } from 'react';
import { assetType, CONTROLLERS, EXAMPLES, type ForecastMode, type ParamValue, type SimResult, type SiteSpec } from '@cibl/engine';
import type { WorkerIn, WorkerOut } from './sim.worker';
import { loadAppData, type AppData } from './data';
import { Palette } from './components/Palette';
import { FlowDiagram } from './components/FlowDiagram';
import { Scene } from './components/Scene';
import { downloadSvg } from './download';
import { SidePanel, type Period } from './components/SidePanel';
import { Results } from './components/Results';
import { Learn } from './components/Learn';
import { DataPanel } from './components/DataPanel';
import { Tour, useTourAutostart } from './components/Tour';
import { stepOfDay } from './time';

type Page = 'lab' | 'learn';
const pageFromHash = (): { page: Page; chapter: string } => {
  const m = location.hash.match(/^#learn-(.+)$/);
  return m ? { page: 'learn', chapter: m[1] } : location.hash === '#learn' ? { page: 'learn', chapter: 'ch1' } : { page: 'lab', chapter: 'ch1' };
};

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const TZ_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // shareable links: ?ex=warehouse&ctl=mpc&fc=realistic&compare=1
  const qs = useMemo(() => new URLSearchParams(location.search), []);
  const ex0 = EXAMPLES.find((x) => x.id === qs.get('ex')) ?? EXAMPLES[0];
  const [site, setSite] = useState<SiteSpec>(() => {
    const s = clone(ex0);
    const c = qs.get('ctl');
    if (c && CONTROLLERS.some((x) => x.type === c && x.available)) s.controller = { type: c, params: c === 'mpc' ? {} : s.controller.params };
    if (qs.get('fc') === 'realistic') s.forecast = 'realistic';
    return s;
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [exampleId, setExampleId] = useState(ex0.id);
  const [period, setPeriod] = useState<Period>(ex0.defaultPeriod);
  const [res, setRes] = useState<{ run: SimResult; base: SimResult; ms: number; compare: { perfect: SimResult; realistic: SimResult } | null } | null>(null);
  const [compareOn, setCompareOn] = useState(() => qs.get('compare') === '1');
  const [progress, setProgress] = useState<{ share: number; label: string } | null>(null);
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const jobId = useRef(0);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [route, setRoute] = useState(pageFromHash);
  const [showData, setShowData] = useState(false);
  const [view, setView] = useState<'diagram' | 'scene'>(() => (qs.get('view') === 'scene' ? 'scene' : 'diagram'));
  const canvasRef = useRef<HTMLDivElement>(null);
  const [tourOpen, setTourOpen] = useTourAutostart();

  useEffect(() => { loadAppData().then(setData).catch((e) => setErr(String(e))); }, []);
  // shareable link straight to the data sources: …/#data
  useEffect(() => { if (location.hash === '#data') { setShowData(true); setTourOpen(false); } }, []);
  useEffect(() => {
    const f = () => setRoute(pageFromHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  // The simulation runs in a Web Worker. A new change while a long run is busy restarts the worker.
  const startWorker = (d: AppData) => {
    worker.current?.terminate();
    const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    w.postMessage({ kind: 'init', site: d.site, tariff: d.tariff } satisfies WorkerIn);
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.id !== jobId.current) return; // an older job
      if (m.kind === 'progress') { setProgress({ share: m.share, label: m.label }); return; }
      busy.current = false;
      setProgress(null);
      if (m.kind === 'error') { setRunErr(m.message); setRes(null); return; }
      setRes({ run: m.run, base: m.base, ms: m.ms, compare: m.compare });
      setRunErr(null);
      setK((x) => Math.min(x, m.run.steps - 1));
    };
    w.onerror = (e) => { busy.current = false; setProgress(null); setRunErr(`Simulation worker failed: ${e.message || 'could not start'}`); };
    worker.current = w;
  };
  useEffect(() => { if (data) startWorker(data); return () => worker.current?.terminate(); }, [data]);

  // Re-run automatically on every change (debounced): the baseline is the same site with the battery idle.
  useEffect(() => {
    if (!data) return;
    const h = setTimeout(() => {
      const a = Math.max(0, stepOfDay(period.startDay, data.site.start, data.site.stepMinutes));
      const b = Math.min(data.site.n, stepOfDay(period.startDay + period.days, data.site.start, data.site.stepMinutes));
      if (busy.current) startWorker(data);
      const id = ++jobId.current;
      busy.current = true;
      setProgress({ share: 0, label: '' });
      worker.current!.postMessage({ kind: 'run', id, spec: site, startStep: a, steps: b - a, compare: compareOn } satisfies WorkerIn);
    }, 200);
    return () => clearTimeout(h);
  }, [site, period, data, compareOn]);

  // play / pause the playhead
  const raf = useRef<number>();
  useEffect(() => {
    if (!playing || !res) return;
    let last = performance.now();
    const tick = (now: number) => {
      if (now - last > 60) {
        last = now;
        setK((x) => (x + 1 >= res.run.steps ? 0 : x + 1));
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current!);
  }, [playing, res]);

  const timeLabel = useMemo(() => {
    const start = res ? Date.parse(res.run.startISO) : 0;
    return (i: number) => (res ? TZ_FMT.format(new Date(start + i * 15 * 60000)) : '');
  }, [res]);

  const go = (page: Page, chapter = route.chapter) => { location.hash = page === 'learn' ? `#learn-${chapter}` : ''; setRoute({ page, chapter }); };
  const openGuide = (g: string) => go('learn', g);

  const addAsset = (type: string) => {
    const t = assetType(type);
    const n = site.assets.filter((a) => a.type === type).length + 1;
    const id = `${type}${Date.now().toString(36)}`;
    setSite((s) => ({ ...s, assets: [...s.assets, { id, type, name: `${t.label.split(' ')[0]} ${n}`, params: {} }] }));
    setSelected(id);
  };
  const setParam = (id: string, key: string, v: ParamValue) =>
    setSite((s) => ({ ...s, assets: s.assets.map((a) => (a.id === id ? { ...a, params: { ...a.params, [key]: v } } : a)) }));

  if (err) return <div style={{ padding: 24 }}>Could not load data: {err}</div>;
  const sel = site.assets.find((a) => a.id === selected) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">⚡</span> Flexwerk</div>
        <div className="tabs" role="tablist">
          <button className={route.page === 'lab' ? 'on' : ''} onClick={() => go('lab')}>Lab</button>
          <button className={route.page === 'learn' ? 'on' : ''} onClick={() => go('learn')} data-tour="learn">Learn</button>
        </div>
        {route.page === 'lab' ? (
          <>
            <select className="btn" value={exampleId} aria-label="Example site" data-tour="examples"
              onChange={(e) => { const ex = EXAMPLES.find((x) => x.id === e.target.value)!; setExampleId(ex.id); setSite(clone(ex)); setPeriod(ex.defaultPeriod); setSelected(null); setK(0); }}>
              {EXAMPLES.map((x) => <option key={x.id} value={x.id}>Example: {x.name}</option>)}
            </select>
            <span className="small muted">{EXAMPLES.find((x) => x.id === exampleId)?.description}</span>
          </>
        ) : null}
        <span className="spacer" />
        {route.page === 'lab' ? (
          <button className={`btn ${compareOn ? 'primary' : ''}`} onClick={() => setCompareOn((c) => !c)} disabled={!data} data-tour="compare"
            title="Run the site twice: with perfect forecasts and with realistic ones">⚖ Compare forecasts</button>
        ) : null}
        <button className="btn ghost" onClick={() => { go('lab'); setTourOpen(true); }} disabled={!data}>Tour</button>
        <button className="btn ghost" onClick={() => setShowData(true)} disabled={!data} data-tour="data">Data &amp; sources</button>
      </header>

      {route.page === 'learn' ? (
        <Learn chapter={route.chapter} onChapter={(c) => go('learn', c)} onTryIt={() => go('lab')} />
      ) : !data ? (
        <div style={{ padding: 24 }} className="muted">Loading open data…</div>
      ) : (
        <main className="lab">
          <Palette assets={site.assets} onAdd={addAsset} />
          <div className="center">
            <div className="canvas-head">
              <b>Energy flows</b>
              <span className="seg" role="tablist" aria-label="View">
                <button className={view === 'diagram' ? 'on' : ''} onClick={() => setView('diagram')}>Diagram</button>
                <button className={view === 'scene' ? 'on' : ''} onClick={() => setView('scene')} data-tour="scene">Scene</button>
              </span>
              <button className="btn" title="Save the current view as an image (PNG)"
                onClick={() => { const svg = canvasRef.current?.querySelector('svg'); if (svg) void downloadSvg(svg, `${exampleId}-${view}-${timeLabel(k).replace(/[^0-9A-Za-z]+/g, '-')}`); }}>⤓ Image</button>
              <span className="small muted">line thickness ∝ kW · moving dots show direction · click an asset to edit it</span>
              <span className="spacer" />
              {progress ? (
                <span className="progress small" role="status">
                  <span className="bar"><span style={{ width: `${Math.round(progress.share * 100)}%` }} /></span>
                  {CONTROLLERS.find((c) => c.type === site.controller.type)?.needsSolver ? 'Planning' : 'Simulating'}{progress.label ? ` (${progress.label})` : ''}… {Math.round(progress.share * 100)} %
                </span>
              ) : res ? <span className="small muted num">{res.run.steps} quarter-hours · {res.compare ? '3 runs' : 'run + baseline'} in {res.ms < 1 ? '<1' : res.ms < 1000 ? res.ms.toFixed(0) + ' ms' : (res.ms / 1000).toFixed(1) + ' s'}</span> : null}
            </div>
            <div className="canvas" data-tour="diagram" ref={canvasRef}>
              {runErr ? <div style={{ position: 'absolute', top: 10, left: 14, color: 'var(--bad)' }} className="small">⚠ {runErr}</div> : null}
              {view === 'scene'
                ? <Scene assets={site.assets} run={res?.run ?? null} k={k} selected={selected} onSelect={setSelected} />
                : <FlowDiagram assets={site.assets} run={res?.run ?? null} k={k} selected={selected} onSelect={setSelected} />}
            </div>
            <div className="playhead" data-tour="playhead">
              <button className="btn" onClick={() => setPlaying((p) => !p)} disabled={!res} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
              <input type="range" min={0} max={Math.max(0, (res?.run.steps ?? 1) - 1)} value={k} onChange={(e) => setK(Number(e.target.value))} aria-label="Time" />
              <span className="small num" style={{ minWidth: 190 }}>{timeLabel(k)}</span>
            </div>
          </div>
          <SidePanel site={site} selected={sel} period={period} onPeriod={setPeriod}
            onAssetParam={setParam}
            onRename={(id, name) => setSite((s) => ({ ...s, assets: s.assets.map((a) => (a.id === id ? { ...a, name } : a)) }))}
            onRemove={(id) => { setSite((s) => ({ ...s, assets: s.assets.filter((a) => a.id !== id) })); setSelected(null); }}
            onController={(type, params) => setSite((s) => ({ ...s, controller: { type, params } }))}
            onForecast={(f: ForecastMode) => setSite((s) => ({ ...s, forecast: f }))}
            onGuide={openGuide} />
          {res ? <Results run={res.run} base={res.base} compare={res.compare} controllerType={site.controller.type} exampleId={exampleId} yearTable={data.yearTable}
            k={k} onSeek={setK} timeLabel={timeLabel} onGuide={openGuide} /> : <section className="bottom muted">{runErr ? '' : 'Simulating…'}</section>}
        </main>
      )}
      {tourOpen && data && route.page === 'lab' ? <Tour onClose={() => setTourOpen(false)} /> : null}
      {showData && data ? <DataPanel data={data} onClose={() => setShowData(false)} /> : null}
    </div>
  );
}
