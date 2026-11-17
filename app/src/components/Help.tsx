/** The "?" on every input and KPI: meaning, unit, source, guide link. */
export function Help({ text, source, unit, guide, onGuide }: { text: string; source?: string; unit?: string; guide?: string; onGuide?: (g: string) => void }) {
  return (
    <button className="help" type="button" aria-label="Help" onClick={(e) => { e.preventDefault(); if (guide && onGuide) onGuide(guide); }}>
      ?
      <span className="tip" role="tooltip">
        {text}
        {unit ? <div className="src">Unit: {unit}</div> : null}
        {source ? <div className="src">Source: {source}</div> : null}
        {guide ? <div className="src">Click for the guide page →</div> : null}
      </span>
    </button>
  );
}
