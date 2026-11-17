# Decisions

Every non-obvious choice and why. Newest at the bottom.

**D-001: One model year, Oct 2025 – Sep 2026, on one 15-min UTC axis (35,040 steps).**
Day-ahead prices have been quarter-hourly since delivery day 1 Oct 2025 (SDAC 15-min MTU), so this year needs no resampling of prices. Working in UTC avoids the duplicate and missing hours at daylight-saving changes; the app converts to Berlin time for display.

**D-002: One example DSO, Netz Leipzig 2026.**
Its 2026 price sheet is final, public and machine-readable. Labelled "one example DSO" everywhere. Solar uses the matching DWD station, Leipzig/Halle, so the site sits in one place.

**D-003: Gross load = net grid import + on-site PV.**
The OPSD sites have rooftop PV and no export meter. This is correct only if the site never exported, which we tested: zero quarter-hours with PV producing while import ≈ 0.

**D-004: Own numpy PV model instead of pvlib.**
Windows application control on the build machine blocks the compiled files of pvlib's dependencies (h5py/scipy). We did not try to get around that security policy. `data/solar_model.py` implements the same published models (NOAA solar position, Hay-Davies, ASHRAE IAM, Faiman, PVWatts), each cited in the file. Solar position was checked by hand: 21 June 2026 at Leipzig gives solar noon 11:13 UTC and peak elevation 62.0° (theory 62.0°).

**D-005: DWD timestamps mark the END of each 10-min interval. Decided from the data, not assumed.**
On 180 clear days, the centre of mass of measured sunlight sits a median 3.4 min after solar noon. An interval-start convention would put it about 5 min before.

**D-006: No fake resolution.**
10-min irradiance becomes 15-min by holding each 10-min value constant over its interval and averaging; there is no interpolation. Prices are native 15-min. Load is native 15-min.

**D-007: Load years are mapped to the model year by weekday.**
Source days are matched by calendar date, shifted by at most ±3 days so Monday maps to Monday, at the same local clock time. Public holidays are not matched (LIMITS L-003).

**D-008: Loads keep their real kW, and the engine scales them.**
The profiles ship with their measured magnitude and metadata (annual kWh, peak, full-load hours). The engine scales the shape to the user's chosen annual consumption, so the peak scales by the same factor.

**D-009: PV bias is reported, not calibrated away.**
Our model reads 3–5 % above PVGIS on the same years. We keep the physics as is and show the difference in the Data panel. A user can apply a derating factor on the PV asset.

**D-010: The 2,500 h switch is billed exactly. MPC (step 4) uses the expected regime.**
The bill is the cheaper of two linear price pairs, which is concave in the peak. An LP cannot minimise that directly, so the MPC will use the price pair of the site's expected regime, and the engine reports when the battery moved the site across the switch.

**D-011: Battery may not export to the grid in v1.**
Behind-the-meter only. This avoids the mixed-use metering and levy rules for storage that exports.

**D-012: Battery defaults come from one datasheet. Capex is the midpoint of the ISE range.**
RTE 0.89 is taken from the datasheet's "> 89 %" (the conservative reading). Capex 625 €/kWh is the midpoint of ISE's 450–800 range. Replacement cost equals capex (example choice).

**D-013: Example sites (all sizes are example choices).**

| Example | Load | Solar | Battery |
|---|---|---|---|
| Factory | 1.5 GWh/yr | 300 kWp east-west | 200 kW / 430 kWh |
| Warehouse | 0.8 GWh/yr | 500 kWp south | 200 kW / 430 kWh |
| Cold storage | 1.2 GWh/yr | 250 kWp south | 300 kW / 645 kWh |

Batteries are whole multiples of the cited 215 kWh / 100 kW cabinet. Each example opens on the week containing its annual baseline peak.

**D-014: Static peak shaving never recharges above the highest import seen so far.**
The textbook rule recharges up to the threshold. In periods where the threshold sits above the natural peak, that recharging creates a new peak and makes the result worse than doing nothing. Capping recharge at the running maximum import is the usual practical refinement.

**D-015: Peak charge in short runs is pro-rated (peak × €/kW/yr × days/365).**
This keeps short runs comparable with each other. The real bill uses the annual peak, so one bad quarter-hour costs the full annual price. The full-year run is the headline for that reason.

**D-016: Engine in TypeScript; the app recomputes in the browser on every change.**
A week runs in under 1 ms. A full year (two runs: strategy + baseline) takes about 1 s on the main thread. It moves to a Web Worker when the MPC arrives in step 4.

**D-017: The UI follows Site Lab's two-page approach (Lab + Learn), built from scratch.**
No code or text was taken from Site Lab. The flow diagram is our own SVG.

**D-018: Two forecast modes. "Realistic" is deliberately simple.**
Perfect = the true future (an upper bound). Realistic = what a site controller could know at decision time: day-ahead prices for tomorrow only from 13:00 Berlin time (the auction closes 12:00 CET and results are public ~12:45), unknown prices repeat the last known day; load = same quarter-hour last week; solar = same quarter-hour yesterday. The current quarter-hour is always known (L-010). Persistence is the standard naive baseline; a real forecaster would do better, so realistic results are on the cautious side (L-013).

**D-019: The MPC plans 4 h in quarter-hours, then 20 h in hourly blocks, and re-plans every hour.**
A 96-step plan took 19 ms per solve (≈ 3 min per simulated year); the mixed plan takes ≈ 6 ms with the same near-term detail. The far part of the plan is re-done before it is executed, so the coarse blocks mainly shape where energy goes, not when exactly. Presolve is off (faster for this small problem).

**D-020: Several batteries are planned as one.**
Capacities, power and stored energy are added; efficiency is capacity-weighted. The plan is split in proportion to power rating. Exact for identical cabinets, an approximation otherwise.

**D-021: MPC details that are choices, not physics.**
- Peak price: the full annual €/kW (the true cost of raising the year's peak), applied to import above the highest import so far in the run.
- Energy left at the end of a plan is valued at η × (median planned import price − wear cost), so the plan does not empty the battery just because the horizon ends.
- Real-time peak guard: between re-plans, if actual load is higher than forecast, the battery discharges more so import stays at the planned peak.
- Tiny throughput cost (1e-4 €/kWh) so the LP never charges and discharges in the same step.

**D-022: Placeholder wear cost 78 €/MWh discharged until the wear model (step 3).**
625 €/kWh capex (D-012) ÷ 8,000 full cycles (datasheet, to 70 % capacity). This treats the whole investment as used up at end of life, which overstates wear cost somewhat; the rainflow + BLAST-Lite model will replace it.

**D-023: Price-aware rules charge up to the peak threshold, not the running peak.**
Their purpose is arbitrage; capping at the running peak (D-014) would stop them charging in the first weeks of a run. The threshold is the user's stated limit.

**D-024: Simulations run in a Web Worker; the solver loads only when the MPC is chosen.**
HiGHS is a 2.7 MB WebAssembly file. A busy worker is restarted when settings change, so the newest settings always win.

**D-025: Scene view is our own isometric SVG; images export as PNG.**
Every drawing (grid mast, connection, factory, solar rows, battery containers, van chargers, heat pump with tank) is built from simple iso boxes in `Scene.tsx`. "Image" saves the current view (diagram or scene) as a 2× PNG, with styles written onto a copy so it looks the same outside the app.

**D-026: The project stays commercial/industrial; a logistics depot is the lead example.**
Decided with Elisa on 17 Nov 2026. Reasons: the German peak charge makes control worth real money; a depot naturally combines a van fleet, heating, solar and a battery behind one meter; and it differs from Site Lab, which models homes and an office.

**D-027: EV fleet data = Optimise Prime British Gas van sessions, used as depot visits.**
156 vans that cover Jul 2021 – Jun 2022 with ≥ 150 sessions each (CC BY 4.0, UK Power Networks). Mapped to the model year by weekday, same local clock time (as D-007). The vans charged at drivers' homes; the daily pattern is checked against measured Royal Mail depot load (L-015). A session's energy is capped at what the chosen charger power can deliver while plugged in; the capped amount is reported.

**D-028: Van charging is shared earliest-deadline-first; the planner sees the fleet as one energy envelope.**
Each step every van first gets its must-charge power (what cannot fit into its remaining time), then spare power goes to the van leaving first. For the MPC the fleet is one variable with a per-step power limit and cumulative energy bounds (must-have-by / could-have-by). This is the standard aggregate; it can occasionally promise a plan the individual vans cannot follow exactly, which the must-charge rule then corrects.

**D-029: Heat pump on Leipzig temperatures, one tank, no losses.**
Heat demand: heating degree days G20/15 (VDI 3807): a day needs heat when its mean is below 15 °C, in proportion to 20 °C minus the mean, shared over the hours by how cold each hour is; hot water flat. COP: When2Heat air-source curve × 0.85 field correction (Ruhnau et al. 2019, code MIT). Our yearly efficiency (2.88 radiators, 3.36 floor) is inside Fraunhofer ISE's field range (2.6–4.9, mean 3.4); radiators are 15 % below the mean and flagged.

**D-030: The MPC plans battery, van fleet and heat pump together; rule strategies leave each asset to its own rule.**
Site Lab's MPC plans the battery and EV chargers; its heat pump runs on demand inside the planner. Planning the heat pump's tank too is this project's addition. The baseline is always: battery idle, vans charge at once, heat pump on demand.

**D-031: Heat demand from temperature only, not the BDEW gas profile (decided by the project owner, 2026-11-17).**
The BDEW/BGW profile coefficients are not openly licensed, so they were replaced by the standard degree-day rule (D-029). Simpler and fully open; it ignores opening hours and weekends (L-016).

**D-032: Project name "Flexwerk" (2026-11-17).**
"Werk" = plant/works in German; "flex" because the planner schedules every flexible asset (battery, vans, heat pump), not only the battery.
