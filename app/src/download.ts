/**
 * Save an on-screen SVG as a PNG (or SVG) file.
 * CSS variables and stylesheet rules do not travel with an exported SVG, so every element's computed
 * fill, stroke and font are written onto a copy first. Animations are frozen at the current frame.
 */
const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity', 'font-family', 'font-size', 'font-weight'] as const;

function inlineCopy(svg: SVGSVGElement): SVGSVGElement {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll('*'), dst = copy.querySelectorAll('*');
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const d = dst[i] as SVGElement;
    PROPS.forEach((p) => { const v = cs.getPropertyValue(p); if (v) d.style.setProperty(p, v); });
    d.style.animation = 'none';
  });
  // foreignObject (HTML icons) cannot be drawn onto a canvas; drop them
  copy.querySelectorAll('foreignObject').forEach((f) => f.remove());
  const r = svg.getBoundingClientRect();
  copy.setAttribute('width', String(Math.round(r.width)));
  copy.setAttribute('height', String(Math.round(r.height)));
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return copy;
}

const save = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

export async function downloadSvg(svg: SVGSVGElement, name: string, format: 'png' | 'svg' = 'png', scale = 2) {
  const copy = inlineCopy(svg);
  const text = new XMLSerializer().serializeToString(copy);
  if (format === 'svg') return save(new Blob([text], { type: 'image/svg+xml' }), `${name}.svg`);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('could not render image')); img.src = url; });
  const w = Number(copy.getAttribute('width')), h = Number(copy.getAttribute('height'));
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => b && save(b, `${name}.png`), 'image/png');
}
