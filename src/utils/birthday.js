import { AppError } from "./AppError.js";

/*
 * Contact birthdays (client feedback 26 Nov, C): "MM-DD" (year unknown) or "YYYY-MM-DD".
 * 02-29 is allowed without a year, and with a year only in a leap year. Years 1900 to now.
 */
const RX = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/;
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** undefined -> undefined (not sent), null / "" -> null (clear), else the checked string. */
export function normalizeBirthday(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const text = String(value).trim();
  const m = RX.exec(text);
  const bad = () => new AppError("Birthday must be MM-DD or YYYY-MM-DD and a real date.", 400, "INVALID_BIRTHDAY");
  if (!m) throw bad();
  const year = m[1] ? Number(m[1]) : null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > DAYS[month - 1]) throw bad();
  if (year !== null) {
    if (year < 1900 || year > new Date().getUTCFullYear()) throw bad();
    if (month === 2 && day === 29 && !isLeap(year)) throw bad();
  }
  return text;
}

/** "1990-03-14" or "03-14" -> "03-14". */
export const birthdayMonthDay = (birthday) => (birthday ? String(birthday).slice(-5) : null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "03-14" -> "14 Mar"; "1990-03-14" -> "14 Mar 1990". */
export function formatBirthday(birthday) {
  const m = RX.exec(String(birthday || ""));
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${m[1] ? ` ${m[1]}` : ""}`;
}

export { isLeap };
