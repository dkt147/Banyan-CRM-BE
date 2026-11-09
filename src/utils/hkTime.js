/*
 * Hong Kong time helpers (brief section 4: store UTC, display in Asia/Hong_Kong).
 * Hong Kong has no daylight saving, so a fixed +08:00 offset is exact.
 */
export const HK_TZ = "Asia/Hong_Kong";
const HK_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Calendar parts of an instant as seen in Hong Kong (month is 1-12). */
export function hkParts(value) {
  const shifted = new Date(new Date(value).getTime() + HK_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** UTC instant of a Hong Kong wall-clock time; month is 1-12 and may overflow. */
export function hkInstant(year, month, day = 1, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - HK_OFFSET_MS);
}

/** [start, end) of the Hong Kong calendar month containing `value`. */
export function hkMonthRange(value) {
  const { year, month } = hkParts(value);
  return { start: hkInstant(year, month, 1), end: hkInstant(year, month + 1, 1) };
}

/** Google all-day dates ("2026-11-10") start at Hong Kong midnight, not UTC midnight. */
export const allDayToHk = (dateString) => (dateString ? `${dateString}T00:00:00+08:00` : null);
