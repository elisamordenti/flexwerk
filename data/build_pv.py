"""Build PV output profiles (kW per kWp) from MEASURED irradiance at DWD station 02932 Leipzig/Halle.

Sources
  DWD Climate Data Center, 10-minute station observations (CC BY 4.0):
    solar/  GS_10 global horizontal, DS_10 diffuse horizontal [J/cm^2 per 10 min]
    air_temperature/ TT_10 air temperature at 2 m [degC]
  Station: 51.4347 N, 12.2396 E, 131 m (DWD station list).
  PV model: solar_model.py (own numpy implementation of the standard models pvlib uses).

Method
  1. W/m^2 = J/cm^2 * 1e4 / 600 s. DWD missing value -999 -> NaN.
  2. Timestamp convention (start or end of the 10-min interval) is decided EMPIRICALLY:
     we correlate measured GHI with Haurwitz clear-sky GHI computed for both conventions and
     keep the better one (reported in meta). No guessing.
  3. DNI = (GHI - DHI) / cos(zenith) for zenith < 87 deg, else 0.
  4. Plane-of-array irradiance: Hay-Davies transposition, albedo 0.2 (example choice).
     Incidence-angle loss on beam: ASHRAE model b0=0.05.
  5. Cell temperature: Faiman model (IEC 61853-2 default coefficients), wind speed fixed at 1 m/s
     (example choice: station wind not used in v1). Solar position at quarter-hour midpoint (NOAA).
  6. DC power: PVWatts, gamma = -0.37 %/K (PVWatts v5 'standard module' default).
  7. System losses 14 % (same value as the PVGIS default, so the validation compares like with like).
  8. 10 min -> 15 min WITHOUT inventing detail: each 10-min average is held constant over its
     interval (step function), split into 5-min pieces, and three pieces averaged per quarter-hour.
"""
from __future__ import annotations

import io
import zipfile

import numpy as np
import pandas as pd
import solar_model as sm

from common import AXIS, CACHE, write_series

LAT, LON, ALT = 51.4347, 12.2396, 131
DWD = CACHE / "dwd"
SYSTEM_LOSS = 0.14
GAMMA = -0.0037
ALBEDO = 0.2
WIND = 1.0

ORIENTATIONS = {
    "pv_south30": dict(label="South-facing, 30 deg tilt", planes=[(30, 180, 1.0)]),
    "pv_eastwest15": dict(label="East-west flat roof, 15 deg tilt (half east, half west)",
                          planes=[(15, 90, 0.5), (15, 270, 0.5)]),
}


def read_dwd(zip_names, cols):
    frames = []
    for zn in zip_names:
        z = zipfile.ZipFile(DWD / zn)
        prod = [n for n in z.namelist() if n.startswith("produkt")][0]
        df = pd.read_csv(io.BytesIO(z.read(prod)), sep=";", skipinitialspace=True, encoding="latin1")
        df.columns = [c.strip() for c in df.columns]
        df["t"] = pd.to_datetime(df["MESS_DATUM"].astype(str), format="%Y%m%d%H%M", utc=True)
        frames.append(df.set_index("t")[cols])
    out = pd.concat(frames)
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out.replace(-999, np.nan)


def choose_convention(ghi: pd.Series) -> tuple[str, dict]:
    """Decide whether DWD timestamps mark the START or END of each 10-min interval.

    On clear days, sunlight is symmetric around solar noon, so the 'centre of mass' of the
    measured GHI curve (computed with the raw timestamps) should sit at solar noon + 5 min
    if timestamps mark the interval end, or solar noon - 5 min if they mark the start.
    """
    s = ghi.loc["2024-01-01":"2026-10-31"].dropna()
    offsets = []
    for day, g in s.groupby(s.index.date):
        if len(g) < 144:
            continue
        z, _, _ = sm.solar_position(g.index, LAT, LON)
        cs = sm.haurwitz(z)
        if cs.sum() <= 0 or g.sum() < 0.8 * cs.sum():
            continue                       # not a clear day
        if np.abs(g.values - cs).mean() > 0.1 * cs.mean():
            continue                       # broken clouds
        mins = (g.index.hour * 60 + g.index.minute).to_numpy(dtype=float)
        com = float((mins * g.values).sum() / g.values.sum())
        noon = float(mins[np.argmin(z)])
        offsets.append(com - noon)
    off = float(np.median(offsets))
    best = "label=interval end" if off > 0 else "label=interval start"
    return best, {"clearDays": len(offsets), "medianCentreMinusNoonMin": round(off, 2),
                  "expected": "+5 if label=end, -5 if label=start"}


def to_quarter_hours(s10: pd.Series, label_is_end: bool) -> pd.Series:
    start = s10.index - pd.Timedelta(minutes=10) if label_is_end else s10.index
    s = pd.Series(s10.values, index=start)
    five = s.reindex(s.index.union(s.index + pd.Timedelta(minutes=5))).ffill(limit=1)
    q = five.resample("15min", label="left", closed="left").mean()
    # mark quarter-hours where any 5-min piece was missing as missing
    cnt = five.resample("15min", label="left", closed="left").count()
    q[cnt < 3] = np.nan
    return q


def load_inputs():
    sol = read_dwd(["solar_hist_2020_2025.zip", "solar_akt.zip"], ["GS_10", "DS_10"])
    tmp = read_dwd(["temp_hist_2020_2025.zip", "temp_akt.zip"], ["TT_10"])
    ghi10 = sol["GS_10"] * 1e4 / 600.0
    dhi10 = (sol["DS_10"] * 1e4 / 600.0).clip(upper=ghi10)
    conv, scores = choose_convention(ghi10)
    return ghi10, dhi10, tmp["TT_10"], conv, scores


def model_pv(axis, ghi10, dhi10, t10, label_is_end, planes):
    """PV AC output (kW/kWp) on `axis` (15-min UTC index). Returns (series, diagnostics)."""
    AXIS = axis
    ghi = to_quarter_hours(ghi10, label_is_end).reindex(AXIS)
    dhi = to_quarter_hours(dhi10, label_is_end).reindex(AXIS)
    tair = to_quarter_hours(t10, label_is_end).reindex(AXIS)

    gaps = {"ghi": int(ghi.isna().sum()), "dhi": int(dhi.isna().sum()), "tair": int(tair.isna().sum())}
    # Gap handling: night-time gaps -> 0; daytime gaps -> same quarter-hour previous day (counted)
    mid = AXIS + pd.Timedelta(minutes=7.5)
    z_, a_, _ = sm.solar_position(mid, LAT, LON)
    zen = pd.Series(z_, index=AXIS)
    azi = pd.Series(a_, index=AXIS)
    night = zen >= 90
    for s in (ghi, dhi):
        s[night & s.isna()] = 0.0
    day_gap_steps = int((ghi.isna() | dhi.isna()).sum())
    for lag in (96, -96, 192, -192):
        ghi = ghi.fillna(ghi.shift(lag)); dhi = dhi.fillna(dhi.shift(lag))
    tair = tair.interpolate(limit=8).fillna(tair.shift(96))

    cosz = np.cos(np.radians(zen))
    dni = ((ghi - dhi) / cosz).where(zen < 87, 0.0).clip(lower=0, upper=1100)
    dni_extra = pd.Series(sm.extraterrestrial(mid), index=AXIS)

    total = pd.Series(0.0, index=AXIS)
    poa_sum = pd.Series(0.0, index=AXIS)
    for tilt, az, share in planes:
        beam, diffuse, cos_aoi = sm.poa_haydavies(tilt, az, zen.values, azi.values, dni.values,
                                                  ghi.values, dhi.values, dni_extra.values, ALBEDO)
        poa_eff = np.nan_to_num(np.clip(beam * sm.iam_ashrae(cos_aoi) + diffuse, 0, None))
        poa_sum += share * pd.Series(np.nan_to_num(beam + diffuse), index=AXIS)
        tcell = sm.faiman(poa_eff, tair.values, WIND)
        pdc = sm.pvwatts_dc(poa_eff, tcell, 1.0, GAMMA)   # kW per kWp (STC 1000 W/m2)
        total += share * pd.Series(np.clip(pdc, 0, None), index=AXIS)
    p = (total * (1 - SYSTEM_LOSS)).clip(upper=1.0)
    diag = {"rawMissingSteps": gaps, "daytimeGapStepsFilledFromPreviousDay": day_gap_steps,
            "ghiKWhPerM2": round(float(ghi.sum() / 4 / 1000), 1),
            "poaKWhPerM2": round(float(poa_sum.sum() / 4 / 1000), 1)}
    return p, diag


def main():
    ghi10, dhi10, t10, conv, scores = load_inputs()
    label_is_end = conv == "label=interval end"
    print("timestamp convention:", conv, scores)
    for pid, cfg in ORIENTATIONS.items():
        p, diag = model_pv(AXIS, ghi10, dhi10, t10, label_is_end, cfg["planes"])
        annual = float(p.sum() / 4)
        meta = {
            "label": cfg["label"],
            "unitNote": "AC output per kWp installed",
            "source": "DWD Climate Data Center, 10-min station observations, station 02932 Leipzig/Halle; modelled with standard PV models (solar_model.py)",
            "sourceUrl": "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes/solar/",
            "licence": "DWD data CC BY 4.0; model code our own (MIT)",
            "kind": "modelled from measured irradiance",
            "nativeResolutionMin": 10,
            "resampling": "10-min held as step function, averaged to 15-min (no interpolation)",
            "timestampConvention": conv, "conventionScores": scores,
            "model": {"transposition": "Hay-Davies", "albedo": ALBEDO, "iam": "ASHRAE b0=0.05",
                      "cellTemperature": "Faiman u0=25, u1=6.84, wind fixed 1 m/s (example choice)",
                      "dc": f"PVWatts gamma={GAMMA}/K", "systemLoss": SYSTEM_LOSS},
            "planes": [{"tiltDeg": t, "azimuthDeg": a, "share": s} for t, a, s in cfg["planes"]],
            **diag,
            "annualKWhPerKWp": round(annual, 1),
        }
        write_series(pid, p.values, "kW/kWp", meta, decimals=4)
        print(pid, meta["annualKWhPerKWp"], "kWh/kWp;", diag)


if __name__ == "__main__":
    main()
