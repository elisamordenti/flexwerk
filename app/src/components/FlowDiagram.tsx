import type { AssetInstance, SimResult } from '@cibl/engine';
import { assetType } from '@cibl/engine';
import { AssetIcon } from './Icons';

/** Colour and direction of the flow on one connector, by asset role and sign. */
export function flowStyle(type: string, p: number): { color: string; label: string; towardBus: boolean } {
  const idle = Math.abs(p) < 0.05;
  switch (type) {
    case 'grid':
      return p >= 0 ? { color: 'var(--c-import)', label: idle ? 'idle' : 'importing', towardBus: true }
        : { color: 'var(--c-export)', label: 'exporting', towardBus: false };
    case 'pv':
      return { color: 'var(--c-solar)', label: idle ? 'no sun' : 'generating', towardBus: true };
    case 'battery':
      return p > 0 ? { color: 'var(--c-charge)', label: idle ? 'idle' : 'charging', towardBus: false }
        : { color: 'var(--c-discharge)', label: idle ? 'idle' : 'discharging', towardBus: true };
    default:
      return { color: 'var(--c-load)', label: 'consuming', towardBus: false };
  }
}

export const fmtKW = (x: number) => `${Math.abs(x) >= 1000 ? (Math.abs(x) / 1000).toFixed(2) + ' MW' : Math.abs(x).toFixed(0) + ' kW'}`;

interface Props {
  assets: AssetInstance[];
  run: SimResult | null;
  k: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

const W = 900, H = 480, BUS_Y = 220, GRID_Y = 40, ASSET_Y = 330, CARD_W = 168, CARD_H = 84;

export function FlowDiagram({ assets, run, k, selected, onSelect }: Props) {
  const grid = assets.find((a) => a.type === 'grid');
  const others = assets.filter((a) => a.type !== 'grid');
  const n = Math.max(1, others.length);
  const span = Math.min(W - 80, n * (CARD_W + 24));
  const x0 = (W - span) / 2;
  const xs = others.map((_, i) => x0 + span * ((i + 0.5) / n));

  // scale line width by the largest power anywhere in the run
  let maxP = 1;
  if (run) {
    for (const a of run.assets) for (let i = 0; i < a.power.length; i++) maxP = Math.max(maxP, Math.abs(a.power[i]));
    for (let i = 0; i < run.gridKW.length; i++) maxP = Math.max(maxP, Math.abs(run.gridKW[i]));
  }
  const width = (p: number) => 2 + 16 * Math.sqrt(Math.min(1, Math.abs(p) / maxP));
  const powerOf = (id: string) => {
    if (!run) return 0;
    if (id === grid?.id) return run.gridKW[k] ?? 0;
    return run.assets.find((a) => a.id === id)?.power[k] ?? 0;
  };

  const connector = (id: string, type: string, x1: number, y1: number, x2: number, y2: number) => {
    const p = powerOf(id);
    const st = flowStyle(type, p);
    const w = width(p);
    const d = `M${x1},${y1} L${x2},${y2}`;
    const moving = run && Math.abs(p) > 0.05;
    // path is drawn from the node toward the bus for assets, from the grid down to the bus for the grid
    const forward = type === 'grid' ? p >= 0 : st.towardBus;
    return (
      <g key={`c-${id}`}>
        <path d={d} className="flow" stroke={moving ? st.color : '#d9d8d3'} strokeWidth={moving ? w : 2} opacity={moving ? 0.9 : 1} />
        {moving ? <path d={d} className={`flow-dash ${forward ? '' : 'rev'}`} strokeWidth={Math.max(1.5, w * 0.35)} /> : null}
      </g>
    );
  };

  const card = (a: AssetInstance, cx: number, cy: number) => {
    const t = assetType(a.type);
    const p = powerOf(a.id);
    const st = flowStyle(a.type, p);
    const fs = run?.flexState?.[a.id];
    const soc = run?.soc[a.id]?.[k] ?? (fs?.kind === 'heatpump' ? fs.level[k] : undefined);
    const vans = fs?.kind === 'ev' ? fs.count?.[k] : undefined;
    return (
      <g key={a.id} className={`node ${selected === a.id ? 'sel' : ''}`} transform={`translate(${cx - CARD_W / 2},${cy})`}
        onClick={(e) => { e.stopPropagation(); onSelect(a.id); }} role="button" aria-label={`${a.name}, ${t.label}`}>
        <rect className="card" width={CARD_W} height={CARD_H} rx={12} />
        <rect x={0} y={0} width={5} height={CARD_H} rx={2} fill={t.color} />
        <foreignObject x={12} y={12} width={30} height={30}><AssetIcon name={t.icon} color={t.color} /></foreignObject>
        <text x={48} y={24} fontWeight={600}>{a.name}</text>
        <text x={48} y={40} className="sub">{t.label}</text>
        {run ? (
          <>
            <text x={12} y={66} fontWeight={600} className="num" fill={st.color}>{fmtKW(p)}</text>
            <text x={84} y={66} className="sub">{soc !== undefined ? `${fs ? 'tank' : 'SoC'} ${(soc * 100).toFixed(0)} %` : vans !== undefined ? `${vans} vans plugged` : st.label}</text>
            {soc !== undefined ? (
              <g transform="translate(84,72)">
                <rect width={70} height={5} rx={2.5} fill="var(--surface-2)" />
                <rect width={70 * soc} height={5} rx={2.5} fill={fs ? '#d9466b' : 'var(--c-charge)'} />
              </g>
            ) : null}
          </>
        ) : <text x={12} y={66} className="sub">press Run to simulate</text>}
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" onClick={() => onSelect(null)} role="img" aria-label="Energy flow diagram of the site">
      {/* bus bar */}
      <rect x={Math.min(x0, W / 2 - 60) - 10} y={BUS_Y - 4} width={Math.max(span, 120) + 20} height={8} rx={4} fill="var(--ink-2)" opacity={0.85} />
      <text x={Math.min(x0, W / 2 - 60) - 10} y={BUS_Y - 12} className="axis">site bus (one meter)</text>
      {grid ? connector(grid.id, 'grid', W / 2, GRID_Y + CARD_H, W / 2, BUS_Y) : null}
      {others.map((a, i) => connector(a.id, a.type, xs[i], ASSET_Y, xs[i], BUS_Y))}
      {grid ? card(grid, W / 2, GRID_Y) : null}
      {others.map((a, i) => card(a, xs[i], ASSET_Y))}
      {!grid ? <text x={W / 2} y={GRID_Y + 40} textAnchor="middle" className="axis">Add a grid connection from the catalogue</text> : null}
    </svg>
  );
}
