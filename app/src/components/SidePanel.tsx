import { assetType, CONTROLLERS, resolve, type AssetInstance, type ForecastMode, type ParamValue, type SiteSpec } from '@cibl/engine';
import { AssetIcon } from './Icons';
import { Help } from './Help';
import { ParamField } from './ParamField';

export interface Period { startDay: number; days: number }

interface Props {
  site: SiteSpec;
  selected: AssetInstance | null;
  period: Period;
  onPeriod: (p: Period) => void;
  onAssetParam: (id: string, key: string, v: ParamValue) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onController: (type: string, params: Record<string, ParamValue>) => void;
  onForecast: (f: ForecastMode) => void;
  onGuide: (g: string) => void;
}

const DAY0 = Date.UTC(2025, 9, 1);
const dayToISO = (d: number) => new Date(DAY0 + d * 86400000).toISOString().slice(0, 10);
const isoToDay = (s: string) => Math.round((Date.parse(s + 'T00:00:00Z') - DAY0) / 86400000);

export function SidePanel(p: Props) {
  if (p.selected) {
    const a = p.selected;
    const t = assetType(a.type);
    const vals = resolve(t.params, a.params);
    return (
      <aside className="side" data-tour="panel">
        <div className="panel-title">
          <AssetIcon name={t.icon} color={t.color} />
          <div style={{ flex: 1 }}>
            <input value={a.name} onChange={(e) => p.onRename(a.id, e.target.value)} aria-label="Asset name"
              style={{ font: 'inherit', fontWeight: 600, border: 0, background: 'transparent', width: '100%' }} />
            <div className="small muted">{t.label}</div>
          </div>
        </div>
        <p className="small muted">{t.description}</p>
        {t.params.map((d) => (
          <ParamField key={d.key} decl={d} value={vals[d.key]} onChange={(v) => p.onAssetParam(a.id, d.key, v)} onGuide={p.onGuide} />
        ))}
        <div className="hr" />
        <button className="btn danger" onClick={() => p.onRemove(a.id)}>Remove from site</button>
      </aside>
    );
  }
  const ctl = CONTROLLERS.find((c) => c.type === p.site.controller.type)!;
  const cvals = resolve(ctl.params, p.site.controller.params);
  return (
    <aside className="side" data-tour="panel">
      <h3 style={{ marginBottom: 4 }}>Site settings</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Select an asset in the diagram to edit it.</p>
      <div className="section-title">Period</div>
      <div className="field">
        <label htmlFor="start">Start date <Help text="First day of the simulation. Data covers 1 Oct 2025 – 30 Sep 2026 (15-min steps)." source="model year, DECISIONS D-001" /></label>
        <input id="start" type="date" className="btn" style={{ width: '100%' }} min="2025-10-01" max="2026-09-30"
          value={dayToISO(p.period.startDay)}
          onChange={(e) => e.target.value && p.onPeriod({ ...p.period, startDay: Math.min(364, Math.max(0, isoToDay(e.target.value))) })} />
      </div>
      <div className="field">
        <label htmlFor="days">Length <Help text="How long to simulate. Results like the peak charge are pro-rated to the period (peak × €/kW/yr × days/365)." source="example choice" /></label>
        <select id="days" value={p.period.days} onChange={(e) => {
          const days = Number(e.target.value);
          p.onPeriod({ startDay: days >= 365 ? 0 : Math.min(p.period.startDay, 365 - days), days });
        }}>
          <option value={1}>1 day</option>
          <option value={7}>1 week</option>
          <option value={31}>1 month (31 days)</option>
          <option value={365}>Full year (headline)</option>
        </select>
      </div>
      <div className="section-title" style={{ marginTop: 16 }}>Controller</div>
      <div className="field">
        <label htmlFor="ctl">Strategy <Help text="Decides what the battery asks for each 15 minutes. The engine then clips the request to physical and grid limits." source="DECISIONS" guide="ch13" onGuide={p.onGuide} /></label>
        <select id="ctl" value={ctl.type} onChange={(e) => p.onController(e.target.value, {})}>
          {CONTROLLERS.map((c) => <option key={c.type} value={c.type} disabled={!c.available}>{c.label}{c.available ? '' : ' (coming soon)'}</option>)}
        </select>
        <p className="small muted">{ctl.description}</p>
        {p.site.assets.some((a) => a.type === 'ev' || a.type === 'heatpump') ? (
          <p className="small muted">{ctl.type === 'mpc'
            ? 'The planner also decides when the vans charge and when the heat pump runs.'
            : 'Vans and heat pump follow their own rule (select them to change it). Only the MPC plans them together with the battery.'}</p>
        ) : null}
      </div>
      {ctl.params.map((d) => (
        <ParamField key={d.key} decl={d} value={cvals[d.key]} onGuide={p.onGuide}
          onChange={(v) => p.onController(ctl.type, { ...p.site.controller.params, [d.key]: v })} />
      ))}
      <div className="field">
        <label htmlFor="fc">Forecasts <Help text="What the controller may know about the future. Perfect: it knows tomorrow's load, solar and prices exactly (no real controller can). Realistic: tomorrow's prices only after the daily auction (~13:00), load = same time last week, solar = same time yesterday." source="DECISIONS D-018" guide="ch17" onGuide={p.onGuide} /></label>
        <select id="fc" value={p.site.forecast ?? 'perfect'} onChange={(e) => p.onForecast(e.target.value as ForecastMode)}>
          <option value="perfect">Perfect (knows the future)</option>
          <option value="realistic">Realistic (only what is knowable)</option>
        </select>
        {!ctl.usesForecast ? <p className="small muted">This strategy does not look ahead, so forecasts do not change its result.</p> : null}
      </div>
      <div className="hr" />
      <p className="small muted">Every result is compared with the same site and period with the battery idle (the baseline).</p>
    </aside>
  );
}
