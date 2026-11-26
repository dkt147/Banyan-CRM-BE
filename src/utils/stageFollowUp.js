import { AppError } from "./AppError.js";
import { hkInstant, hkParts } from "./hkTime.js";

/*
 * Follow-up task per pipeline stage (27 Nov b, C). Off by default; only "Quote sent" is on (3 days).
 * A stage without a stored followUp (before the migration runs) behaves as the migration would set it.
 */
export const QUOTE_SENT_RX = /quote sent/i;

export function defaultFollowUp(stageName) {
  return QUOTE_SENT_RX.test(String(stageName || ""))
    ? { enabled: true, dueInDays: 3, title: "Quote follow-up: {deal}" }
    : { enabled: false, dueInDays: 1, title: "" };
}

export function effectiveFollowUp(stage) {
  const f = stage?.followUp;
  if (f && typeof f === "object" && "enabled" in f) {
    return { enabled: Boolean(f.enabled), dueInDays: Number.isFinite(Number(f.dueInDays)) ? Number(f.dueInDays) : 1, title: String(f.title || "") };
  }
  return defaultFollowUp(stage?.name);
}

/** Request body -> stored followUp, or undefined when not sent. 400 INVALID_FOLLOW_UP when bad. */
export function parseFollowUp(input, current) {
  if (input === undefined) return undefined;
  const bad = (msg) => new AppError(msg, 400, "INVALID_FOLLOW_UP");
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw bad("followUp must be an object { enabled, dueInDays, title }.");
  const base = current || { enabled: false, dueInDays: 1, title: "" };
  const enabled = input.enabled === undefined ? Boolean(base.enabled) : input.enabled;
  if (typeof enabled !== "boolean") throw bad("followUp.enabled must be true or false.");
  const dueInDays = input.dueInDays === undefined ? Number(base.dueInDays ?? 1) : Number(input.dueInDays);
  if (!Number.isInteger(dueInDays) || dueInDays < 0 || dueInDays > 60) throw bad("followUp.dueInDays must be a whole number from 0 to 60.");
  const title = input.title === undefined || input.title === null ? String(base.title || "") : input.title;
  if (typeof title !== "string" || title.trim().length > 150) throw bad("followUp.title can be at most 150 characters.");
  return { enabled, dueInDays, title: title.trim() };
}

/**
 * Due date: dueInDays days later at 10:00 HK. With 0 days: today at the next full hour, or 18:00 HK if
 * that's later.
 */
export function followUpDueAt(dueInDays, now = new Date()) {
  const { year, month, day } = hkParts(now);
  if (dueInDays > 0) return hkInstant(year, month, day + dueInDays, 10, 0);
  const nextHour = new Date(Math.floor(now.getTime() / 3600000) * 3600000 + 3600000);
  const six = hkInstant(year, month, day, 18, 0);
  return nextHour > six ? nextHour : six;
}
