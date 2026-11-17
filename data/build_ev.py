"""EV fleet charging sessions for the model year.

Source: Optimise Prime (UK Power Networks, Hitachi, Centrica/British Gas, Royal Mail), WS1 table 06
'bg_fleet_charging': measured charging sessions of British Gas commercial vans. Licence CC BY 4.0
(UK Power Networks Open Data Portal, dataset 'ukpn-optimise-prime').
  https://ukpowernetworks.opendatasoft.com/explore/dataset/ukpn-optimise-prime/
Files are on the portal's public Azure storage (read-only link published on the dataset page); see data/README.md.

What a session gives us: charger id, plug-in time, plug-out time, energy delivered (kWh).
The vans in WS1 charged at the drivers' homes; their pattern (back in the evening, out in the morning,
~23 kWh) is the same pattern a depot sees. We use them as depot visits: LIMITS L-015.

Steps
 1. Keep sessions 1 Jul 2021 - 30 Jun 2022 (one full year), energy 0.1-120 kWh, plugged 0-72 h.
 2. Keep vans (charge points) that cover the whole year with >= 150 sessions.
 3. Map each model-year day to a source day: same month/day, shifted <= 3 days so weekdays match
    (same rule as the loads, DECISIONS D-007). The sessions that START on that source day are copied
    to the target day at the same local clock time. Source clock times are UK local; they are used as
    Berlin local clock times (a fleet's routine follows the local clock).
 4. Steps: arrival = the quarter-hour containing the plug-in time; departure = the quarter-hour
    containing the plug-out time (the van is available until then). Sessions ending after the model
    year are dropped.
Output: app/public/data/ev_fleet_sessions.json  {vehicles, sessions: [[vehicle, arrStep, depStep, kWh]]}
Validation: written to validation.json by validate_all.py (see validate_ev there).
"""
from __future__ import annotations

import glob

import numpy as np
import pandas as pd

from common import AXIS, CACHE, STEP, YEAR_START, write_json

TZ = "Europe/Berlin"
RAW = CACHE / "optimise_prime" / "raw" / "Table06"
WIN = ("2021-07-01", "2022-06-30")


def load_sessions() -> pd.DataFrame:
    df = pd.concat([pd.read_csv(f, sep=";") for f in sorted(glob.glob(str(RAW / "*.csv")))])
    df = df.drop_duplicates("transaction_id")
    df["s"] = pd.to_datetime(df.start_date_time.str[:19])
    df["e"] = pd.to_datetime(df.end_date_time.str[:19])
    df["h"] = (df.e - df.s).dt.total_seconds() / 3600
    return df


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    n0 = len(df)
    w = df[(df.s >= WIN[0]) & (df.s < pd.Timestamp(WIN[1]) + pd.Timedelta(days=1))]
    n1 = len(w)
    w = w[(w.total_kwh > 0.1) & (w.total_kwh < 120) & (w.h > 0) & (w.h <= 72)]
    g = w.groupby("charger_id").agg(n=("s", "size"), first=("s", "min"), last=("s", "max"))
    vans = g[(g["first"] < "2021-08-01") & (g["last"] > "2022-06-01") & (g.n >= 150)].index.sort_values()
    w = w[w.charger_id.isin(vans)].copy()
    info = {"sessionsInFiles": int(n0), "sessionsInWindow": int(n1), "sessionsKept": int(len(w)), "vans": int(len(vans)),
            "rules": "energy 0.1-120 kWh, plugged 0-72 h, vans covering Jul 2021-Jun 2022 with >= 150 sessions"}
    return w, info


def day_map() -> dict:
    """target local date -> source local date (same month/day, weekday-matched, inside the window)."""
    ws, we = pd.Timestamp(WIN[0]).date(), pd.Timestamp(WIN[1]).date()
    out = {}
    for d in sorted(set(AXIS.tz_convert(TZ).date)):
        cand = None
        for y in (ws.year, we.year):
            try:
                c = pd.Timestamp(year=y, month=d.month, day=d.day).date()
            except ValueError:
                c = pd.Timestamp(year=y, month=d.month, day=28).date()
            if ws <= c <= we:
                cand = c
        delta = pd.Timestamp(d).dayofweek - pd.Timestamp(cand).dayofweek
        delta += -7 if delta > 3 else 7 if delta < -3 else 0
        s = (pd.Timestamp(cand) + pd.Timedelta(days=delta)).date()
        if s < ws: s = (pd.Timestamp(s) + pd.Timedelta(days=7)).date()
        if s > we: s = (pd.Timestamp(s) - pd.Timedelta(days=7)).date()
        out[d] = s
    return out


def main():
    df, info = clean(load_sessions())
    vans = {c: i for i, c in enumerate(sorted(df.charger_id.unique()))}
    by_day = {d: g for d, g in df.groupby(df.s.dt.date)}
    dm = day_map()
    rows = []
    for tgt, src in dm.items():
        g = by_day.get(src)
        if g is None:
            continue
        shift = pd.Timestamp(tgt) - pd.Timestamp(src)
        arr = (g.s + shift).dt.tz_localize(TZ, ambiguous=True, nonexistent="shift_forward").dt.tz_convert("UTC")
        dep = (g.e + shift).dt.tz_localize(TZ, ambiguous=True, nonexistent="shift_forward").dt.tz_convert("UTC")
        a = ((arr - YEAR_START) // STEP).astype(int)
        b = ((dep - YEAR_START) // STEP).astype(int)
        for v, ai, bi, kwh in zip(g.charger_id.map(vans), a, b, g.total_kwh):
            if 0 <= ai and bi < len(AXIS) and bi > ai:
                rows.append([int(v), int(ai), int(bi), round(float(kwh), 2)])
    rows.sort(key=lambda r: (r[1], r[0]))
    # one van cannot be plugged twice at once: drop any session that starts before the van's previous one ended
    last_dep: dict[int, int] = {}
    kept = []
    for r in rows:
        if r[1] >= last_dep.get(r[0], -1):
            kept.append(r)
            last_dep[r[0]] = r[2]
    kwh_year = sum(r[3] for r in kept)
    meta = {
        "label": "Commercial van fleet, measured charging sessions",
        "source": "Optimise Prime (UK Power Networks, Hitachi, Centrica/British Gas, Royal Mail), WS1 table 06 bg_fleet_charging",
        "sourceUrl": "https://ukpowernetworks.opendatasoft.com/explore/dataset/ukpn-optimise-prime/",
        "licence": "CC BY 4.0",
        "attribution": "Optimise Prime project data, UK Power Networks Open Data Portal, CC BY 4.0",
        "kind": "measured sessions (plug-in, plug-out, kWh), mapped to the model year by weekday",
        "sourceWindowLocal": list(WIN),
        "cleaning": info,
        "overlapsDropped": len(rows) - len(kept),
        "sessions": len(kept),
        "annualKWhAllVans": round(kwh_year),
        "annualKWhPerVan": round(kwh_year / len(vans)),
        "medianKWh": float(np.median([r[3] for r in kept])),
        "medianPluggedH": float(np.median([(r[2] - r[1]) / 4 for r in kept])),
    }
    write_json("ev_fleet_sessions", {"id": "ev_fleet_sessions", "start": YEAR_START.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                     "stepMinutes": 15, "n": len(AXIS), "vehicles": len(vans), "meta": meta,
                                     "fields": ["vehicle", "arrivalStep", "departureStep", "kWh"], "sessions": kept})
    print({k: meta[k] for k in ("sessions", "annualKWhPerVan", "medianKWh", "medianPluggedH", "overlapsDropped")}, info)


if __name__ == "__main__":
    main()
