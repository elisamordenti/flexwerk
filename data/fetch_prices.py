"""Fetch DE-LU day-ahead prices from the Energy-Charts API (Fraunhofer ISE).

Licence: the API's own `license` field for DE-LU reads
"CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de".
We store that field per month and fail loudly if it ever changes.

Range: Jan 2025 - Sep 2026. The model year is Oct 2025 - Sep 2026; Jan-Sep 2025 is
fetched only to validate against the BNetzA published 2025 annual average.
Rate limit on /price is 2 requests/minute, so we pause 31 s between calls.
"""
import calendar
import json

from common import CACHE, http_get

EXPECTED_LICENSE_PREFIX = "CC BY 4.0"
API = "https://api.energy-charts.info/v2/price?bzn=DE-LU&start={s}&end={e}"


def months():
    for y, m in [(2025, m) for m in range(1, 13)] + [(2026, m) for m in range(1, 10)]:
        last = calendar.monthrange(y, m)[1]
        yield y, m, f"{y}-{m:02d}-01", f"{y}-{m:02d}-{last}"


def main():
    for y, m, s, e in months():
        dest = CACHE / "prices" / f"energy_charts_DE-LU_{y}-{m:02d}.json"
        fresh = not dest.exists()
        http_get(API.format(s=s, e=e), dest, min_interval_s=31 if fresh else 0)
        doc = json.loads(dest.read_text(encoding="utf-8"))
        lic = doc.get("license") or doc.get("meta", {}).get("license", "")
        if isinstance(lic, dict):
            lic = lic.get("name", "") or json.dumps(lic)
        n = len(doc.get("data", []))
        print(f"{y}-{m:02d}: {n} values, resolution={doc.get('resolution')}, license={lic[:60]!r}")
        if EXPECTED_LICENSE_PREFIX not in str(lic):
            raise SystemExit(f"Licence changed or missing for {y}-{m:02d}: {lic!r}")


if __name__ == "__main__":
    main()
