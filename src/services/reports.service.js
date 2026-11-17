/*
 * Monthly / yearly report (feedback 17 Nov, #4): GET /reports/periodic.
 * Every metric is bucketed by calendar month in Asia/Hong_Kong. The response always lists every
 * month in from..to (zeros where there is no data); period=year sums the months per year.
 */
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { Invoice } from "../models/Invoice.js";
import { AppError } from "../utils/AppError.js";
import { HK_TZ, hkInstant } from "../utils/hkTime.js";

export const REPORT_METRICS = [
  "revenue", "roomRevenue", "roomHours", "bookings", "dayPasses",
  "newContacts", "newDeals", "dealsWon", "dealsWonValue", "dealsLost",
];
// What each number means; returned with the data so the screen can explain it.
export const METRIC_DEFINITIONS = {
  revenue: "Paid invoices: sum of total, by payment date.",
  roomRevenue: "Paid WordPress room bookings (live Stripe payments only, HKD), by booking date.",
  roomHours: "Hours of paid WordPress room bookings (live only), by booking date.",
  bookings: "Bookings starting in the month, excluding cancelled, expired and blocked time.",
  dayPasses: "Won day pass / day pass package deals (live payments only), by close date.",
  newContacts: "Contacts created.",
  newDeals: "Deals created.",
  dealsWon: "Deals won, by close date.",
  dealsWonValue: "Value of deals won, by close date.",
  dealsLost: "Deals lost, by close date.",
};

// Stripe test-mode purchases (metadata.isTest) never count.
const LIVE_DEALS = { "metadata.isTest": { $ne: true } };
const MONTH_RX = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 120;

function parseMonth(value, name) {
  const m = MONTH_RX.exec(String(value || ""));
  if (!m) throw new AppError(`${name} must be YYYY-MM.`, 400, "INVALID_PERIOD");
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** Month keys "YYYY-MM" from..to inclusive. */
function monthKeys(from, to) {
  const keys = [];
  for (let y = from.year, mo = from.month; y < to.year || (y === to.year && mo <= to.month); ) {
    keys.push(`${y}-${String(mo).padStart(2, "0")}`);
    if (++mo > 12) { mo = 1; y += 1; }
  }
  return keys;
}

const monthKeyOf = (field) => ({ $dateToString: { date: `$${field}`, format: "%Y-%m", timezone: HK_TZ } });

/** [{ _id: "YYYY-MM", ...sums }] → Map. */
async function grouped(Model, match, dateField, sums) {
  const rows = await Model.aggregate([
    { $match: match },
    { $group: { _id: monthKeyOf(dateField), ...sums } },
  ]);
  return new Map(rows.map((r) => [r._id, r]));
}

export async function periodicReport(workspaceId, { period = "month", from, to } = {}) {
  if (!["month", "year"].includes(period)) throw new AppError("period must be month or year.", 400, "INVALID_PERIOD");
  const f = parseMonth(from, "from");
  const t = parseMonth(to, "to");
  const keys = monthKeys(f, t);
  if (!keys.length) throw new AppError("from must not be after to.", 400, "INVALID_PERIOD");
  if (keys.length > MAX_MONTHS) throw new AppError(`At most ${MAX_MONTHS} months per request.`, 400, "INVALID_PERIOD");

  const ws = new mongoose.Types.ObjectId(String(workspaceId));
  const range = { $gte: hkInstant(f.year, f.month, 1), $lt: hkInstant(t.year, t.month + 1, 1) };
  const now = new Date();

  const [invoices, rooms, bookings, dayPasses, contacts, newDeals, closedDeals] = await Promise.all([
    grouped(Invoice, { workspaceId: ws, status: "paid", paidAt: range }, "paidAt", { revenue: { $sum: { $ifNull: ["$total", 0] } } }),
    grouped(
      Booking,
      { workspaceId: ws, externalRef: { $type: "string" }, "metadata.wp.status": "paid", "metadata.wp.payment.mode": "live", startAt: range },
      "startAt",
      { roomRevenue: { $sum: { $ifNull: ["$metadata.wp.payment.amount", 0] } }, roomHours: { $sum: { $ifNull: ["$metadata.wp.hours", 0] } } },
    ),
    grouped(
      Booking,
      {
        workspaceId: ws,
        startAt: range,
        bookingType: { $ne: "blocked" },
        status: { $nin: ["cancelled", "expired"] },
        // A hold whose time ran out counts as expired.
        $nor: [{ status: { $in: ["held", "pending_payment"] }, holdExpiresAt: { $lte: now } }],
      },
      "startAt",
      { bookings: { $sum: 1 } },
    ),
    grouped(Deal, { workspaceId: ws, ...LIVE_DEALS, status: "won", productType: { $in: ["day_pass", "day_pass_package"] }, closedAt: range }, "closedAt", { dayPasses: { $sum: 1 } }),
    grouped(Contact, { workspaceId: ws, createdAt: range }, "createdAt", { newContacts: { $sum: 1 } }),
    grouped(Deal, { workspaceId: ws, ...LIVE_DEALS, createdAt: range }, "createdAt", { newDeals: { $sum: 1 } }),
    grouped(Deal, { workspaceId: ws, ...LIVE_DEALS, status: { $in: ["won", "lost"] }, closedAt: range }, "closedAt", {
      dealsWon: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } },
      dealsWonValue: { $sum: { $cond: [{ $eq: ["$status", "won"] }, { $ifNull: ["$value", 0] }, 0] } },
      dealsLost: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, 1, 0] } },
    }),
  ]);

  const sources = [invoices, rooms, bookings, dayPasses, contacts, newDeals, closedDeals];
  const months = keys.map((key) => {
    const row = { key };
    for (const metric of REPORT_METRICS) row[metric] = 0;
    for (const source of sources) {
      const hit = source.get(key);
      if (hit) for (const metric of REPORT_METRICS) if (typeof hit[metric] === "number") row[metric] += hit[metric];
    }
    row.revenue = Math.round(row.revenue * 100) / 100;
    row.roomRevenue = Math.round(row.roomRevenue * 100) / 100;
    row.dealsWonValue = Math.round(row.dealsWonValue * 100) / 100;
    return row;
  });

  let periods = months;
  if (period === "year") {
    const years = new Map();
    for (const m of months) {
      const key = m.key.slice(0, 4);
      if (!years.has(key)) years.set(key, Object.fromEntries([["key", key], ...REPORT_METRICS.map((k) => [k, 0])]));
      const y = years.get(key);
      for (const metric of REPORT_METRICS) y[metric] = Math.round((y[metric] + m[metric]) * 100) / 100;
    }
    periods = [...years.values()];
  }
  return { period, from: keys[0], to: keys.at(-1), timezone: HK_TZ, currency: "HKD", definitions: METRIC_DEFINITIONS, periods };
}
