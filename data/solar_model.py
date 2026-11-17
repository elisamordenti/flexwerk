"""Small, transparent PV physics in numpy (pvlib could not load on this machine: Windows
application control blocks its compiled dependencies h5py/scipy; see DECISIONS.md D-004).

Every formula is a standard published model, the same ones pvlib implements:
  Solar position .... NOAA Solar Calculator equations (after Meeus, "Astronomical Algorithms" 1991);
                      accuracy ~0.01 deg for 1800-2100, ample for 15-min PV.
  Extraterrestrial .. Spencer (1971), Fourier series for the earth-sun distance.
  Clear sky (test) .. Haurwitz (1945): GHI = 1098 cos(z) exp(-0.057 / cos z).
  Transposition ..... Hay & Davies (1980) anisotropic sky model.
  Incidence loss .... ASHRAE (Souka & Safwat 1966), b0 = 0.05.
  Cell temperature .. Faiman (2008), u0 = 25 W/m2K, u1 = 6.84 W s/m3K (IEC 61853-2 defaults).
  DC power .......... PVWatts v5 (Dobos 2014, NREL/TP-6A20-62641): P = E/1000 * P0 * (1 + g (Tc - 25)).
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def solar_position(times_utc: pd.DatetimeIndex, lat: float, lon: float):
    """Return (zenith_deg, azimuth_deg clockwise from north) using the NOAA equations."""
    jd = times_utc.to_julian_date().values
    jc = (jd - 2451545.0) / 36525.0
    l0 = np.mod(280.46646 + jc * (36000.76983 + jc * 0.0003032), 360)          # geom mean long sun
    m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)                         # mean anomaly
    e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)                    # eccentricity
    mr = np.radians(m)
    c = (np.sin(mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
         + np.sin(2 * mr) * (0.019993 - 0.000101 * jc) + np.sin(3 * mr) * 0.000289)
    true_long = l0 + c
    omega = 125.04 - 1934.136 * jc
    app_long = true_long - 0.00569 - 0.00478 * np.sin(np.radians(omega))
    eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60
    eps = eps0 + 0.00256 * np.cos(np.radians(omega))
    decl = np.degrees(np.arcsin(np.sin(np.radians(eps)) * np.sin(np.radians(app_long))))
    y = np.tan(np.radians(eps / 2)) ** 2
    l0r = np.radians(l0)
    eot = 4 * np.degrees(y * np.sin(2 * l0r) - 2 * e * np.sin(mr) + 4 * e * y * np.sin(mr) * np.cos(2 * l0r)
                         - 0.5 * y * y * np.sin(4 * l0r) - 1.25 * e * e * np.sin(2 * mr))       # minutes
    minutes = times_utc.hour.values * 60 + times_utc.minute.values + times_utc.second.values / 60
    tst = np.mod(minutes + eot + 4 * lon, 1440)                                  # true solar time
    ha = np.where(tst / 4 < 0, tst / 4 + 180, tst / 4 - 180)                    # hour angle deg
    latr, decr, har = np.radians(lat), np.radians(decl), np.radians(ha)
    cosz = np.sin(latr) * np.sin(decr) + np.cos(latr) * np.cos(decr) * np.cos(har)
    zen = np.degrees(np.arccos(np.clip(cosz, -1, 1)))
    # azimuth (clockwise from north)
    sz = np.sin(np.radians(zen))
    with np.errstate(invalid="ignore", divide="ignore"):
        cosaz = (np.sin(latr) * np.cos(np.radians(zen)) - np.sin(decr)) / (np.cos(latr) * sz)
    az0 = np.degrees(np.arccos(np.clip(cosaz, -1, 1)))
    az = np.where(ha > 0, np.mod(az0 + 180, 360), np.mod(540 - az0, 360))
    return zen, az, decl


def extraterrestrial(times_utc: pd.DatetimeIndex) -> np.ndarray:
    b = 2 * np.pi * (times_utc.dayofyear.values - 1) / 365.0
    return 1361.0 * (1.00011 + 0.034221 * np.cos(b) + 0.00128 * np.sin(b)
                     + 0.000719 * np.cos(2 * b) + 0.000077 * np.sin(2 * b))


def haurwitz(zen: np.ndarray) -> np.ndarray:
    cz = np.cos(np.radians(zen))
    with np.errstate(divide="ignore", over="ignore"):
        g = 1098.0 * cz * np.exp(-0.057 / cz)
    return np.where(zen < 90, g, 0.0)


def aoi_cos(tilt, surf_az, zen, az):
    t, sa, z, a = map(np.radians, (tilt, surf_az, zen, az))
    return np.cos(z) * np.cos(t) + np.sin(z) * np.sin(t) * np.cos(a - sa)


def poa_haydavies(tilt, surf_az, zen, az, dni, ghi, dhi, dni_extra, albedo):
    cos_aoi = aoi_cos(tilt, surf_az, zen, az)
    cosz = np.cos(np.radians(zen))
    rb = np.where(zen < 87, np.maximum(cos_aoi, 0) / np.maximum(cosz, 0.0436), 0.0)
    ai = np.clip(dni / dni_extra, 0, 1)
    ct = np.cos(np.radians(tilt))
    beam = dni * np.maximum(cos_aoi, 0)
    sky = dhi * (ai * rb + (1 - ai) * (1 + ct) / 2)
    ground = ghi * albedo * (1 - ct) / 2
    return beam, sky + ground, cos_aoi


def iam_ashrae(cos_aoi, b0=0.05):
    with np.errstate(divide="ignore"):
        v = 1 - b0 * (1 / cos_aoi - 1)
    return np.where(cos_aoi > 0, np.clip(v, 0, 1), 0.0)


def faiman(poa, tair, wind, u0=25.0, u1=6.84):
    return tair + poa / (u0 + u1 * wind)


def pvwatts_dc(poa_eff, tcell, p0=1.0, gamma=-0.0037):
    return poa_eff / 1000.0 * p0 * (1 + gamma * (tcell - 25.0))
