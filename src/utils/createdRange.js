import { AppError } from "./AppError.js";
import { hkInstant, parseHkDate } from "./hkTime.js";

/**
 * createdFrom / createdTo (25 Nov, §1): Hong Kong calendar dates, inclusive at both ends.
 * Returns a Mongo filter on createdAt, or null when neither is given. Bad dates or from > to:
 * 400 INVALID_DATE_RANGE.
 */
export function createdRangeFilter({ createdFrom, createdTo } = {}) {
  const bad = (message) => new AppError(message, 400, "INVALID_DATE_RANGE");
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";
  if (!has(createdFrom) && !has(createdTo)) return null;
  const from = has(createdFrom) ? parseHkDate(createdFrom) : null;
  const to = has(createdTo) ? parseHkDate(createdTo) : null;
  if (has(createdFrom) && !from) throw bad(`createdFrom "${String(createdFrom).slice(0, 20)}" isn't a valid date. Use YYYY-MM-DD.`);
  if (has(createdTo) && !to) throw bad(`createdTo "${String(createdTo).slice(0, 20)}" isn't a valid date. Use YYYY-MM-DD.`);
  const range = {};
  if (from) range.$gte = hkInstant(from.year, from.month, from.day);
  if (to) range.$lt = hkInstant(to.year, to.month, to.day + 1);
  if (from && to && range.$gte >= range.$lt) throw bad("createdFrom must be on or before createdTo.");
  return { createdAt: range };
}
