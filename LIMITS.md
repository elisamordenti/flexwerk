# Limits

What the model simplifies or leaves out. Each item says roughly how it could move the results.

**L-001: Load profiles are scaled from small sites.**
The OPSD sites peak at 65–220 kW. The 150 kW – 2 MW range is reached by scaling the shape. Real larger sites often have smoother aggregate load (more machines averaging out), so peaks may be **sharper** here than in reality. Peak-shaving value may be somewhat **overstated**.

**L-002: Load data and price data come from different years.**
Load is from 2016–17 and prices from 2025–26. Correlations between site load and market prices (e.g. weather-driven cooling vs cheap solar hours) are only partly preserved through calendar alignment.

**L-003: Public holidays are not matched.**
A source holiday can land on a target working day and vice versa. This affects a handful of days per year.

**L-004: The cold-storage profile is a proxy.**
It is built from the refrigeration sub-meters of one industrial building, not measured at a cold store.

**L-005: One weather station, one year.**
PV is driven by one station's 2025–26 weather. That year was sunny: about 4 % above the long-term mean after removing model bias.

**L-006: PV model bias.**
The model reads 3–5 % above PVGIS on the same years. Possible causes: ground station vs satellite irradiance, no spectral correction, wind fixed at 1 m/s, no shading, no soiling or snow beyond the 14 % lump loss.

**L-007: The tariff is simplified.**
- Not modelled: the monthly-peak option, individual grid fees (§ 19 (2) StromNEV), the concession-fee exemption below the Grenzpreis, metering fees (fixed, so they don't change with the battery), the EEG market premium for PV, and § 14a EnWG reductions.
- The electricity-tax and levy reductions for manufacturing are a yes/no setting.

**L-008: The 2026 rules are a snapshot.**
The BNetzA AgNes draft (Aug 2026) would replace the annual peak price with a booked-capacity price from 2029. Results describe the 2026 rules only.

**L-009: The battery cannot export.**
v1 is behind-the-meter only, so the value from wholesale arbitrage via export, and from ancillary services, is excluded.

**L-010: Controllers see the current quarter-hour's net load when deciding.**
That is perfect knowledge within the step. Realistic forecasts (step 4) affect only the look-ahead.

**L-011: Short runs pro-rate the annual peak charge.**
See D-015. Only full-year runs give the true peak-charge effect.

**L-012: The MPC is slow in the browser for long periods.**
About 4–6 s per simulated week per run in the browser (≈ 1.4 s in Node). A full year takes minutes, so the full-year table is pre-computed (`engine/scripts/yeartable.ts`) and covers the examples' default settings only.

**L-013: Realistic forecasts are naive persistence.**
Commercial forecasters beat "same as last week". The realistic MPC result is therefore a cautious estimate of what a good real controller achieves.

**L-014: Each run starts with no peak history.**
The controllers only know the peak so far within the simulated period. In a short run starting mid-year, a real site would already have a higher peak to stay under, so short-run peak savings can look different from the full year.

**L-015: Van sessions are home charging used as depot visits.**
British Gas vans charged at the drivers' homes. Depot routines may differ (shift patterns, shared chargers). The uncontrolled daily shape correlates 0.62 with measured Royal Mail depots and peaks one hour later (20:00 vs 19:00).

**L-016: The heat pump is simplified.**
No tank heat losses, no defrost cycles, no minimum run or off times, no part-load efficiency change, one COP per step for space heating and hot water combined. Heat demand comes from outdoor temperature only (degree days): no opening hours, weekends, sun or wind, and more heat at night than a real office would use. Not a measured building.

**L-017: Realistic forecasts for vans and heat are simple persistence.**
Vans: plugged-in vans' departure and energy are known (a fleet system knows them); future arrivals are last week's at the same time. Heat: same quarter-hour yesterday.

**L-018: The joint planner is slower.**
About 33 ms per hourly plan with vans and heat pump (6 ms battery only): ~6 s per simulated week in Node, ~12 s in the browser.
