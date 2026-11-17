"""Shared paths, time axis and JSON writer for the data pipeline.

Every series the app reads lives on ONE time axis:
  start  = 2025-10-01 00:00 Europe/Berlin = 2025-09-30T22:00Z
  step   = 15 minutes, uniform in UTC (no DST gaps or duplicates)
  length = 365 days * 96 = 35 040 steps
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"                                   # raw downloads, git-ignored
OUT = ROOT.parent / "app" / "public" / "data"            # compact JSON the app loads
CHARTS = ROOT / "charts"                                 # sanity-check PNGs
for p in (CACHE, OUT, CHARTS):
    p.mkdir(parents=True, exist_ok=True)

YEAR_START = pd.Timestamp("2025-09-30T22:00:00Z")
YEAR_END = pd.Timestamp("2026-09-30T22:00:00Z")          # exclusive
STEP = pd.Timedelta(minutes=15)
AXIS = pd.date_range(YEAR_START, YEAR_END, freq=STEP, inclusive="left")
assert len(AXIS) == 35040

USER_AGENT = "ci-battery-lab-data-pipeline/0.1 (open-source research tool)"


def http_get(url: str, dest: Path, min_interval_s: float = 0.0, force: bool = False) -> Path:
    """Download url to dest once (cached). Optional pause to respect rate limits."""
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(5):
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=120)
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", "60"))
            print(f"  429 rate-limited, waiting {wait}s")
            time.sleep(wait)
            continue
        r.raise_for_status()
        dest.write_bytes(r.content)
        if min_interval_s:
            time.sleep(min_interval_s)
        return dest
    raise RuntimeError(f"failed after retries: {url}")


def write_series(name: str, values, unit: str, meta: dict, decimals: int = 3) -> Path:
    """Write one series on the common axis as compact JSON."""
    vals = [None if pd.isna(v) else round(float(v), decimals) for v in values]
    assert len(vals) == len(AXIS), f"{name}: {len(vals)} != {len(AXIS)}"
    doc = {
        "id": name,
        "unit": unit,
        "start": YEAR_START.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stepMinutes": 15,
        "n": len(vals),
        "meta": meta,
        "values": vals,
    }
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {path.relative_to(ROOT.parent)} ({path.stat().st_size/1024:.0f} kB)")
    return path


def write_json(name: str, doc: dict) -> Path:
    path = OUT / f"{name}.json"
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"  wrote {path.relative_to(ROOT.parent)}")
    return path
