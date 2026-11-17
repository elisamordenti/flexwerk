"""Run the whole data pipeline in order. Raw downloads are cached in data/cache (git-ignored).

  python data/fetch_prices.py   # once; ~11 min because of the API rate limit
  python data/build_all.py

Other raw files (OPSD, DWD, PVGIS, datasheet, ISE study, Optimise Prime tables 06/27-32) are fetched with the curl commands
listed in data/README.md.
"""
import build_battery
import build_ev
import build_heat
import build_load
import build_prices
import build_pv
import build_tariff
import validate_all

if __name__ == "__main__":
    for mod in (build_prices, build_load, build_pv, build_heat, build_ev, build_tariff, build_battery, validate_all):
        print(f"== {mod.__name__}")
        mod.main()
