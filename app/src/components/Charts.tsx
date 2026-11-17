import { useEffect, useMemo, useRef, useState } from 'react';

export interface Line {
  label: string;
  color: string;
  values: ArrayLike<number>;
  dashed?: boolean;
}

interface Props {
  title: string;
  unit: string;
  lines: Line[];
  k: number;
  onSeek: (k: number) => void;
  timeLabel: (k: number) => string;
  height?: number;
  zeroLine?: boolean;
}

const PAD_L = 46, PAD_R = 8, PAD_T = 6, PAD_B = 18;

/** Downsample to at most ~maxPts points per line (bucket means): no detail is invented. */
function buckets(n: number, maxPts = 900) {
  const size = Math.max(1, Math.ceil(n / maxPts));
  const out: [number, number][] = [];
  for (let s = 0; s < n; s += size) out.push([s, Math.min(n, s + size)]);
  return out;
}

const niceTicks = (lo: number, hi: number) => {
  const span = hi - lo || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const m = [1, 2, 2.5, 5, 10].find((f) => span / (f * step) <= 5) ?? 10;
  const st = m * step;
  const ticks = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) ticks.push(v);
  return ticks;
};

export function LineChart({ title, unit, lines, k, onSeek, timeLabel, height = 130, zeroLine }: Props) {
  const n = lines[0]?.values.length ?? 0;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(1000);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = height;
  const { paths, lo, hi } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const l of lines) for (let i = 0; i < l.values.length; i++) { const v = l.values[i]; if (Number.isNaN(v)) continue; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const pad = (hi - lo) * 0.06 || 1;
    lo -= pad; hi += pad;
    const bs = buckets(n);
    const x = (i: number) => PAD_L + ((W - PAD_L - PAD_R) * i) / Math.max(1, n - 1);
    const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - (v - lo) / (hi - lo));
    // NaN = no value (e.g. outside a plan's horizon): the line is broken there
    const paths = lines.map((l) => {
      let out = '', pen = false;
      for (const [a, b] of bs) {
        let s = 0, c = 0;
        for (let i = a; i < b; i++) { const v = l.values[i]; if (!Number.isNaN(v)) { s += v; c++; } }
        if (!c) { pen = false; continue; }
        out += `${pen ? 'L' : 'M'}${x((a + b - 1) / 2).toFixed(1)},${y(s / c).toFixed(1)}`;
        pen = true;
      }
      return out;
    });
    return { paths, lo, hi };
  }, [lines, n, H, W, zeroLine]);

  const x = (i: number) => PAD_L + ((W - PAD_L - PAD_R) * i) / Math.max(1, n - 1);
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - (v - lo) / (hi - lo));
  const idxAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * (n - 1))));
  };
  const hv = hover ?? k;
  return (
    <div className="chart">
      <h4>
        {title} <span className="muted small">({unit})</span>
        {lines.length > 1 ? lines.map((l) => (
          <span className="legend" key={l.label}>
            <span className="swatch" style={{ background: l.color, opacity: l.dashed ? 0.6 : 1 }} />{l.label}
            <span className="num" style={{ color: 'var(--ink)' }}>{Number.isFinite(l.values[hv]) ? l.values[hv].toFixed(0) : '–'}</span>
          </span>
        )) : <span className="legend num" style={{ color: 'var(--ink)' }}>{lines[0]?.values[hv]?.toFixed(1)} {unit}</span>}
        <span className="muted small" style={{ marginLeft: 'auto' }}>{timeLabel(hv)}</span>
      </h4>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ height: H }}
        onMouseMove={(e) => setHover(idxAt(e.clientX))} onMouseLeave={() => setHover(null)}
        onClick={(e) => onSeek(idxAt(e.clientX))} role="img" aria-label={`${title} chart`}>
        {niceTicks(lo, hi).map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke={t === 0 && zeroLine ? '#c9c8c2' : '#efeeea'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" className="axis">{Math.abs(t) >= 1000 ? `${(t / 1000).toFixed(1)}k` : t.toFixed(t % 1 ? 1 : 0)}</text>
          </g>
        ))}
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={lines[i].color} strokeWidth={lines[i].dashed ? 1.2 : 1.6}
            strokeDasharray={lines[i].dashed ? '4 3' : undefined} opacity={lines[i].dashed ? 0.75 : 1} vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={x(k)} x2={x(k)} y1={PAD_T} y2={H - PAD_B} stroke="var(--ink)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} stroke="var(--muted)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
        <text x={PAD_L} y={H - 4} className="axis">{timeLabel(0)}</text>
        <text x={W - PAD_R} y={H - 4} textAnchor="end" className="axis">{timeLabel(n - 1)}</text>
      </svg>
    </div>
  );
}
