/*
 * GET /contacts/birthdays?days=7 (client feedback 26 Nov, C). Hong Kong "today"; archived contacts left
 * out; in non-leap years 29 Feb birthdays are shown on 28 Feb.
 */
import { Contact } from "../models/Contact.js";
import { AppError } from "../utils/AppError.js";
import { isLeap } from "../utils/birthday.js";
import { hkParts } from "../utils/hkTime.js";

const pad = (n) => String(n).padStart(2, "0");

export async function contactBirthdays(workspaceId, { days = 7, now = new Date() } = {}) {
  const span = days === undefined || days === null || days === "" ? 7 : Number(days);
  if (!Number.isInteger(span) || span < 0 || span > 31) throw new AppError("days must be a whole number from 0 to 31.", 400, "VALIDATION_ERROR");
  const { year, month, day } = hkParts(now);
  const base = Date.UTC(year, month - 1, day);

  // Each day in the window -> the "MM-DD" keys celebrated that day.
  const byKey = new Map(); // "MM-DD" -> { date, inDays }
  for (let i = 0; i <= span; i++) {
    const d = new Date(base + i * 86400000);
    const y = d.getUTCFullYear();
    const key = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const date = `${y}-${key}`;
    if (!byKey.has(key)) byKey.set(key, { date, inDays: i });
    if (key === "02-28" && !isLeap(y) && !byKey.has("02-29")) byKey.set("02-29", { date, inDays: i });
  }

  const contacts = await Contact.find({
    workspaceId,
    isArchived: { $ne: true },
    birthdayMonthDay: { $in: [...byKey.keys()] },
  })
    .select("firstName lastName email birthday birthdayMonthDay companyId")
    .populate("companyId", "name")
    .lean();

  const rows = contacts
    .map((c) => {
      const hit = byKey.get(c.birthdayMonthDay);
      const { birthdayMonthDay: _md, ...rest } = c;
      return { ...rest, nextBirthday: hit.date, inDays: hit.inDays };
    })
    .sort((a, b) => a.inDays - b.inDays || String(a.firstName || "").localeCompare(String(b.firstName || "")));

  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    today: rows.filter((r) => r.inDays === 0).map(({ nextBirthday: _n, inDays: _i, ...r }) => r),
    upcoming: rows,
  };
}
