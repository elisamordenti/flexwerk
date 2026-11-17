"""Build measured C&I load profiles from Open Power System Data 'household_data'.

Source: OPSD household_data 2020-04-15 (CoSSMic project, Konstanz), CC BY 4.0.
Columns are CUMULATIVE energy meter readings in kWh at 15-minute resolution (UTC).

Method (every step is reported in meta, nothing silently changed):
 1. Differentiate cumulative kWh -> energy per 15 min -> average kW (x4).
    Negative differences (meter reset/glitch) are set to missing.
 2. The site meters measure NET grid import; each site also has rooftop PV and no
    export meter. Gross consumption = grid import + PV generation, valid only if the
    site never exported. We test that: count quarter-hours where PV > 0 while grid
    import ~ 0 (the only situation in which export could hide). Reported as 'possibleExportSteps'.
 3. Choose one full source year with complete main-meter data.
 4. Map source days onto the model year (Oct 2025 - Sep 2026) by calendar date,
    shifted by up to +-3 days so weekdays match (Mon->Mon). Same local clock time.
    Public holidays are NOT matched (see LIMITS.md).
 5. Remaining gaps are filled with the same quarter-hour one week earlier, counted
    in meta.filledSteps. The OPSD file's own 'interpolated' flags are counted too.
Output keeps real kW magnitudes; the engine scales to the user's annual consumption.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from common import AXIS, CACHE, write_series

SRC = CACHE / "opsd" / "household_data_15min_singleindex.csv"
TZ = "Europe/Berlin"

SITES = {
    # profile id: (description, main columns to add for gross load, PV columns, source window start/end local)
    "load_warehouse": dict(
        site="DE_KN_industrial1",
        label="Warehouse (logistics), Konstanz",
        load_cols=["grid_import"],
        pv_cols=["pv_1", "pv_2"],
        window=("2016-10-01", "2017-09-30"),
    ),
    "load_factory": dict(
        site="DE_KN_industrial3",
        label="Industrial building with machines, cooling and offices (research institute), Konstanz",
        load_cols=["grid_import"],
        pv_cols=["pv_facade", "pv_roof"],
        window=("2016-06-01", "2017-05-31"),
    ),
}
COLD_SUBMETERS = ["cooling_aggregate", "cooling_pumps", "compressor", "refrigerator"]


def read_opsd() -> pd.DataFrame:
    df = pd.read_csv(SRC, parse_dates=["utc_timestamp"], low_memory=False)
    return df.set_index("utc_timestamp")


def to_kw(cum: pd.Series) -> tuple[pd.Series, int]:
    d = cum.diff()
    bad = int((d < -1e-9).sum())
    d[d < -1e-9] = np.nan
    return d * 4.0, bad   # kWh per 15 min -> kW


def interpolated_count(df: pd.DataFrame, col: str, start, end) -> int:
    s = df.loc[start:end, "interpolated"].dropna().astype(str)
    return int(s.str.contains(col, regex=False).sum())


def map_to_model_year(src_kw: pd.Series, win_start: str, win_end: str) -> tuple[pd.Series, dict]:
    """Return a series on AXIS taken from src (UTC-indexed kW), matching weekday and local clock time."""
    local = src_kw.tz_convert(TZ)
    ws, we = pd.Timestamp(win_start).date(), pd.Timestamp(win_end).date()
    # lookup (date, hour, minute) -> value; first occurrence wins on the autumn DST hour
    keys = list(zip(local.index.date, local.index.hour, local.index.minute))
    lookup: dict = {}
    for k, v in zip(keys, local.values):
        lookup.setdefault(k, v)

    tgt_local = AXIS.tz_convert(TZ)
    day_map: dict = {}
    out = np.full(len(AXIS), np.nan)
    shifts = []
    for i, t in enumerate(tgt_local):
        d = t.date()
        if d not in day_map:
            # same month/day inside the source window
            cand = None
            for y in (ws.year, we.year):
                try:
                    c = pd.Timestamp(year=y, month=d.month, day=min(d.day, 28) if (d.month == 2 and d.day == 29) else d.day).date()
                except ValueError:
                    continue
                if ws <= c <= we:
                    cand = c
            delta = (t.dayofweek - pd.Timestamp(cand).dayofweek)
            if delta > 3:
                delta -= 7
            if delta < -3:
                delta += 7
            s = (pd.Timestamp(cand) + pd.Timedelta(days=delta)).date()
            if s < ws:
                s = (pd.Timestamp(s) + pd.Timedelta(days=7)).date()
            if s > we:
                s = (pd.Timestamp(s) - pd.Timedelta(days=7)).date()
            day_map[d] = s
            shifts.append(abs(delta))
        s = day_map[d]
        v = lookup.get((s, t.hour, t.minute))
        if v is None:  # clock time absent on a spring-forward source day -> take one hour later
            v = lookup.get((s, (t.hour + 1) % 24, t.minute))
        out[i] = np.nan if v is None else v
    res = pd.Series(out, index=AXIS)
    # fill remaining gaps with the same quarter-hour one week earlier (then later)
    missing_before = int(res.isna().sum())
    for lag in (672, -672, 1344, -1344):
        res = res.fillna(res.shift(lag))
    info = {
        "sourceWindowLocal": [win_start, win_end],
        "weekdayShiftDaysMax": int(max(shifts)),
        "weekdayShiftDaysMean": round(float(np.mean(shifts)), 2),
        "filledSteps": missing_before,
        "unfilledSteps": int(res.isna().sum()),
    }
    return res, info


def gross_load(df, site, load_cols, pv_cols):
    parts, resets = [], 0
    for c in load_cols:
        kw, bad = to_kw(df[f"{site}_{c}"]); parts.append(kw); resets += bad
    imp = sum(parts)
    pv = 0
    for c in pv_cols:
        kw, bad = to_kw(df[f"{site}_{c}"]); pv = pv + kw.fillna(0); resets += bad
    possible_export = int(((pv > 0.5) & (imp < 0.05)).sum())  # PV producing while import ~0
    return imp + pv, imp, pv, resets, possible_export


def main():
    df = read_opsd()
    results = {}
    for pid, cfg in SITES.items():
        site = cfg["site"]
        load, imp, pv, resets, possible_export = gross_load(df, site, cfg["load_cols"], cfg["pv_cols"])
        ws, we = cfg["window"]
        w_utc = slice(pd.Timestamp(ws, tz=TZ).tz_convert("UTC"), (pd.Timestamp(we, tz=TZ) + pd.Timedelta(days=1)).tz_convert("UTC"))
        win = load.loc[w_utc]
        src_missing = int(win.isna().sum())
        mapped, info = map_to_model_year(load, ws, we)
        annual_kwh = float(mapped.sum() / 4)
        peak = float(mapped.max())
        meta = {
            "label": cfg["label"],
            "source": "Open Power System Data, household_data 2020-04-15 (CoSSMic, ISC Konstanz)",
            "sourceUrl": "https://data.open-power-system-data.org/household_data/2020-04-15/",
            "licence": "CC BY 4.0",
            "kind": "measured shape (net import + on-site PV), mapped to model year; scale in engine",
            "nativeResolutionMin": 15,
            "opsdColumns": [f"{site}_{c}" for c in cfg["load_cols"] + cfg["pv_cols"]],
            "annualKWh": round(annual_kwh),
            "peakKW": round(peak, 1),
            "fullLoadHours": round(annual_kwh / peak),
            "pvShareOfLoad": round(float(pv.loc[w_utc].sum() / win.sum()), 4),
            "meterResets": resets,
            "possibleExportSteps": possible_export,
            "sourceMissingStepsInWindow": src_missing,
            "opsdInterpolatedFlagsInWindow": interpolated_count(df, f"{site}_grid_import", w_utc.start, w_utc.stop),
            **info,
        }
        write_series(pid, mapped.values, "kW", meta, decimals=2)
        results[pid] = meta

    # Cold-storage proxy: refrigeration sub-meters of industrial3 only (modelled, not a real cold store)
    site = "DE_KN_industrial3"
    parts = [to_kw(df[f"{site}_{c}"])[0] for c in COLD_SUBMETERS]
    cold = sum(p.fillna(0) for p in parts)
    cold[parts[0].isna()] = np.nan
    mapped, info = map_to_model_year(cold, "2016-06-01", "2017-05-31")
    annual_kwh = float(mapped.sum() / 4); peak = float(mapped.max())
    meta = {
        "label": "Refrigeration loads only (cooling aggregate, pumps, compressor, fridge) of an industrial building, Konstanz",
        "source": "Open Power System Data, household_data 2020-04-15 (CoSSMic, ISC Konstanz)",
        "sourceUrl": "https://data.open-power-system-data.org/household_data/2020-04-15/",
        "licence": "CC BY 4.0",
        "kind": "MODELLED from measured sub-meters: a proxy for a cold-storage shape, not a measured cold store",
        "nativeResolutionMin": 15,
        "opsdColumns": [f"{site}_{c}" for c in COLD_SUBMETERS],
        "annualKWh": round(annual_kwh), "peakKW": round(peak, 1), "fullLoadHours": round(annual_kwh / peak),
        **info,
    }
    write_series("load_cold_storage", mapped.values, "kW", meta, decimals=2)
    results["load_cold_storage"] = meta

    for k, m in results.items():
        print(k, {x: m[x] for x in ("annualKWh", "peakKW", "fullLoadHours", "filledSteps", "unfilledSteps") if x in m},
              "possibleExport", m.get("possibleExportSteps"))


if __name__ == "__main__":
    main()
