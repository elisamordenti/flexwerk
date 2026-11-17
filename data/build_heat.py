"""Heat demand and heat-pump efficiency (COP) for the model year, from Leipzig air temperature only.

Heat demand: heating degree days, VDI 3807 definition G20/15 (indoor 20 degC, heating limit 15 degC),
on DWD station 02932 Leipzig/Halle temperatures (the same station as our solar data).
  daily space heat       h(d) = 20 - T_day   if the daily mean T_day < 15 degC, else 0
  hourly                 h(d) shared over the day's hours in proportion to max(0, 20 - T_hour)
  hot water              constant over the year (example choice)
  Then scaled so each series sums to 1 MWh over the year (the user sets the annual MWh).
  Not modelled: opening hours, weekends, sun and wind, building inertia (LIMITS L-016).

COP, air-source (Ruhnau, Hirth & Praktiknjo 2019, Scientific Data 6:189, When2Heat; code MIT):
  dT = T_sink - T_air, clipped at >= 15 K;  COP = 0.85 * (6.08 - 0.0941 dT + 0.000464 dT^2)
  sink temperature       radiators 40 - T_air;  floor heating 30 - 0.5 T_air;  hot water 50  (degC)

Outputs (15-min axis, hourly values held for 4 quarter-hours: no interpolation, DECISIONS D-006):
  heat_space_com   kW of heat per MWh/yr of annual space-heating demand (series sums to 1 MWh over the year)
  heat_water_com   same for hot water
  cop_air_radiator, cop_air_floor, cop_air_water   (-)
  temp_air         degC, hourly mean
"""
from __future__ import annotations

import io

import numpy as np
import pandas as pd

from build_pv import load_inputs
from common import AXIS, CACHE, http_get, write_series

TZ = "Europe/Berlin"
W2H = "https://raw.githubusercontent.com/oruhnau/when2heat/master/input"
HDD_CITE = "Heating degree days G20/15 (VDI 3807) on DWD Leipzig temperatures; COP: When2Heat (Ruhnau et al. 2019, doi:10.1038/s41597-019-0199-y; code MIT)"


def w2h_csv(path: str) -> pd.DataFrame:
    f = http_get(f"{W2H}/{path}", CACHE / "when2heat" / path.replace("/", "_"))
    return pd.read_csv(io.StringIO(f.read_text(encoding="utf-8-sig")), sep=";", decimal=",")


def cop_air(dT: np.ndarray) -> np.ndarray:
    p = w2h_csv("cop/cop_parameters.csv").set_index("Coefficient")["air"]
    d = np.clip(dT, 15, None)
    return 0.85 * (p.loc[0] + p.loc[1] * d + p.loc[2] * d ** 2)


def main():
    _, _, t10, _, _ = load_inputs()
    # hourly local mean temperature over the model year (+4 days before, for the reference temperature)
    t = t10.copy()
    t.index = t.index.tz_convert(TZ)
    hourly = t.resample("1h").mean().interpolate(limit=6)
    loc_axis = AXIS.tz_convert(TZ)
    h_idx = pd.date_range(AXIS[0] - pd.Timedelta(days=4), AXIS[-1].ceil("h"), freq="1h").tz_convert(TZ)
    hourly = hourly.reindex(h_idx).interpolate(limit=6)
    gaps = int(hourly.isna().sum())
    hourly = hourly.fillna(hourly.shift(24)).fillna(hourly.shift(-24))

    # heating degree days G20/15 (VDI 3807), shared over the hours by how cold each hour is
    day_of = pd.to_datetime(hourly.index.date)
    t_day = hourly.groupby(day_of).transform("mean")
    need_h = (20 - hourly).clip(lower=0)
    share = need_h / need_h.groupby(day_of).transform("sum").replace(0, np.nan)
    space_h = ((20 - t_day).where(t_day < 15, 0) * share).fillna(0)
    water_h = pd.Series(1.0, index=hourly.index)

    # onto the 15-min axis: each hour's value held for its four quarter-hours
    def to_axis(s: pd.Series) -> pd.Series:
        return pd.Series(s.reindex(AXIS.floor("h").tz_convert(TZ)).values, index=AXIS)  # floor in UTC: Berlin offsets are whole hours

    space, water, tair = to_axis(space_h), to_axis(water_h), to_axis(hourly)
    space_n = space / (space.sum() * 0.25 / 1000)   # kW per MWh/yr
    water_n = water / (water.sum() * 0.25 / 1000)
    cops = {
        "radiator": cop_air((40 - tair) - tair),
        "floor": cop_air((30 - 0.5 * tair) - tair),
        "water": cop_air(50 - tair),
    }
    base = {"source": HDD_CITE + "; temperature DWD CDC 10-min station 02932 Leipzig/Halle",
            "sourceUrl": "https://github.com/oruhnau/when2heat", "licence": "DWD data CC BY 4.0; When2Heat code MIT",
            "kind": "modelled from measured temperature", "nativeResolutionMin": 60,
            "resampling": "hourly values held for 4 quarter-hours", "temperatureGapHours": gaps}
    winter = space.index.tz_convert(TZ).month.isin([11, 12, 1, 2, 3])
    write_series("heat_space_com", space_n.values, "kW per MWh/yr",
                 {**base, "label": "Space heating (heating degree days G20/15)", "winterShare": round(float(space[winter].sum() / space.sum()), 3)}, decimals=5)
    write_series("heat_water_com", water_n.values, "kW per MWh/yr",
                 {**base, "label": "Hot water (flat, example choice)"}, decimals=5)
    for k, v in cops.items():
        spf = float((space_n if k != "water" else water_n).sum() / ((space_n if k != "water" else water_n) / v).sum())
        write_series(f"cop_air_{k}", v.values, "-", {**base, "label": f"Air-source heat pump COP, {k}",
                     "correction": 0.85, "seasonalPerformanceFactor": round(spf, 2)})
        print(f"  COP {k}: mean {v.mean():.2f}, demand-weighted SPF {spf:.2f}")
    write_series("temp_air", tair.values, "degC", {**base, "label": "Air temperature Leipzig/Halle, hourly mean",
                 "kind": "measured", "source": "DWD CDC 10-min station 02932 Leipzig/Halle"}, decimals=1)
    print(f"  mean temp {tair.mean():.1f} degC, winter share of space heat {space[winter].sum() / space.sum():.2f}, gaps {gaps} h")


if __name__ == "__main__":
    main()
