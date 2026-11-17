import type { ReactNode } from 'react';
import type { AssetInstance, SimResult } from '@cibl/engine';
import { flowStyle, fmtKW } from './FlowDiagram';

/**
 * Illustrated isometric view of the plant. All drawings are our own SVG, built from iso boxes.
 * Ground coordinates (x, y) in tiles, height z in tiles. The viewer looks from +x,+y (bottom of the screen).
 */
const T = 30;
const C30 = Math.cos(Math.PI / 6);
const iso = (x: number, y: number, z = 0): [number, number] => [(x - y) * C30 * T, ((x + y) * 0.5 - z) * T];
const pts = (...p: [number, number, number][]) => p.map(([x, y, z]) => iso(x, y, z).map((v) => v.toFixed(1)).join(',')).join(' ');

interface Shade { top: string; left: string; right: string; stroke?: string }
const shade = (top: string, left: string, right: string, stroke = '#00000022'): Shade => ({ top, left, right, stroke });
const WHITE = shade('#ffffff', '#e9e9e6', '#d6d6d2');
const GREY = shade('#eceae6', '#d8d6d1', '#c4c2bc');
const DARK = shade('#5d6168', '#4a4e55', '#3b3e44');

/** A box with its three visible faces. */
function Box({ x, y, z = 0, w, d, h, s }: { x: number; y: number; z?: number; w: number; d: number; h: number; s: Shade }) {
  return (
    <g stroke={s.stroke} strokeWidth={0.6} strokeLinejoin="round">
      <polygon points={pts([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h])} fill={s.left} />
      <polygon points={pts([x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h])} fill={s.right} />
      <polygon points={pts([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h])} fill={s.top} />
    </g>
  );
}

/** A flat rectangle on the front-left face (y = const), e.g. a window or a door. */
const FaceL = ({ x, y, z, w, h, fill }: { x: number; y: number; z: number; w: number; h: number; fill: string }) =>
  <polygon points={pts([x, y, z], [x + w, y, z], [x + w, y, z + h], [x, y, z + h])} fill={fill} />;
/** A flat rectangle on the front-right face (x = const). */
const FaceR = ({ x, y, z, d, h, fill }: { x: number; y: number; z: number; d: number; h: number; fill: string }) =>
  <polygon points={pts([x, y, z], [x, y + d, z], [x, y + d, z + h], [x, y, z + h])} fill={fill} />;

const Pad = ({ w = 3.2, d = 3.2 }: { w?: number; d?: number }) => (
  <polygon points={pts([-w / 2, -d / 2, 0], [w / 2, -d / 2, 0], [w / 2, d / 2, 0], [-w / 2, d / 2, 0])} fill="#e7eaf0" stroke="#d3d8e0" strokeWidth={0.8} />
);

// ---------- one drawing per asset type, centred on (0,0) ----------
function Factory() {
  const win = [];
  for (let i = 0; i < 6; i++) win.push(<FaceL key={i} x={-1.25 + i * 0.4} y={0.9} z={0.35} w={0.24} h={0.35} fill="#9fb3c8" />);
  const saw = [];
  for (let i = 0; i < 4; i++) {
    const x0 = -1.4 + i * 0.7;
    saw.push(<g key={i}>
      <polygon points={pts([x0, -0.9, 1.1], [x0, 0.9, 1.1], [x0, 0.9, 1.45], [x0, -0.9, 1.45])} fill="#a9c1d9" stroke="#00000022" strokeWidth={0.6} />
      <polygon points={pts([x0, -0.9, 1.45], [x0, 0.9, 1.45], [x0 + 0.7, 0.9, 1.1], [x0 + 0.7, -0.9, 1.1])} fill="#d9d7d2" stroke="#00000022" strokeWidth={0.6} />
      <polygon points={pts([x0, 0.9, 1.1], [x0 + 0.7, 0.9, 1.1], [x0, 0.9, 1.45])} fill="#cfcdc8" stroke="#00000022" strokeWidth={0.6} />
    </g>);
  }
  return <g><Pad w={3.6} d={2.6} /><Box x={-1.4} y={-0.9} w={2.8} d={1.8} h={1.1} s={GREY} />{win}
    <FaceR x={1.4} y={-0.2} z={0} d={0.6} h={0.6} fill="#7b8794" />{saw}</g>;
}

function Solar() {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const y0 = -1.1 + r * 0.8;
    rows.push(<g key={r}>
      {[-1.1, 1.0].map((x) => <line key={x} x1={iso(x, y0 + 0.45, 0)[0]} y1={iso(x, y0 + 0.45, 0)[1]} x2={iso(x, y0 + 0.45, 0.3)[0]} y2={iso(x, y0 + 0.45, 0.3)[1]} stroke="#8a8f98" strokeWidth={1.2} />)}
      <polygon points={pts([-1.3, y0, 0.45], [1.3, y0, 0.45], [1.3, y0 + 0.55, 0.15], [-1.3, y0 + 0.55, 0.15])} fill="#2f5d9e" stroke="#1d3d6b" strokeWidth={0.8} />
      {[-0.65, 0, 0.65].map((x) => <line key={x} x1={iso(x, y0, 0.45)[0]} y1={iso(x, y0, 0.45)[1]} x2={iso(x, y0 + 0.55, 0.15)[0]} y2={iso(x, y0 + 0.55, 0.15)[1]} stroke="#7fa6d9" strokeWidth={0.7} />)}
    </g>);
  }
  return <g><Pad w={3.2} d={2.8} />{rows}</g>;
}

function Battery() {
  return <g><Pad w={3.2} d={2.4} />
    {[-1.3, -0.35, 0.6].map((x) => (
      <g key={x}>
        <Box x={x} y={-0.8} w={0.8} d={1.6} h={1} s={WHITE} />
        {[0.15, 0.45, 0.75, 1.05, 1.35].map((d) => <FaceR key={d} x={x + 0.8} y={-0.8 + d} z={0.12} d={0.14} h={0.75} fill="#1baf7a" />)}
      </g>
    ))}</g>;
}

function GridMast() {
  // lattice tower: four legs narrowing to the top, cross arms, wires leaving to the top right
  const L = (a: [number, number, number], b: [number, number, number], w = 1.1) => {
    const p = iso(...a), q = iso(...b);
    return <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#7c828c" strokeWidth={w} />;
  };
  const legs: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const out: ReactNode[] = [];
  legs.forEach(([x, y], i) => out.push(<g key={`l${i}`}>{L([x, y, 0], [x * 0.25, y * 0.25, 3.4], 1.4)}</g>));
  [0.9, 1.8, 2.6].forEach((z, i) => {
    const k = 1 - (z / 3.4) * 0.75;
    out.push(<g key={`b${i}`}>{L([-0.5 * k, 0.5 * k, z], [0.5 * k, 0.5 * k, z])}{L([0.5 * k, -0.5 * k, z], [0.5 * k, 0.5 * k, z])}
      {L([-0.5 * k, 0.5 * k, z], [0.5 * k, 0.5 * k, z - 0.8])}</g>);
  });
  [2.7, 3.2].forEach((z, i) => out.push(<g key={`a${i}`}>{L([-0.9, 0, z], [0.9, 0, z], 1.6)}</g>));
  const wires = [-0.9, 0.9].map((x, i) => {
    const p = iso(x, 0, 3.2), p2 = iso(x, 0, 2.7);
    return <g key={`w${i}`} stroke="#9aa0a8" strokeWidth={0.8} fill="none">
      <path d={`M${p[0]},${p[1]} q 40,-30 95,-60`} /><path d={`M${p2[0]},${p2[1]} q 40,-30 95,-60`} />
    </g>;
  });
  return <g><Pad w={2.4} d={2.4} />{wires}{out}</g>;
}

function Connection() {
  return <g><Pad w={2.4} d={2.4} />
    <Box x={-0.8} y={-0.6} w={1.6} d={1.2} h={0.8} s={WHITE} />
    {[-0.4, 0.05, 0.5].map((x) => <g key={x}><Box x={x - 0.08} y={-0.15} z={0.8} w={0.16} d={0.16} h={0.35} s={DARK} /></g>)}
    <FaceL x={-0.45} y={0.6} z={0.15} w={0.5} h={0.5} fill="#2a78d6" />
    <path d={(() => { const a = iso(-0.15, 0.6, 0.6), b = iso(-0.25, 0.6, 0.38), c = iso(-0.1, 0.6, 0.38), d = iso(-0.2, 0.6, 0.2); return `M${a[0]},${a[1]} L${b[0]},${b[1]} L${c[0]},${c[1]} L${d[0]},${d[1]}`; })()} stroke="#fff" strokeWidth={1.4} fill="none" />
    {[0.15, 0.3, 0.45].map((d) => <FaceR key={d} x={0.8} y={-0.6 + d * 1.6} z={0.15} d={0.12} h={0.5} fill="#c9ccd2" />)}
  </g>;
}

function EvCharger() {
  const car = (x: number, color: string) => (
    <g key={x}>
      <Box x={x} y={-0.3} w={0.55} d={1.2} h={0.32} s={shade(color, color, color, '#00000033')} />
      <Box x={x + 0.05} y={-0.05} z={0.32} w={0.45} d={0.65} h={0.25} s={shade('#cfe0f0', '#9fb6cc', '#88a0b8')} />
    </g>
  );
  return <g><Pad w={3} d={2.6} />
    {[-1.1, 0.0, 1.1].map((x) => <Box key={`p${x}`} x={x + 0.15} y={-1.1} w={0.22} d={0.22} h={0.85} s={shade('#e8f6ee', '#cfe9da', '#b5dcc5')} />)}
    {car(-1.1, '#5f8fd1')}{car(0.0, '#e0e0dc')}{car(1.1, '#3b3e44')}
  </g>;
}

function HeatPump() {
  // outdoor unit with a round fan on the front-left face
  const fan = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI;
    return iso(-0.2 + 0.3 * Math.cos(a), 0.45, 0.45 + 0.3 * Math.sin(a));
  });
  return <g><Pad w={2.4} d={2.2} />
    <Box x={-0.7} y={-0.45} w={1.4} d={0.9} h={0.9} s={WHITE} />
    <polygon points={fan.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')} fill="#3b3e44" />
    {[0.25, 0.35, 0.45].map((x) => <FaceL key={x} x={x} y={0.45} z={0.2} w={0.06} h={0.55} fill="#c4c2bc" />)}
    {/* hot-water tank */}
    <Box x={0.85} y={-0.7} w={0.5} d={0.5} h={1.2} s={shade('#f3e2e6', '#e7c6cf', '#d9aab7')} />
  </g>;
}

const DRAW: Record<string, () => JSX.Element> = {
  grid: GridMast, load: Factory, pv: Solar, battery: Battery, ev: EvCharger, heatpump: HeatPump,
};

// Free places around the connection hub at (0,0), in drawing order of preference.
const SLOTS: [number, number][] = [[5, 4.5], [-4, 6.5], [-7, 0], [7, -2.5], [-6, -6.5], [1, 9], [9.5, 3.5], [-9.5, 5]];
const GRID_AT: [number, number] = [2, -7];

interface Props { assets: AssetInstance[]; run: SimResult | null; k: number; selected: string | null; onSelect: (id: string | null) => void }

export function Scene({ assets, run, k, selected, onSelect }: Props) {
  const grid = assets.find((a) => a.type === 'grid');
  const others = assets.filter((a) => a.type !== 'grid');
  const placed = others.map((a, i) => ({ a, at: SLOTS[i % SLOTS.length] }));
  let maxP = 1;
  if (run) {
    for (const t of run.assets) for (let i = 0; i < t.power.length; i++) maxP = Math.max(maxP, Math.abs(t.power[i]));
    for (let i = 0; i < run.gridKW.length; i++) maxP = Math.max(maxP, Math.abs(run.gridKW[i]));
  }
  const powerOf = (id: string, type: string) => !run ? 0 : type === 'grid' ? run.gridKW[k] ?? 0 : run.assets.find((t) => t.id === id)?.power[k] ?? 0;

  // flow along the ground: from the asset, first along x, then along y, to the hub
  const flow = (id: string, type: string, [x, y]: [number, number]) => {
    const p = powerOf(id, type), st = flowStyle(type, p), moving = !!run && Math.abs(p) > 0.05;
    const a = iso(x, y), m = iso(0, y), b = iso(0, 0);
    const d = `M${a[0]},${a[1]} L${m[0]},${m[1]} L${b[0]},${b[1]}`;
    const w = 2 + 7 * Math.sqrt(Math.min(1, Math.abs(p) / maxP));
    const forward = type === 'grid' ? p < 0 : !st.towardBus; // dots travel hub -> asset when forward
    return (
      <g key={`f${id}`}>
        <path d={d} fill="none" stroke={moving ? st.color : '#c9ccd3'} strokeWidth={moving ? 2.2 : 1.6} opacity={moving ? 0.55 : 1} />
        {moving ? <path d={d} fill="none" stroke={st.color} strokeWidth={w * 0.55} strokeLinecap="round" strokeDasharray="0.1 9" className={`scene-dots ${forward ? 'rev' : ''}`} /> : null}
      </g>
    );
  };

  const label = (a: AssetInstance, x: number, y: number, side = false) => {
    const p = powerOf(a.id, a.type), st = flowStyle(a.type, p);
    const fs = run?.flexState?.[a.id];
    const soc = run?.soc[a.id]?.[k] ?? (fs?.kind === 'heatpump' ? fs.level[k] : undefined);
    const vans = fs?.kind === 'ev' ? fs.count?.[k] : undefined;
    const [sx, sy] = iso(x, y);
    const extra = soc !== undefined ? ` · ${fs ? 'tank ' : ''}${(soc * 100).toFixed(0)} %` : vans !== undefined ? ` · ${vans} vans plugged` : '';
    const line2 = run ? `${fmtKW(p)} · ${st.label}${extra}` : '';
    const wpx = Math.max(a.name.length * 7.4, line2.length * 6.2) + 28;
    return (
      <g key={`lab${a.id}`} transform={side ? `translate(${sx + 48},${sy - 6})` : `translate(${sx - wpx / 2},${sy + 50})`} className="scene-label">
        <rect width={wpx} height={run ? 38 : 24} rx={6} fill="#ffffff" stroke={selected === a.id ? '#1baf7a' : '#d9dce2'} strokeWidth={selected === a.id ? 2 : 1} />
        <circle cx={10} cy={12} r={4} fill={st.color} />
        <text x={19} y={16} fontSize={12.5} fontWeight={600} fill="#0b0b0b">{a.name}</text>
        {run ? <text x={wpx / 2} y={31} fontSize={10.5} fill="#52514e" textAnchor="middle">{line2}</text> : null}
      </g>
    );
  };

  const items = [
    ...(grid ? [{ a: grid, at: GRID_AT }] : []),
    ...placed,
  ].sort((p, q) => p.at[0] + p.at[1] - (q.at[0] + q.at[1]));

  // fit the view to what is on the site: pads ±2 tiles, mast and wires above, labels below
  const anchors = [[0, 0] as [number, number], ...items.map((i) => i.at)].map(([x, y]) => iso(x, y));
  const xs = anchors.map((a) => a[0]), ys = anchors.map((a) => a[1]);
  const x0 = Math.min(...xs) - 3 * T, x1 = Math.max(...xs) + 3 * T + (grid ? 70 : 0);
  const y0 = Math.min(...ys) - (grid ? 4.6 * T : 2.5 * T), y1 = Math.max(...ys) + 2 * T + 40;
  const vb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" onClick={() => onSelect(null)} role="img" aria-label="Illustrated view of the site">
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#f6f7f9" />
      {grid ? flow(grid.id, 'grid', GRID_AT) : null}
      {placed.map(({ a, at }) => flow(a.id, a.type, at))}
      <g onClick={(e) => { e.stopPropagation(); if (grid) onSelect(grid.id); }} style={{ cursor: 'pointer' }}><Connection /></g>
      {items.map(({ a, at }) => {
        const Draw = DRAW[a.type] ?? Connection;
        const [sx, sy] = iso(at[0], at[1]);
        return (
          <g key={a.id} transform={`translate(${sx},${sy})`} style={{ cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelect(a.id); }} role="button" aria-label={a.name}>
            <Draw />
          </g>
        );
      })}
      {grid ? label({ ...grid, name: 'Grid connection' }, 0, 0, true) : null}
      {items.map(({ a, at }) => label(a.type === 'grid' ? { ...a, name: 'Utility grid' } : a, at[0], at[1], a.type === 'grid'))}
    </svg>
  );
}
