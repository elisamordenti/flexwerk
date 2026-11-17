"""Download every raw input (except prices, see fetch_prices.py) into data/cache. Idempotent."""
from common import CACHE, http_get

OPSD = "https://data.open-power-system-data.org/household_data/2020-04-15/"
DWD = "https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes/"
PVGIS = "https://re.jrc.ec.europa.eu/api/v5_3/"
LAT, LON = 51.4347, 12.2396

FILES = {
    "opsd/household_data_15min_singleindex.csv": OPSD + "household_data_15min_singleindex.csv",
    "opsd/README.md": OPSD + "README.md",
    "dwd/solar_akt.zip": DWD + "solar/recent/10minutenwerte_SOLAR_02932_akt.zip",
    "dwd/solar_hist_2020_2025.zip": DWD + "solar/historical/10minutenwerte_SOLAR_02932_20200101_20251231_hist.zip",
    "dwd/temp_akt.zip": DWD + "air_temperature/recent/10minutenwerte_TU_02932_akt.zip",
    "dwd/temp_hist_2020_2025.zip": DWD + "air_temperature/historical/10minutenwerte_TU_02932_20200101_20251231_hist.zip",
    "dwd/stations_solar.txt": DWD + "solar/recent/zehn_min_sd_Beschreibung_Stationen.txt",
    "pvgis/pvcalc_leipzig_30deg_south.json": PVGIS + f"PVcalc?lat={LAT}&lon={LON}&peakpower=1&loss=14&angle=30&aspect=0&outputformat=json",
    "pvgis/pvcalc_leipzig_15deg_aspect-90.json": PVGIS + f"PVcalc?lat={LAT}&lon={LON}&peakpower=1&loss=14&angle=15&aspect=-90&outputformat=json",
    "pvgis/pvcalc_leipzig_15deg_aspect90.json": PVGIS + f"PVcalc?lat={LAT}&lon={LON}&peakpower=1&loss=14&angle=15&aspect=90&outputformat=json",
    "pvgis/seriescalc_leipzig_30deg_south_2020_2023.json": PVGIS + f"seriescalc?lat={LAT}&lon={LON}&startyear=2020&endyear=2023&pvcalculation=1&peakpower=1&loss=14&angle=30&aspect=0&outputformat=json",
    "smard/smard_4169_DE-LU_month_1735686000000.json": "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_month_1735686000000.json",
    "smard/smard_4169_DE-LU_month_1767222000000.json": "https://www.smard.de/app/chart_data/4169/DE-LU/4169_DE-LU_month_1767222000000.json",
    "battery/foxess_entmax_v1.6.pdf": "https://www.fox-ess.com/Public/Uploads/uploadfile/files/20260710/ENTMAXDatasheetV1.620260615.pdf",
    "battery/ise_lcoe_2024_en.pdf": "https://www.ise.fraunhofer.de/content/dam/ise/en/documents/publications/studies/EN2024_ISE_Study_Levelized_Cost_of_Electricity_Renewable_Energy_Technologies.pdf",
}

if __name__ == "__main__":
    for rel, url in FILES.items():
        p = http_get(url, CACHE / rel, min_interval_s=1)
        print(f"{p.stat().st_size/1e6:7.2f} MB  {rel}")
