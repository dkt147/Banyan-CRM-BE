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

const DATE_RX = /^(\d{4})-(\d{2})-(\d{2})$/;
/** "YYYY-MM-DD" -> { year, month, day } when it's a real calendar date, else null. */
export function parseHkDate(value) {
  const m = DATE_RX.exec(String(value || "").trim());
  if (!m) return null;
  const [year, month, day] = m.slice(1).map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Today's Hong Kong date as "YYYY-MM-DD". */
export function hkToday(now = new Date()) {
  const { year, month, day } = hkParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
