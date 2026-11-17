# Data pipeline

Turns open data into compact, validated JSON in `app/public/data/`. Raw files are cached in `data/cache/` (git-ignored). Needs Python 3.11+ with pandas, numpy, requests and matplotlib.

```
python data/fetch_raw.py      # OPSD, DWD, PVGIS, SMARD, datasheet (~70 MB, cached)
python data/fetch_prices.py   # Energy-Charts, 21 monthly calls, ~11 min (rate limit)
python data/build_all.py      # builds every series + runs validate_all.py
```

| Output | Content | Unit |
|---|---|---|
| `price_da.json` | DE-LU day-ahead, 15 min | EUR/MWh |
| `load_warehouse.json`, `load_factory.json`, `load_cold_storage.json` | measured load shapes (real kW, scaled in the engine) | kW |
| `pv_south30.json`, `pv_eastwest15.json` | PV output, Leipzig | kW per kWp |
| `tariff_de_netzleipzig_2026.json` | grid fees, levies, taxes, with sources | ct/kWh, €/kW/yr |
| `battery_defaults.json` | C&I LFP defaults, with sources | — |
| `validation.json` | every check vs its independent reference | — |

All time series share one axis: start `2025-09-30T22:00Z` (= 1 Oct 2025 00:00 Berlin), 15-min steps, 35,040 values. Sanity charts are in `data/charts/`.
