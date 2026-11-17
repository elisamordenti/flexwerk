import { useEffect, useLayoutEffect, useState } from 'react';

/** One step of the guided tour. `target` is a data-tour attribute; no target = centred card. */
interface Step { target?: string; title: string; body: string }

const STEPS: Step[] = [
  {
    title: 'Welcome to Flexwerk',
    body: 'This lab simulates a business site (a factory, a warehouse, a cold store) one quarter-hour at a time: how much power each part uses or makes, and what flows to and from the grid. Use it to see what a battery and its controller change. Look for the ? buttons for more detail on any concept.',
  },
  { target: 'examples', title: 'Start from an example', body: 'Pick a ready-made site. Each opens on the week of its highest grid draw of the year, the moment that matters most for the bill.' },
  { target: 'palette', title: 'Add parts to your site', body: 'Click to add a load, solar panels, a battery or the grid connection. You can add as many as you like. Greyed-out parts are coming soon.' },
  { target: 'diagram', title: 'Watch the energy flow', body: 'Every part connects to one site bus behind one meter. Thicker lines mean more kW, colour shows the type of flow, and moving dashes show direction. Click a part to edit it.' },
  { target: 'playhead', title: 'Move through time', body: 'Press play or drag the slider. The diagram and every chart follow the same moment. One step is 15 minutes, the same interval German meters bill on.' },
  { target: 'panel', title: 'Settings', body: 'With nothing selected you see the site: which period to simulate, which control strategy runs the battery (from simple rules to an optimiser that plans 24 h ahead) and what it may know about the future. Select a part to change its settings, such as battery size or solar kWp.' },
  { target: 'compare', title: 'Compare forecasts', body: 'Runs your site twice: once as if the controller knew the future exactly, once with only what it could really know. The gap is the cost of not seeing the future. Strategies that never look ahead show no gap.' },
  { target: 'results', title: 'Results vs doing nothing', body: 'Every change re-runs the site twice: with your strategy and with the battery switched off (the baseline). The tiles show the difference in cost and peak. The badges check that no limit was broken and that energy in equals energy out at every step.' },
  { target: 'data', title: 'Where the numbers come from', body: 'Every input is open data with its source, licence and how much to trust it. Nothing is invented.' },
  { target: 'learn', title: 'Learn the theory', body: 'The guide explains each idea used here, from kW vs kWh to how a controller plans ahead. Each chapter links back to the lab.' },
];

const KEY = 'cibl-tour-seen';

export function useTourAutostart(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // shared links with settings (?ctl=...) open straight on the content
    try { if (!localStorage.getItem(KEY) && !location.search) setOpen(true); } catch { /* storage blocked: skip autostart */ }
  }, []);
  const set = (v: boolean) => {
    setOpen(v);
    if (!v) try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
  };
  return [open, set];
}

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];

  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step.target]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => Math.min(STEPS.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  // place the card next to the highlighted element, kept inside the window
  const CW = 340, vw = window.innerWidth, vh = window.innerHeight;
  let style: React.CSSProperties;
  if (!rect) style = { left: Math.max(16, (vw - CW) / 2), top: Math.max(16, vh / 2 - 140) };
  else {
    const below = rect.bottom + 12 + 220 < vh;
    const top = below ? rect.bottom + 12 : Math.max(16, rect.top - 12 - 230);
    const roomRight = rect.right + 12 + CW < vw;
    const left = rect.height > vh * 0.5 // tall panels: put the card beside them
      ? (roomRight ? rect.right + 12 : Math.max(16, rect.left - 12 - CW))
      : Math.min(vw - CW - 16, Math.max(16, rect.left));
    style = { left, top: rect.height > vh * 0.5 ? Math.max(16, rect.top + 40) : top };
  }
  const last = i === STEPS.length - 1;

  return (
    <div className="tour-layer" role="dialog" aria-label="Guided tour">
      {rect ? <div className="tour-hole" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />
        : <div className="tour-dim" />}
      <div className="tour-card" style={{ ...style, width: Math.min(CW, vw - 32) }}>
        <div className="tour-top"><span className="small muted">{i + 1} of {STEPS.length}</span>
          <button className="btn ghost" aria-label="Close tour" onClick={onClose}>✕</button></div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-foot">
          <div className="tour-dots">{STEPS.map((_, j) => <span key={j} className={j === i ? 'on' : ''} />)}</div>
          {i > 0 ? <button className="btn" onClick={() => setI(i - 1)}>← Back</button> : null}
          <button className="btn primary" onClick={() => (last ? onClose() : setI(i + 1))}>{i === 0 ? 'Start →' : last ? 'Done' : 'Next →'}</button>
        </div>
      </div>
    </div>
  );
}
