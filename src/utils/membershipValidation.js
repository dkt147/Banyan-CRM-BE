import { AppError } from "./AppError.js";

/*
 * /memberships create and update checks (focused test 27 Nov, F3). 422 with a plain message.
 *   - seats: a whole number from 1 to 500
 *   - monthlyValue: 0 or more
 *   - renewalAt and endAt: valid dates, not before startAt (stored values count on update)
 * Only fields sent in the request are checked, so an unrelated update (e.g. status) is never
 * blocked by older data.
 */
const fail = (message) => new AppError(message, 422, "INVALID_MEMBERSHIP");
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const blank = (v) => v === null || v === undefined || v === "";

const LABELS = { startAt: "start date", renewalAt: "renewal date", endAt: "end date" };

function toDate(value, key) {
  if (blank(value)) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw fail(`The ${LABELS[key]} isn't a valid date.`);
  return d;
}

export function validateMembership(payload = {}, existing = null) {
  if (has(payload, "seats")) {
    const n = typeof payload.seats === "string" && payload.seats.trim() !== "" ? Number(payload.seats) : payload.seats;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 500)
      throw fail("Seats must be a whole number from 1 to 500.");
  }
  if (has(payload, "monthlyValue")) {
    const v = typeof payload.monthlyValue === "string" && payload.monthlyValue.trim() !== "" ? Number(payload.monthlyValue) : payload.monthlyValue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw fail("Monthly value must be 0 or more.");
  }
  if (!["startAt", "renewalAt", "endAt"].some((k) => has(payload, k))) return;
  const pick = (k) => toDate(has(payload, k) ? payload[k] : existing?.[k], k);
  const start = pick("startAt");
  const renewal = pick("renewalAt");
  const end = pick("endAt");
  if (start && renewal && renewal < start) throw fail("The renewal date can't be before the start date.");
  if (start && end && end < start) throw fail("The end date can't be before the start date.");
}
