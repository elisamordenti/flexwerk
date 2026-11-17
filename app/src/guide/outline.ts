/** Guide outline. Chapters are written in step 6 (1, 3, 6, 10, 13 first); the rest stay stubs until filled. */
export interface Chapter { id: string; part: string; title: string; summary: string }

export const OUTLINE: Chapter[] = [
  { id: 'ch1', part: 'Part 1 · The energy world', title: '1. Energy basics: power, energy, meters and the grid connection', summary: 'kW vs kWh, the 15-minute meter, one site = one connection.' },
  { id: 'ch2', part: 'Part 1 · The energy world', title: '2. Solar: from sunlight to kilowatt-hours', summary: 'Irradiance, orientation, temperature and losses.' },
  { id: 'ch3', part: 'Part 1 · The energy world', title: '3. Batteries: capacity, power, losses and ageing', summary: 'kWh vs kW, round-trip efficiency, state of charge, wear.' },
  { id: 'ch4', part: 'Part 1 · The energy world', title: '4. Industrial loads: profiles, peaks and what can be shifted', summary: 'Measured shapes, base load, peaks, full-load hours.' },
  { id: 'ch5', part: 'Part 1 · The energy world', title: '5. EV fleets and heat pumps as flexible loads', summary: 'Shifting consumption in time.' },
  { id: 'ch6', part: 'Part 1 · The energy world', title: '6. Prices, tariffs and rules for German C&I sites', summary: 'Spot price, grid fees, the peak charge, the 2,500-hour switch, levies.' },
  { id: 'ch7', part: 'Part 2 · How the simulator is built', title: '7. The big picture: the architecture, layer by layer', summary: 'Data → profiles → site → engine → controllers → scoring → app.' },
  { id: 'ch8', part: 'Part 2 · How the simulator is built', title: '8. The data pipeline: from open data to validated profiles', summary: 'Sources, licences, cleaning and checks.' },
  { id: 'ch9', part: 'Part 2 · How the simulator is built', title: '9. The site description: asset catalogue, grid, tariff and controller', summary: 'Plug-in assets and declared parameters.' },
  { id: 'ch10', part: 'Part 2 · How the simulator is built', title: '10. The engine: one time step, in full', summary: 'Ask → clip → safety layer → apply → check.' },
  { id: 'ch11', part: 'Part 2 · How the simulator is built', title: '11. Forecasts, wear, studies and checks', summary: 'Perfect vs realistic forecasts; pricing battery wear.' },
  { id: 'ch12', part: 'Part 2 · How the simulator is built', title: '12. The app: the tool in the browser', summary: 'Everything runs locally in your browser.' },
  { id: 'ch13', part: 'Part 3 · How controllers decide', title: '13. The control problem: what a controller decides', summary: 'One number per battery per 15 minutes.' },
  { id: 'ch14', part: 'Part 3 · How controllers decide', title: '14. Rule-based control, rule by rule', summary: 'Peak shaving and price rules.' },
  { id: 'ch15', part: 'Part 3 · How controllers decide', title: '15. Optimisation from scratch: linear programs', summary: 'Variables, constraints, objective.' },
  { id: 'ch16', part: 'Part 3 · How controllers decide', title: '16. Our MPC, exactly as implemented', summary: '24-hour horizon, hourly re-plan, peak term, wear cost.' },
  { id: 'ch17', part: 'Part 3 · How controllers decide', title: '17. When the forecast is wrong', summary: 'Perfect vs realistic information.' },
  { id: 'ch18', part: 'Part 3 · How controllers decide', title: '18. Judging controllers fairly, and the plan-vs-operation gap', summary: 'Baselines, KPIs and the share of plan value captured.' },
  { id: 'x-battery', part: 'Extra sections', title: 'Battery modelling from scratch', summary: 'Reservoir model, equivalent circuits, ageing, rainflow, pricing wear.' },
  { id: 'x-examples', part: 'Extra sections', title: 'Practical examples', summary: 'Worked cases built on our own runs.' },
  { id: 'x-research', part: 'Extra sections', title: 'Research digests', summary: 'One-page summaries of key papers.' },
];
