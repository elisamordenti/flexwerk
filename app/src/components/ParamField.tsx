import type { ParamDecl, ParamValue } from '@cibl/engine';
import { Help } from './Help';

/** One input, generated entirely from its parameter declaration. */
export function ParamField({ decl, value, onChange, onGuide }: { decl: ParamDecl; value: ParamValue; onChange: (v: ParamValue) => void; onGuide?: (g: string) => void }) {
  const id = `f-${decl.key}`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {decl.label}
        <Help text={decl.help} source={decl.source} unit={decl.unit || undefined} guide={decl.guide} onGuide={onGuide} />
      </label>
      <div className="row">
        {decl.kind === 'select' ? (
          <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {decl.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : decl.kind === 'boolean' ? (
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        ) : (
          <>
            <input id={id} type="number" value={Number(value)} min={decl.min} max={decl.max} step={decl.step}
              onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
            <span className="unit">{decl.unit}</span>
          </>
        )}
      </div>
    </div>
  );
}
