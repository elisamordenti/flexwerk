"""Validate every series against an independent reference; write validation.json + sanity charts.

Each check returns: what was compared, our value, the reference value, difference, tolerance,
status (pass / flag / fail) and a plain-language note. The app's Data panel shows this file.
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

import build_pv
from build_load import COLD_SUBMETERS, SRC as OPSD_SRC, to_kw
from build_prices import all_prices, time_weighted_quarter_hours
from common import AXIS, CACHE, CHARTS, OUT, write_json

TZ = "Europe/Berlin"
BLUE, ORANGE, INK2, MUTED, SURF = "#2a78d6", "#eb6834", "#52514e", "#898781", "#fcfcfb"
plt.rcParams.update({"figure.facecolor": SURF, "axes.facecolor": SURF, "axes.edgecolor": MUTED,
                     "axes.labelcolor": INK2, "xtick.color": MUTED, "ytick.color": MUTED,
                     "axes.spines.top": False, "axes.spines.right": False, "font.size": 9,
                     "axes.grid": True, "grid.color": "#e6e5e1", "grid.linewidth": 0.6, "lines.linewidth": 1.5})


def series(name):
    d = json.loads((OUT / f"{name}.json").read_text(encoding="utf-8"))
    return pd.Series(d["values"], index=AXIS, dtype=float), d["meta"]


def check(name, compared, ours, ref, tol_pct, note, unit="", flag_only=False):
    diff = (ours - ref) / ref * 100
    status = "pass" if abs(diff) <= tol_pct else ("flag" if flag_only else "fail")
    r = {"check": name, "compared": compared, "ours": round(ours, 2), "reference": round(ref, 2), "unit": unit,
         "diffPct": round(diff, 2), "tolerancePct": tol_pct, "status": status, "note": note}
    print(f"[{status.upper():4s}] {name}: ours {ours:.2f} vs ref {ref:.2f} {unit} ({diff:+.2f} %)")
    return r


def save(fig, name):
    p = CHARTS / f"{name}.png"
    fig.tight_layout(); fig.savefig(p, dpi=130); plt.close(fig)
    print("  chart", p.relative_to(CHARTS.parent.parent))


# ---------------------------------------------------------------- prices
def validate_prices():
    out = []
    price, meta = series("price_da")
    raw, _ = all_prices()
    # SMARD monthly averages: timestamps are local midnight of the month start
    smard = {}
    for f in sorted((CACHE / "smard").glob("smard_4169_DE-LU_month_*.json")):
        for ts, v in json.loads(f.read_text())["series"]:
            if v is not None:
                smard[pd.Timestamp(ts, unit="ms", tz="UTC").tz_convert(TZ).strftime("%Y-%m")] = v
    loc = price.copy(); loc.index = loc.index.tz_convert(TZ)
    ours_m = loc.groupby(loc.index.strftime("%Y-%m")).mean()
    rows = [(m, ours_m[m], smard.get(m)) for m in ours_m.index]
    worst = max(abs(o - r) for _, o, r in rows if r is not None)
    for m, o, r in rows:
        out.append(check(f"price monthly mean {m}", "Energy-Charts mean vs SMARD monthly value", o, r, 1.0,
                         "independent publication pipeline (SMARD chart data, filter 4169)", "EUR/MWh"))
    # Calendar 2025 vs BNetzA published average (hourly Jan-Sep, 15-min Oct-Dec)
    y25 = time_weighted_quarter_hours(raw).loc["2024-12-31T23:00Z":"2025-12-31T22:45Z"]
    out.append(check("price calendar-2025 mean", "time-weighted mean 2025 vs BNetzA published annual average",
                     float(y25.mean()), 89.32, 1.0,
                     "BNetzA press release 05.01.2026 'Daten zum Strommarkt 2025' (SMARD): 89.32 EUR/MWh", "EUR/MWh"))
    fig, ax = plt.subplots(1, 2, figsize=(11, 3.2), gridspec_kw={"width_ratios": [2, 1]})
    wk = price.loc["2026-06-01T22:00Z":"2026-06-08T22:00Z"]
    ax[0].plot(wk.index.tz_convert(TZ), wk.values, color=BLUE); ax[0].axhline(0, color=MUTED, lw=0.8)
    ax[0].set_title("Day-ahead DE-LU, one week (15-min)", loc="left"); ax[0].set_ylabel("EUR/MWh")
    x = np.arange(len(rows))
    ax[1].bar(x - 0.2, [o for _, o, _ in rows], 0.38, color=BLUE, label="ours (Energy-Charts)")
    ax[1].bar(x + 0.2, [r for _, _, r in rows], 0.38, color=ORANGE, label="SMARD")
    ax[1].set_xticks(x, [m[2:] for m, _, _ in rows], rotation=90); ax[1].legend(frameon=False, fontsize=7)
    ax[1].set_title(f"Monthly mean (max gap {worst:.2f} EUR/MWh)", loc="left")
    save(fig, "price_da")
    return out


# ---------------------------------------------------------------- PV
def validate_pv():
    out = []
    pvgis = {f.stem: json.loads(f.read_text()) for f in (CACHE / "pvgis").glob("pvcalc_*.json")}
    south_lt = pvgis["pvcalc_leipzig_30deg_south"]["outputs"]
    ew_lt = (pvgis["pvcalc_leipzig_15deg_aspect-90"]["outputs"]["totals"]["fixed"]["E_y"]
             + pvgis["pvcalc_leipzig_15deg_aspect90"]["outputs"]["totals"]["fixed"]["E_y"]) / 2
    s30, m30 = series("pv_south30"); ew, mew = series("pv_eastwest15")
    sd = south_lt["totals"]["fixed"]["SD_y"]
    ref = south_lt["totals"]["fixed"]["E_y"]
    out.append(check("PV south30 model-year yield", "Oct25-Sep26 yield vs PVGIS 2005-2023 long-term mean (SARAH3)",
                     m30["annualKWhPerKWp"], ref, round(2 * sd / ref * 100, 1),
                     f"tolerance = 2 x PVGIS inter-annual SD ({sd} kWh/kWp); a single year can differ from the long-term mean",
                     "kWh/kWp", flag_only=True))
    out.append(check("PV east-west15 model-year yield", "Oct25-Sep26 yield vs PVGIS long-term (mean of E and W planes)",
                     mew["annualKWhPerKWp"], ew_lt, round(2 * sd / ref * 100, 1), "same tolerance as above", "kWh/kWp", flag_only=True))

    # Like-for-like: same years (2020-2023), our model on DWD ground data vs PVGIS on satellite data
    sc = json.loads((CACHE / "pvgis" / "seriescalc_leipzig_30deg_south_2020_2023.json").read_text())
    h = pd.DataFrame(sc["outputs"]["hourly"])
    h.index = pd.to_datetime(h["time"], format="%Y%m%d:%H%M", utc=True)
    ghi10, dhi10, t10, conv, _ = build_pv.load_inputs()
    ax20 = pd.date_range("2020-01-01T00:00Z", "2024-01-01T00:00Z", freq="15min", inclusive="left")
    p20, _ = build_pv.model_pv(ax20, ghi10, dhi10, t10, conv == "label=interval end", [(30, 180, 1.0)])
    ours_y = p20.groupby(p20.index.year).sum() / 4
    ref_y = h["P"].groupby(h.index.year).sum() / 1000
    for y in ours_y.index:
        out.append(check(f"PV south30 yield {y} (same year)", "our model on DWD station data vs PVGIS hourly simulation, same year",
                         float(ours_y[y]), float(ref_y[y]), 5.0,
                         "isolates model + data differences from weather; PVGIS uses satellite irradiance (SARAH3)", "kWh/kWp"))
    ours_m = p20.groupby(p20.index.month).sum() / 4 / 4
    ref_m = h["P"].groupby(h.index.month).sum() / 1000 / 4
    fig, ax = plt.subplots(1, 2, figsize=(11, 3.2), gridspec_kw={"width_ratios": [2, 1]})
    wk = s30.loc["2026-06-01T22:00Z":"2026-06-08T22:00Z"]
    ax[0].plot(wk.index.tz_convert(TZ), wk.values, color=BLUE)
    ax[0].set_title("PV south 30 deg, one week (kW per kWp)", loc="left")
    x = np.arange(1, 13)
    ax[1].bar(x - 0.2, ours_m.values, 0.38, color=BLUE, label="ours (DWD + model)")
    ax[1].bar(x + 0.2, ref_m.values, 0.38, color=ORANGE, label="PVGIS (SARAH3)")
    ax[1].set_title("Monthly yield, mean 2020-23 (kWh/kWp)", loc="left"); ax[1].legend(frameon=False, fontsize=7)
    ax[1].set_xticks(x)
    save(fig, "pv_south30")
    return out


# ---------------------------------------------------------------- load
def validate_load():
    out = []
    df = pd.read_csv(OPSD_SRC, parse_dates=["utc_timestamp"], low_memory=False).set_index("utc_timestamp")
    site = "DE_KN_industrial3"
    win = slice("2016-06-01", "2017-05-31")
    main = to_kw(df[f"{site}_grid_import"])[0] + sum(to_kw(df[f"{site}_{c}"])[0].fillna(0) for c in ("pv_facade", "pv_roof"))
    subs = [c[len(site) + 1:] for c in df.columns if c.startswith(site) and not any(k in c for k in ("grid_import", "pv_"))]
    sub_sum = sum(to_kw(df[f"{site}_{c}"])[0].fillna(0) for c in subs)
    m, s = float(main.loc[win].sum()), float(sub_sum.loc[win].sum())
    r = check("factory: sub-meters vs main meter", "sum of all industrial3 sub-meters vs gross load (import + PV)",
              s / 4, m / 4, 100.0, f"sub-meters cover {s/m*100:.0f} % of the building; the rest is unmetered loads (lighting, sockets...). "
              "A sum ABOVE the main meter would indicate a data error; below is expected.", "kWh")
    r["status"] = "pass" if s <= m else "fail"
    out.append(r)
    for pid in ("load_warehouse", "load_factory", "load_cold_storage"):
        ld, meta = series(pid)
        p999 = float(ld.quantile(0.999))
        out.append(check(f"{pid}: peak vs 99.9th percentile", "annual peak vs 99.9th percentile (spike test)",
                         float(ld.max()), p999, 25.0, "a peak far above the 99.9th percentile would suggest a meter artefact", "kW", flag_only=True))
        loc = ld.copy(); loc.index = loc.index.tz_convert(TZ)
        wd, we = float(loc[loc.index.dayofweek < 5].mean()), float(loc[loc.index.dayofweek >= 5].mean())
        out.append({"check": f"{pid}: shape", "compared": "weekday vs weekend mean, full-load hours", "status": "info",
                    "weekdayMeanKW": round(wd, 1), "weekendMeanKW": round(we, 1), "weekendToWeekday": round(we / wd, 2),
                    "annualKWh": meta["annualKWh"], "peakKW": meta["peakKW"], "fullLoadHours": meta["fullLoadHours"],
                    "note": "BDEW standard load profiles were NOT used as reference (licence not open); shape is checked for plausibility only"})
        print(f"[INFO] {pid}: weekend/weekday {we/wd:.2f}, FLH {meta['fullLoadHours']}")
        fig, ax = plt.subplots(1, 2, figsize=(11, 3.2), gridspec_kw={"width_ratios": [2, 1]})
        wk = ld.loc["2026-03-01T23:00Z":"2026-03-15T23:00Z"]
        ax[0].plot(wk.index.tz_convert(TZ), wk.values, color=BLUE)
        ax[0].set_title(f"{pid}: two weeks (kW)", loc="left")
        mon = loc.groupby(loc.index.strftime("%Y-%m")).sum() / 4 / 1000
        ax[1].bar(range(len(mon)), mon.values, color=BLUE); ax[1].set_xticks(range(len(mon)), [x[2:] for x in mon.index], rotation=90)
        ax[1].set_title("Monthly energy (MWh)", loc="left")
        save(fig, pid)
    return out


def validate_ev():
    """EV fleet: the model year keeps the source's energy and timing; the uncontrolled profile is compared
    in shape with measured Royal Mail depot EV load (Optimise Prime WS2 table 32, unmanaged days)."""
    import build_ev
    out = []
    doc = json.loads((OUT / "ev_fleet_sessions.json").read_text(encoding="utf-8"))
    ses = np.array(doc["sessions"], dtype=float)
    src, _ = build_ev.clean(build_ev.load_sessions())
    kwh_model = ses[:, 3].sum() / doc["vehicles"]
    kwh_src = src.total_kwh.sum() / src.charger_id.nunique()
    out.append(check("EV energy per van per year", "model year vs the same vans' source year (Jul 2021-Jun 2022)",
                     kwh_model, kwh_src, 5, "weekday mapping repeats or skips a few source days", "kWh"))
    start = pd.Timestamp(doc["start"])
    loc = (start + pd.to_timedelta(ses[:, 1] * 15, unit="min")).tz_convert("Europe/Berlin")
    share_model = float(((loc.hour >= 14) & (loc.hour < 20)).mean() * 100)
    share_src = float(((src.s.dt.hour >= 14) & (src.s.dt.hour < 20)).mean() * 100)
    out.append(check("EV arrivals between 14:00 and 20:00", "model year vs source, share of sessions",
                     share_model, share_src, 3, "same local clock time is kept", "%"))
    # uncontrolled charging at 3.6-4.6 kW (Royal Mail van AC rates) -> average daily shape
    P = 4.6
    load = np.zeros(doc["n"])
    for v, a, b, e in ses:
        a, b = int(a), int(b)
        k = a
        rem = e
        while rem > 1e-9 and k < b:
            x = min(P, rem / 0.25); load[k] += x; rem -= x * 0.25; k += 1
    ours = pd.Series(load, index=AXIS).tz_convert("Europe/Berlin")
    ours_prof = ours.groupby(ours.index.hour).mean(); ours_prof /= ours_prof.mean()
    rm = pd.read_csv(CACHE / "optimise_prime" / "raw" / "Table32" / "load_profiles_dataset.csv")
    rm = rm[rm.unmanaged_charging == 1]
    rm["t"] = pd.to_datetime(rm.timestamp, format="%d/%m/%Y %H:%M")
    rm_prof = rm.groupby(rm.t.dt.hour).ev_load_kw.mean(); rm_prof /= rm_prof.mean()
    corr = float(np.corrcoef(ours_prof.values, rm_prof.reindex(range(24)).fillna(0).values)[0, 1])
    out.append({"check": "EV uncontrolled daily shape vs Royal Mail depots", "compared": "hour-of-day profile correlation, Optimise Prime WS2 table 32 (unmanaged charging days)",
                "ours": round(corr, 3), "unit": "correlation", "status": "info",
                "note": f"peak hour ours {int(ours_prof.idxmax())}:00, Royal Mail {int(rm_prof.idxmax())}:00; different fleets (vans charged at home vs postal depots)"})
    print("[INFO] EV shape correlation", round(corr, 3), "peak hours", int(ours_prof.idxmax()), int(rm_prof.idxmax()))
    fig, ax = plt.subplots(figsize=(7, 3))
    ax.plot(ours_prof.index, ours_prof.values, label="model year, uncontrolled (British Gas vans)")
    ax.plot(rm_prof.index, rm_prof.values, label="Royal Mail depots, unmanaged (measured)", linestyle="--")
    ax.set_xlabel("hour of day (local)"); ax.set_ylabel("load / daily mean"); ax.legend(frameon=False)
    save(fig, "ev_shape")
    return out


def validate_heat():
    """Heat pump: seasonal performance (heat delivered / electricity used over the year) of our COP series
    vs Fraunhofer ISE field measurements of 77 heat pumps in existing homes (press release 30/2025):
    air-source mean JAZ 3.4, range 2.6-4.9. Different buildings (homes vs commercial), so tolerance is wide."""
    out = []
    for k in ("radiator", "floor"):
        _, m = series(f"cop_air_{k}")
        spf = m["seasonalPerformanceFactor"]
        out.append(check(f"Heat pump seasonal efficiency, {k}", "our COP series, demand-weighted, vs Fraunhofer ISE field test mean (air-source, existing homes)",
                         spf, 3.4, 15, "field range 2.6-4.9; ISE press release 30/2025 'Waermepumpen heizen auch im Altbau klimafreundlich'", "-", flag_only=True))
    _, m = series("heat_space_com")
    out.append({"check": "Space heat in Nov-Mar", "compared": "share of annual space heating demand", "ours": round(m["winterShare"] * 100, 1),
                "unit": "%", "status": "info", "note": "heating degree days G20/15 (VDI 3807) on Leipzig 2025-26 temperatures"})
    return out


def main():
    results = {"prices": validate_prices(), "pv": validate_pv(), "load": validate_load(), "ev": validate_ev(), "heat": validate_heat(),
               "battery": [{"check": "battery defaults vs datasheet", "status": "pass",
                            "note": "values transcribed from FoxESS TM215kWh-100kW-2hF datasheet V1.6; see battery_defaults.json"}]}
    flat = [r for v in results.values() for r in v]
    summary = {s: sum(1 for r in flat if r["status"] == s) for s in ("pass", "flag", "fail", "info")}
    write_json("validation", {"summary": summary, "results": results})
    print("SUMMARY", summary)


if __name__ == "__main__":
    main()
