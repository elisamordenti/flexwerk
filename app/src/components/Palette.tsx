import { REGISTRY, type AssetInstance } from '@cibl/engine';
import { AssetIcon } from './Icons';

export function Palette({ assets, onAdd }: { assets: AssetInstance[]; onAdd: (type: string) => void }) {
  return (
    <aside className="palette" data-tour="palette">
      <div className="section-title">Asset catalogue</div>
      <p className="small muted" style={{ marginTop: 0 }}>Click to add to the site. Add as many as you like; one grid connection per site.</p>
      {REGISTRY.map((t) => {
        const count = assets.filter((a) => a.type === t.type).length;
        const full = t.maxCount !== undefined && count >= t.maxCount;
        return (
          <button key={t.type} className="pal-item" disabled={!t.available || full} onClick={() => onAdd(t.type)}
            title={!t.available ? 'Planned: the plug-in slot exists, the model comes later' : full ? 'Only one per site' : `Add ${t.label}`}>
            <AssetIcon name={t.icon} color={t.available ? t.color : '#898781'} />
            <span>
              <span className="lbl">{t.label}</span>
              {!t.available ? <span className="badge">soon</span> : count ? <span className="badge">{count} on site</span> : null}
              <div className="desc">{t.description}</div>
            </span>
          </button>
        );
      })}
    </aside>
  );
}
