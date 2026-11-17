import { useState } from 'react';
import type { AppData } from '../data';

type Badge = 'Measured' | 'Modelled' | 'Official rule' | 'Datasheet';

/** One card per source, in plain words. Facts below are taken from the data files' own metadata and SOURCES.md. */
interface Card {
  title: string; org: string; badge: Badge; what: string; usedFor: string;
  resolution: string; period: string; licence: string; warn?: string; cite: string; url: string;
  seriesKeys?: string[]; validation?: string[];
}

const CARDS: Card[] = [
  {
    title: 'Wholesale electricity prices, Germany', org: 'Bundesnetzagentur | SMARD.de, via Energy-Charts (Fraunhofer ISE)', badge: 'Measured',
    what: 'The day-ahead market price for every quarter-hour: what electricity costs on the exchange, set the day before in a daily auction.',
    usedFor: 'Energy part of the bill; value of exported solar', resolution: '15 min (native)', period: 'Oct 2025 – Sep 2026', licence: 'CC BY 4.0',
    cite: 'Bundesnetzagentur | SMARD.de, day-ahead prices DE-LU, retrieved via api.energy-charts.info.', url: 'https://api.energy-charts.info/',
    seriesKeys: ['price_da'], validation: ['prices'],
  },
  {
    title: 'Measured industrial buildings, Germany', org: 'Open Power System Data (CoSSMic project, Konstanz)', badge: 'Measured',
    what: 'Real meter readings from a warehouse and an industrial building with machines, cooling and offices.',
    usedFor: 'Factory and warehouse loads', resolution: '15 min', period: '2016–2017, mapped to the model year by weekday', licence: 'CC BY 4.0',
    warn: 'Small sites (65–220 kW) scaled up to the size you choose. Larger real sites are usually smoother, so peaks here may look sharper.',
    cite: 'Open Power System Data. 2020. Data Package Household Data, version 2020-04-15. https://doi.org/10.25832/household_data/2020-04-15', url: 'https://doi.org/10.25832/household_data/2020-04-15',
    seriesKeys: ['load_factory', 'load_warehouse'], validation: ['load'],
  },
  {
    title: 'Cold-storage load (proxy)', org: 'Built from Open Power System Data sub-meters', badge: 'Modelled',
    what: 'The refrigeration meters (cooling unit, pumps, compressor, fridge) of the same industrial building, added together.',
    usedFor: 'Cold-storage load', resolution: '15 min', period: '2016–2017, mapped by weekday', licence: 'CC BY 4.0',
    warn: 'Not measured at a real cold store. It shows the shape of refrigeration load, not a full site.',
    cite: 'Open Power System Data. 2020. Data Package Household Data, version 2020-04-15.', url: 'https://doi.org/10.25832/household_data/2020-04-15',
    seriesKeys: ['load_cold_storage'],
  },
  {
    title: 'Solar output, Leipzig', org: 'DWD Climate Data Center + our own PV model', badge: 'Modelled',
    what: 'Measured sunlight at the Leipzig/Halle weather station, turned into panel output with standard published solar models.',
    usedFor: 'Solar generation (south 30° and east-west roofs)', resolution: '10 min, averaged to 15 min', period: 'Oct 2025 – Sep 2026', licence: 'CC BY 4.0 (DWD); model code MIT',
    warn: 'Reads 3–5 % above the EU PVGIS tool on the same years. Use the derate setting on a solar asset to correct it if you prefer.',
    cite: 'Deutscher Wetterdienst, Climate Data Center, 10-min solar observations, station 02932 Leipzig/Halle.', url: 'https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes/solar/',
    seriesKeys: ['pv_south30', 'pv_eastwest15'], validation: ['pv'],
  },
  {
    title: 'Grid fees and levies 2026', org: 'Netz Leipzig GmbH (one example grid operator) + federal law', badge: 'Official rule',
    what: 'How a German business bill is built: a price per kWh, a yearly price per kW of the highest quarter-hour, and fixed levies and taxes.',
    usedFor: 'The bill and every saving shown', resolution: 'Yearly price sheet', period: 'Valid from 1 Jan 2026', licence: 'Public price sheet and laws (facts cited)',
    warn: 'One grid operator only. A 2029 reform (BNetzA "AgNes") may replace the yearly peak price.',
    cite: 'Netz Leipzig GmbH, Preisblatt Netznutzungsentgelte Strom 2026 (final), p. 2–3.', url: 'https://files.l.de/lde-typo3/Netz/Downloads/Netznutzung/Strom/Netz_Leipzig_Preisblatt_NNE_Strom_2026_final.pdf',
    validation: ['tariff'],
  },
  {
    title: 'Electric van fleet, UK', org: 'Optimise Prime trial (UK Power Networks, Hitachi, Centrica/British Gas, Royal Mail)', badge: 'Measured',
    what: 'Real charging sessions of 156 commercial vans over a year: when each van plugged in, when it left, and how much energy it took.',
    usedFor: 'EV fleet chargers', resolution: 'Per session (minutes)', period: 'Jul 2021 – Jun 2022, mapped to the model year by weekday', licence: 'CC BY 4.0',
    warn: 'These vans charged at the drivers’ homes; we use them as depot visits. The daily pattern matches measured Royal Mail depots (peak 20:00 vs 19:00).',
    cite: 'Optimise Prime project data, UK Power Networks Open Data Portal (dataset ukpn-optimise-prime), WS1 table 06 and WS2 table 32.',
    url: 'https://ukpowernetworks.opendatasoft.com/explore/dataset/ukpn-optimise-prime/', validation: ['ev'],
  },
  {
    title: 'Heat demand and heat-pump efficiency', org: 'Heating degree days (VDI 3807) and When2Heat efficiency curve on DWD Leipzig temperatures', badge: 'Modelled',
    what: 'How much heat a commercial building needs each hour (from how cold it is: the standard degree-day rule) and how efficiently an air-source heat pump makes it, from outdoor temperature.',
    usedFor: 'Heat pump', resolution: '1 h, held for 15 min', period: 'Oct 2025 – Sep 2026', licence: 'DWD data CC BY 4.0; method code MIT',
    warn: 'Temperature only: no opening hours or weekends, not a measured building. Our yearly efficiency (2.88 radiators, 3.36 floor heating) sits in the range Fraunhofer ISE measured in the field (2.6–4.9, mean 3.4).',
    cite: 'Ruhnau, Hirth & Praktiknjo (2019), Time series of heat demand and heat pump efficiency for energy system modeling, Scientific Data 6:189.',
    url: 'https://github.com/oruhnau/when2heat', validation: ['heat'],
  },
  {
    title: 'Battery defaults', org: 'FoxESS datasheet + Fraunhofer ISE cost study', badge: 'Datasheet',
    what: 'One real commercial battery cabinet: 215 kWh, 100 kW, round-trip efficiency 89 %. Cost from a published price range.',
    usedFor: 'Default battery size, losses and cost', resolution: '–', period: 'Datasheet V1.6 (2026); ISE 2024', licence: 'Cited facts only',
    warn: 'Cost is the midpoint of 450–800 €/kWh from 2024. Real quotes in 2026 may be lower.',
    cite: 'FoxESS T-MAX TM215kWh-100kW-2hF datasheet V1.6; Kost et al., Fraunhofer ISE, Levelized Cost of Electricity 2024, p. 20.', url: 'https://www.fox-ess.com/Public/Uploads/uploadfile/files/20260710/ENTMAXDatasheetV1.620260615.pdf',
    validation: ['battery'],
  },
];

/** Every source, how much to trust it, and every validation check: nothing hidden. */
export function DataPanel({ data, onClose }: { data: AppData; onClose: () => void }) {
  const v = data.validation;
  const [showChecks, setShowChecks] = useState(false);
  const checksFor = (groups?: string[]) => (groups ?? []).flatMap((g) => v.results[g] ?? []);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog wide" role="dialog" aria-label="Where the data comes from" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <div>
            <h2>Where the data comes from</h2>
            <p className="muted">A simulation is only as good as its inputs. These are the sources behind every number, how much to trust each one, and its licence.</p>
          </div>
          <button className="btn ghost" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="label-caps">Sources</div>
        <div className="src-grid">
          {CARDS.map((c) => {
            const ch = checksFor(c.validation);
            const scored = ch.filter((r) => r.status !== 'info');
            const passed = scored.filter((r) => r.status === 'pass').length;
            const info = ch.length - scored.length;
            return (
              <article key={c.title} className="src-card">
                <div className="src-top"><h3>{c.title}</h3><span className={`srcbadge b-${c.badge.split(' ')[0].toLowerCase()}`}>{c.badge}</span></div>
                <div className="small muted">{c.org}</div>
                <p>{c.what}</p>
                <dl>
                  <div><dt>Used for</dt><dd>{c.usedFor}</dd></div>
                  <div><dt>Resolution</dt><dd>{c.resolution}</dd></div>
                  <div><dt>Period</dt><dd>{c.period}</dd></div>
                  <div><dt>Licence</dt><dd>{c.licence}</dd></div>
                </dl>
                {c.warn ? <p className="warn">⚠ {c.warn}</p> : null}
                {ch.length ? <p className="small"><span style={{ color: 'var(--good)', fontWeight: 600 }}>✓ {passed} of {scored.length} checks passed</span> against independent references{info ? ` · ${info} for information` : ''}</p> : null}
                <p className="cite">{c.cite}</p>
                <a href={c.url} target="_blank" rel="noreferrer">Open source ↗</a>
              </article>
            );
          })}
        </div>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => setShowChecks((s) => !s)}>
          {showChecks ? 'Hide' : 'Show'} all {v.summary.pass + v.summary.flag + v.summary.fail + v.summary.info} validation checks
        </button>
        {showChecks ? (
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Status</th><th>Check</th><th>Ours</th><th>Reference</th><th>Note</th></tr></thead>
            <tbody>
              {Object.values(v.results).flat().map((r, i) => (
                <tr key={i}>
                  <td><span className={`status ${String(r.status)}`}>{String(r.status)}</span></td>
                  <td>{String(r.check)}<div className="small muted">{String(r.compared ?? '')}</div></td>
                  <td className="num">{r.ours !== undefined ? `${r.ours} ${r.unit ?? ''}` : r.weekendToWeekday !== undefined ? `weekend/weekday ${r.weekendToWeekday}` : ''}</td>
                  <td className="num">{r.reference !== undefined ? `${r.reference}${r.diffPct !== undefined ? ` (${Number(r.diffPct) > 0 ? '+' : ''}${r.diffPct} %)` : ''}` : ''}</td>
                  <td className="small">{String(r.note ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
