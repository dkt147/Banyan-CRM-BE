/*
 * Meeting room credits per company per month (client meeting 19 Nov, §5).
 *  - Allowance: Company.meetingRoomCreditHours (hours per Hong Kong month; 1 credit = 1 hour).
 *  - Ledger (models/CreditLedger.js): "use" when staff book with credits, "refund" when that booking
 *    is cancelled (CRM or WP Admin), "adjust" for one-off top-ups or corrections (+/-).
 *  - Month = the month of the booking date (Hong Kong). No roll-over: each month starts again.
 * Credit bookings are created in WordPress as confirmed, no-payment bookings (WP handoff §3).
 */
import crypto from "node:crypto";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Booking } from "../models/Booking.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { CreditLedger } from "../models/CreditLedger.js";
import { AppError } from "../utils/AppError.js";
import { hkInstant, hkParts } from "../utils/hkTime.js";
import {
  CRM_NOTES_PREFIX,
  WP_ROOMS,
  WP_SYNC_NOT_CONFIGURED_MESSAGE,
  getWpBookingContext,
  syncWpRef,
  toRoomBookingRow,
  upsertWpBooking,
} from "./wpRoomBooking.service.js";

export const MONTH_RX = /^\d{4}-(0[1-9]|1[0-2])$/;
export function currentMonth(now = new Date()) {
  const { year, month } = hkParts(now);
  return `${year}-${String(month).padStart(2, "0")}`;
}
function parseMonth(value) {
  if (value == null || value === "") return currentMonth();
  if (!MONTH_RX.test(String(value))) throw new AppError("month must be YYYY-MM.", 400, "INVALID_MONTH");
  return String(value);
}
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const round = (n) => Math.round(n * 100) / 100;

/** { allowance, adjustments, used, remaining } from a company and its ledger rows for one month. */
function summarise(company, rows) {
  let used = 0;
  let adjustments = 0;
  for (const r of rows) {
    if (r.type === "use") used += r.hours;
    else if (r.type === "refund") used -= r.hours;
    else if (r.type === "adjust") adjustments += r.hours;
  }
  const allowance = Number(company.meetingRoomCreditHours) || 0;
  return { allowance, adjustments: round(adjustments), used: round(used), remaining: round(allowance + adjustments - used) };
}

/**
 * Month (YYYY-MM, HK) of the company's next credit booking from today on that isn't cancelled, or null.
 * The credits card opens on it when the current month has no entries (24 Nov retest).
 */
async function nextCreditBookingMonth(workspaceId, companyId) {
  const [uses, refunds] = await Promise.all([
    CreditLedger.find({ workspaceId, companyId, type: "use", bookingRef: { $type: "string" } }).select("bookingRef").lean(),
    CreditLedger.find({ workspaceId, companyId, type: "refund", bookingRef: { $type: "string" } }).select("bookingRef").lean(),
  ]);
  const refunded = new Set(refunds.map((r) => r.bookingRef));
  const refs = uses.map((u) => u.bookingRef).filter((ref) => !refunded.has(ref));
  if (!refs.length) return null;
  const today = hkParts(new Date());
  const next = await Booking.findOne({
    workspaceId,
    externalRef: { $in: refs },
    status: { $nin: ["cancelled", "refunded", "expired"] },
    startAt: { $gte: hkInstant(today.year, today.month, today.day) },
  })
    .sort({ startAt: 1 })
    .select("startAt")
    .lean();
  return next ? currentMonth(next.startAt) : null;
}

/** GET /companies/:id/credits?month=YYYY-MM */
export async function companyCredits(workspaceId, companyId, monthValue) {
  const month = parseMonth(monthValue);
  const company = await Company.findOne({ _id: companyId, workspaceId }).select("name meetingRoomCreditHours").lean();
  if (!company) throw new AppError("Company not found.", 404, "NOT_FOUND");
  const rows = await CreditLedger.find({ workspaceId, companyId: company._id, month }).sort({ at: 1 }).lean();
  return {
    company: { id: String(company._id), name: company.name },
    month,
    nextBookingMonth: await nextCreditBookingMonth(workspaceId, company._id),
    ...summarise(company, rows),
    entries: rows.map((r) => ({
      id: String(r._id), at: r.at, type: r.type, hours: r.hours, bookingRef: r.bookingRef, room: r.room, by: r.by, note: r.note,
    })),
  };
}

/** GET /credits?month=YYYY-MM: companies with an allowance (or ledger rows that month). */
export async function creditsOverview(workspaceId, monthValue) {
  const month = parseMonth(monthValue);
  const rows = await CreditLedger.find({ workspaceId, month }).lean();
  const byCompany = new Map();
  for (const r of rows) {
    const k = String(r.companyId);
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k).push(r);
  }
  const companies = await Company.find({
    workspaceId,
    $or: [{ meetingRoomCreditHours: { $gt: 0 }, isArchived: { $ne: true } }, { _id: { $in: [...byCompany.keys()].map(oid) } }],
  })
    .select("name meetingRoomCreditHours")
    .sort({ name: 1 })
    .lean();
  const items = companies.map((c) => ({ company: { id: String(c._id), name: c.name }, ...summarise(c, byCompany.get(String(c._id)) || []) }));
  return { month, items };
}

/** POST /companies/:id/credits/adjust { hours, note, month? } (admin). */
export async function adjustCredits(workspaceId, companyId, { hours, note, month: monthValue }, user) {
  const month = parseMonth(monthValue);
  const h = Number(hours);
  if (!Number.isFinite(h) || h === 0 || Math.abs(h) > 500 || Math.round(h * 2) !== h * 2)
    throw new AppError("hours must be a non-zero number of hours (halves allowed), between -500 and 500.", 400, "INVALID_HOURS");
  const text = String(note || "").trim();
  if (!text) throw new AppError("Add a note saying why the credits are adjusted.", 400, "NOTE_REQUIRED");
  const company = await Company.findOne({ _id: companyId, workspaceId }).select("_id").lean();
  if (!company) throw new AppError("Company not found.", 404, "NOT_FOUND");
  await CreditLedger.create({ workspaceId, companyId: company._id, month, type: "adjust", hours: h, by: user?.name || "Staff", note: text.slice(0, 500) });
  return companyCredits(workspaceId, company._id, month);
}

/** Give the hours back when a credit booking is cancelled. Idempotent (one refund per booking). */
export async function refundCreditsForBooking(workspaceId, ref, by = null) {
  const use = await CreditLedger.findOne({ workspaceId, bookingRef: ref, type: "use" }).lean();
  if (!use) return null;
  try {
    return await CreditLedger.create({
      workspaceId, companyId: use.companyId, month: use.month, type: "refund", hours: use.hours, bookingRef: ref,
      creditRef: use.creditRef, room: use.room, contactId: use.contactId, by: by || "WordPress", note: "Booking cancelled",
    });
  } catch (error) {
    if (error?.code === 11000) return null; // already refunded
    throw error;
  }
}

// One credit booking at a time per company in this process, so two staff can't overspend together.
const chains = new Map();
function serial(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next);
  next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => {});
  return next;
}

const hh = (n) => `${String(n).padStart(2, "0")}:00`;

/**
 * POST /room-bookings/credit-booking { room, date, start, hours, contactId, notes }.
 * Checks the contact's company has enough credits for the booking's month, asks WordPress for a
 * confirmed no-payment booking (same clash checks; 409 passed through), records "use", returns the row.
 */
export async function createCreditBooking(workspaceId, input, user) {
  if (!env.BANYAN_CRM_TOKEN) throw new AppError(WP_SYNC_NOT_CONFIGURED_MESSAGE, 503, "WP_BOOKING_NOT_CONFIGURED");
  const room = WP_ROOMS.find((r) => r.key === input.room);
  if (!room) throw new AppError("room must be small, medium or library.", 400, "INVALID_ROOM");
  const contact = await Contact.findOne({ _id: input.contactId, workspaceId }).select("firstName lastName email phone companyId").lean();
  if (!contact) throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  if (!contact.companyId) throw new AppError("This contact isn't linked to a company, so they have no meeting room credits.", 400, "CONTACT_HAS_NO_COMPANY");
  if (!contact.email) throw new AppError("The contact needs an email address for the booking confirmation.", 400, "CONTACT_EMAIL_REQUIRED");
  const company = await Company.findOne({ _id: contact.companyId, workspaceId }).select("name meetingRoomCreditHours").lean();
  if (!company) throw new AppError("The contact's company was not found.", 404, "NOT_FOUND");
  const month = input.date.slice(0, 7);
  const staff = user?.name || "Staff";

  return serial(String(company._id), async () => {
    const credits = await companyCredits(workspaceId, company._id, month);
    if (input.hours > credits.remaining)
      throw new AppError(
        `${company.name} has ${credits.remaining} meeting room credit${credits.remaining === 1 ? "" : "s"} left for ${month}; this booking needs ${input.hours}.`,
        409,
        "INSUFFICIENT_CREDITS",
        { remaining: credits.remaining, needed: input.hours, month },
      );

    const creditRef = `CR-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const prefix = `${CRM_NOTES_PREFIX} by ${staff}`;
    const notes = String(input.notes || "").trim();
    let res;
    try {
      res = await fetch(new URL("bookings/credit", env.BANYAN_WP_API_URL), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-Banyan-Token": env.BANYAN_CRM_TOKEN },
        body: JSON.stringify({
          room: room.key, date: input.date, start: hh(input.start), hours: input.hours,
          first_name: contact.firstName || "", last_name: contact.lastName || "", email: contact.email, phone: contact.phone || "",
          notes: (notes ? `${prefix} – ${notes}` : prefix).slice(0, 1000),
          company: company.name, booked_by: `${staff} (CRM)`, credit_ref: creditRef,
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      throw new AppError(`WordPress is unreachable: ${error.message}`, 502, "WP_BOOKING_UNREACHABLE");
    }
    const json = await res.json().catch(() => ({}));
    if (res.status === 404 && json?.code === "rest_no_route")
      throw new AppError("The website plugin can't make credit bookings yet (needs the credits update).", 501, "WP_CREDITS_UNSUPPORTED");
    if (!res.ok) throw new AppError(json?.message || `WordPress returned ${res.status}.`, [400, 409].includes(res.status) ? res.status : 502, "WP_CREDIT_BOOKING_FAILED");

    // WordPress returns the booking in the GET /bookings/{ref} shape (or a list of one).
    const payload = json?.booking ? json : json?.bookings?.[0] || json?.data || null;
    const ref = payload?.booking?.ref || json?.ref;
    if (!ref) throw new AppError("WordPress didn't return the booking reference.", 502, "WP_CREDIT_BOOKING_FAILED");
    const context = await getWpBookingContext();
    let booking;
    try {
      ({ booking } = await upsertWpBooking(payload, { origin: "snapshot", event: "booking.credit", context }));
    } catch {
      await syncWpRef(ref).catch((error) => console.error("[credits] sync after credit booking:", error.message));
      booking = await Booking.findOne({ workspaceId, externalRef: ref }).lean();
    }
    // The booking belongs to the contact staff chose, even if another contact shares the email.
    if (booking && (String(booking.contactId) !== String(contact._id) || String(booking.companyId) !== String(company._id))) {
      await Booking.updateOne({ _id: booking._id }, { $set: { contactId: contact._id, companyId: company._id } });
    }
    await CreditLedger.create({
      workspaceId, companyId: company._id, month, type: "use", hours: input.hours, bookingRef: ref, creditRef,
      room: room.key, contactId: contact._id, by: staff, note: notes.slice(0, 500) || null,
    }).catch((error) => {
      if (error?.code !== 11000) throw error; // already recorded
    });
    const fresh = await Booking.findOne({ workspaceId, externalRef: ref }).populate("contactId", "firstName lastName email phone").lean();
    return { booking: fresh ? toRoomBookingRow(fresh) : { ref }, credits: await companyCredits(workspaceId, company._id, month) };
  });
}
