/**
 * Berlin local time without Intl (fast, deterministic in Node and the browser).
 * EU rule since 1996: summer time (UTC+2) from the last Sunday of March 01:00 UTC
 * to the last Sunday of October 01:00 UTC; otherwise UTC+1.
 */
const lastSundayUTC = (year: number, month: number) => {
  const d = new Date(Date.UTC(year, month + 1, 0, 1)); // last day of month, 01:00 UTC
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
};
const cache = new Map<number, [number, number]>();
export function berlinOffsetH(ms: number): number {
  const y = new Date(ms).getUTCFullYear();
  let r = cache.get(y);
  if (!r) { r = [lastSundayUTC(y, 2), lastSundayUTC(y, 9)]; cache.set(y, r); }
  return ms >= r[0] && ms < r[1] ? 2 : 1;
}

/** Local (Berlin) day number since the epoch and minute-of-day for a UTC instant. */
export function berlinDay(ms: number): { day: number; minute: number } {
  const local = ms + berlinOffsetH(ms) * 3600000;
  const day = Math.floor(local / 86400000);
  return { day, minute: Math.round((local - day * 86400000) / 60000) };
}
