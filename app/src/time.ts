/** Map calendar days (Europe/Berlin) to steps on the UTC data axis. DST days have 92 or 100 steps. */
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' });

/** UTC milliseconds of local midnight in Berlin for the date `day0 + d` (day0 = 2025-10-01). */
export function berlinMidnightMs(d: number): number {
  const noonUTC = Date.UTC(2025, 9, 1 + d, 0, 0);
  // Berlin is UTC+1 or UTC+2: local midnight is 23:00 or 22:00 UTC of the previous day
  for (const h of [1, 2]) {
    const ms = noonUTC - h * 3600000;
    if (fmt.format(new Date(ms)) === '00') return ms;
  }
  return noonUTC - 3600000;
}

export function stepOfDay(d: number, axisStartISO: string, stepMinutes: number): number {
  return Math.round((berlinMidnightMs(d) - Date.parse(axisStartISO)) / (stepMinutes * 60000));
}
