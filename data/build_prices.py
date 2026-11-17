"""Build the DE-LU day-ahead price series on the model axis (Oct 2025 - Sep 2026, 15 min).

Input: cached Energy-Charts monthly files (see fetch_prices.py). Native resolution in the
model year is 15 min (SDAC 15-min MTU live since delivery day 1 Oct 2025), so NO resampling.
Also writes a calendar-2025 series summary used only for validation (Jan-Sep 2025 hourly).
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from common import AXIS, CACHE, write_series


def load_month(y: int, m: int) -> tuple[pd.Series, str, str]:
    doc = json.loads((CACHE / "prices" / f"energy_charts_DE-LU_{y}-{m:02d}.json").read_text(encoding="utf-8"))
    ts = pd.to_datetime([d["timestamp"] for d in doc["data"]], utc=True)
    vals = [d["values"].get("day_ahead_price") for d in doc["data"]]
    return pd.Series(vals, index=ts, dtype=float), doc["resolution"], doc["license"]


def all_prices() -> tuple[pd.Series, dict]:
    parts, res, lic = [], {}, set()
    for y, m in [(2025, m) for m in range(1, 13)] + [(2026, m) for m in range(1, 10)]:
        s, r, l = load_month(y, m)
        parts.append(s); res[f"{y}-{m:02d}"] = r; lic.add(l)
    s = pd.concat(parts)
    s = s[~s.index.duplicated()].sort_index()
    return s, {"resolutionByMonth": res, "licences": sorted(lic)}


def time_weighted_quarter_hours(s: pd.Series) -> pd.Series:
    """Hold each price over its own interval and express on a 15-min grid (hourly -> 4 equal quarters)."""
    q = s.resample("15min").ffill()
    end = s.index[-1] + (pd.Timedelta("15min") if (s.index[-1] - s.index[-2]) == pd.Timedelta("15min") else pd.Timedelta("1h"))
    q = q.reindex(pd.date_range(s.index[0], end, freq="15min", inclusive="left")).ffill()
    return q


def main():
    s, info = all_prices()
    model = s.reindex(AXIS)
    missing = int(model.isna().sum())
    assert missing == 0, f"{missing} missing quarter-hours in model year"
    meta = {
        "label": "Day-ahead spot price, bidding zone DE-LU",
        "source": "Energy-Charts API (Fraunhofer ISE), endpoint /v2/price",
        "sourceUrl": "https://api.energy-charts.info/",
        "licence": info["licences"][0],
        "attribution": "Bundesnetzagentur | SMARD.de, via energy-charts.info",
        "kind": "measured (market result)",
        "nativeResolutionMin": 15,
        "resampling": "none",
        "meanEurPerMWh": round(float(model.mean()), 2),
        "minEurPerMWh": round(float(model.min()), 2),
        "maxEurPerMWh": round(float(model.max()), 2),
        "negativeQuarterHours": int((model < 0).sum()),
        "missingSteps": missing,
    }
    write_series("price_da", model.values, "EUR/MWh", meta, decimals=2)
    print({k: meta[k] for k in ("meanEurPerMWh", "minEurPerMWh", "maxEurPerMWh", "negativeQuarterHours")})


if __name__ == "__main__":
    main()
