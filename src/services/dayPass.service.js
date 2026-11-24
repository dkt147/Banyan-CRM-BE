/*
 * Day pass credits (client meeting 25 Nov, §3). Replaces the front desk's Excel sheet.
 *
 *  - Unit: days in half-day steps (0.5). Per contact. Balance = sum of DayPassEntry.days.
 *  - purchase (+), redeem (-0.5 / -1, never below 0), adjust (admin, +/-, note required), refund (+).
 *  - Balance email on demand; low-balance email after a redeem that leaves <= 5 days, at most once a
 *    Hong Kong day per contact, never for TEST contacts, and never failing the redeem.
 *  - Emails go through the workspace Gmail (sendWorkspaceEmail) and are logged on the contact timeline.
 * Writes for one contact run one at a time in this process, so two clicks can't overdraw.
 */
import mongoose from "mongoose";
import { Activity } from "../models/Activity.js";
import { Contact } from "../models/Contact.js";
import { DayPassAccount } from "../models/DayPassAccount.js";
import { DayPassEntry } from "../models/DayPassEntry.js";
import { AppError } from "../utils/AppError.js";
import { hkToday, parseHkDate } from "../utils/hkTime.js";
import { sendWorkspaceEmail } from "./mail.service.js";

export const LOW_THRESHOLD = 5;
const MAX_ENTRIES = 200;

const chains = new Map();
function serial(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next);
  next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => {});
  return next;
}

const isHalfStep = (n) => Number.isFinite(n) && Math.round(n * 2) === n * 2;
const fmtDays = (n) => `${Number(n)} day${Number(n) === 1 ? "" : "s"}`;
const fmtDate = (ymd) => {
  const d = parseHkDate(ymd);
  return d ? new Date(Date.UTC(d.year, d.month - 1, d.day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
};
const isTestContact = (c) => /^test\b/i.test(String(c?.firstName || "").trim());

function toEntry(e) {
  return { id: String(e._id), type: e.type, days: e.days, amount: e.amount ?? null, date: e.date ?? null, note: e.note ?? null, by: e.by ?? null, at: e.at };
}

async function loadContact(workspaceId, contactId) {
  if (!mongoose.isValidObjectId(contactId)) throw new AppError("Contact not found.", 404, "NOT_FOUND");
  const contact = await Contact.findOne({ _id: contactId, workspaceId }).select("firstName lastName email isArchived").lean();
  if (!contact) throw new AppError("Contact not found.", 404, "NOT_FOUND");
  return contact;
}

async function sumBalance(workspaceId, contactId) {
  const [row] = await DayPassEntry.aggregate([
    { $match: { workspaceId: new mongoose.Types.ObjectId(String(workspaceId)), contactId: new mongoose.Types.ObjectId(String(contactId)) } },
    { $group: { _id: null, total: { $sum: "$days" } } },
  ]);
  return Math.round((row?.total || 0) * 2) / 2;
}

/** Recompute the cached balance from the entries. */
async function refreshAccount(workspaceId, contactId, extra = {}) {
  const balance = await sumBalance(workspaceId, contactId);
  return DayPassAccount.findOneAndUpdate(
    { workspaceId, contactId },
    { $set: { balance, ...extra } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

function actorName(user) {
  return user?.name || user?.email || "Staff";
}

/** GET /contacts/:id/day-passes */
export async function getDayPasses(workspaceId, contactId) {
  const contact = await loadContact(workspaceId, contactId);
  const [balance, account, entries] = await Promise.all([
    sumBalance(workspaceId, contact._id),
    DayPassAccount.findOne({ workspaceId, contactId: contact._id }).lean(),
    DayPassEntry.find({ workspaceId, contactId: contact._id }).sort({ at: -1, _id: -1 }).limit(MAX_ENTRIES).lean(),
  ]);
  return {
    balance,
    lowThreshold: LOW_THRESHOLD,
    autoEmail: true,
    lastUsedAt: account?.lastUsedAt || null,
    lastBalanceEmailAt: account?.lastBalanceEmailAt || null,
    lastLowBalanceEmailAt: account?.lastLowBalanceEmailAt || null,
    entries: entries.map(toEntry),
  };
}

/** POST /contacts/:id/day-passes/purchase { days (0.5-100), amount?, note? } */
export async function purchaseDayPasses(workspaceId, contactId, body = {}, user) {
  const contact = await loadContact(workspaceId, contactId);
  const days = Number(body.days);
  if (!isHalfStep(days) || days < 0.5 || days > 100)
    throw new AppError("days must be between 0.5 and 100, in half-day steps.", 400, "INVALID_DAYS");
  const amount = body.amount === undefined || body.amount === null || body.amount === "" ? null : Number(body.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000))
    throw new AppError("amount must be a positive number of HK dollars.", 400, "INVALID_AMOUNT");
  return serial(String(contact._id), async () => {
    const entry = await DayPassEntry.create({
      workspaceId, contactId: contact._id, type: "purchase", days, amount,
      note: body.note ? String(body.note).trim().slice(0, 500) || null : null, by: actorName(user), byId: user?._id || null,
    });
    const account = await refreshAccount(workspaceId, contact._id);
    return { balance: account.balance, entry: toEntry(entry) };
  });
}

/** POST /contacts/:id/day-passes/redeem { days: 0.5 | 1, date?, note? } */
export async function redeemDayPass(workspaceId, contactId, body = {}, user) {
  const contact = await loadContact(workspaceId, contactId);
  const days = Number(body.days);
  if (days !== 0.5 && days !== 1) throw new AppError("days must be 0.5 (half day) or 1 (full day).", 400, "INVALID_DAYS");
  const date = body.date ? String(body.date).trim() : hkToday();
  if (!parseHkDate(date)) throw new AppError("date must be YYYY-MM-DD.", 400, "INVALID_DATE");
  const result = await serial(String(contact._id), async () => {
    const before = await sumBalance(workspaceId, contact._id);
    if (before < days)
      throw new AppError(
        before > 0 ? `Only ${fmtDays(before)} left.` : "No day pass days left.",
        409, "INSUFFICIENT_DAY_PASSES", { balance: before, needed: days },
      );
    const entry = await DayPassEntry.create({
      workspaceId, contactId: contact._id, type: "redeem", days: -days, date,
      note: body.note ? String(body.note).trim().slice(0, 500) || null : null, by: actorName(user), byId: user?._id || null,
    });
    const prev = await DayPassAccount.findOne({ workspaceId, contactId: contact._id }).select("lastUsedDate").lean();
    const latest = !prev?.lastUsedDate || date >= prev.lastUsedDate;
    const account = await refreshAccount(workspaceId, contact._id, latest ? { lastUsedAt: new Date(), lastUsedDate: date } : {});
    return { balance: account.balance, entry: toEntry(entry) };
  });
  const lowBalanceEmail = result.balance <= LOW_THRESHOLD ? await sendLowBalanceEmail(workspaceId, contact, result.balance, user) : { status: "not_needed" };
  return { ...result, lowBalanceEmailSent: lowBalanceEmail.status === "sent", lowBalanceEmail };
}

/** POST /contacts/:id/day-passes/adjust { days (+/-, non-zero), note } (admin). */
export async function adjustDayPasses(workspaceId, contactId, body = {}, user) {
  const contact = await loadContact(workspaceId, contactId);
  const days = Number(body.days);
  if (!isHalfStep(days) || days === 0 || Math.abs(days) > 100)
    throw new AppError("days must be a non-zero number between -100 and 100, in half-day steps.", 400, "INVALID_DAYS");
  const note = String(body.note || "").trim();
  if (!note) throw new AppError("Add a note saying why the balance is adjusted.", 400, "NOTE_REQUIRED");
  return serial(String(contact._id), async () => {
    const before = await sumBalance(workspaceId, contact._id);
    if (before + days < 0)
      throw new AppError(`The balance can't go below 0 (it's ${fmtDays(before)}).`, 409, "INSUFFICIENT_DAY_PASSES", { balance: before, needed: -days });
    const entry = await DayPassEntry.create({
      workspaceId, contactId: contact._id, type: "adjust", days, note: note.slice(0, 500), by: actorName(user), byId: user?._id || null,
    });
    const account = await refreshAccount(workspaceId, contact._id);
    return { balance: account.balance, entry: toEntry(entry) };
  });
}

/* ---------- emails ---------- */

function balanceEmail(contact, balance, lastUsedDate) {
  const hi = `Hi ${contact.firstName || "there"},`;
  const last = fmtDate(lastUsedDate);
  const text = [
    hi,
    "",
    `You have ${fmtDays(balance)} left on your Banyan Workspace day pass.${last ? ` Your last visit was on ${last}.` : ""} See you soon!`,
    "",
    "The Banyan team",
  ].join("\n");
  const html = `<p>${escapeHtml(hi)}</p><p>You have <strong>${escapeHtml(fmtDays(balance))}</strong> left on your Banyan Workspace day pass.${last ? ` Your last visit was on ${escapeHtml(last)}.` : ""} See you soon!</p><p>The Banyan team</p>`;
  return { subject: "Your Banyan day pass balance", text, html };
}

function lowBalanceEmail(contact, balance) {
  const hi = `Hi ${contact.firstName || "there"},`;
  const empty = balance <= 0;
  const line = empty ? "Your day pass has no days left." : `You have ${fmtDays(balance)} left on your day pass.`;
  const lineHtml = empty ? "Your day pass has <strong>no days left</strong>." : `You have <strong>${escapeHtml(fmtDays(balance))}</strong> left on your day pass.`;
  const topUp = "To top up with a new 10-day package, just reply to this email or ask at the front desk.";
  return {
    subject: empty ? "Your Banyan day pass has no days left" : "Your Banyan day pass is running low",
    text: [hi, "", `${line} ${topUp}`, "", "The Banyan team"].join("\n"),
    html: `<p>${escapeHtml(hi)}</p><p>${lineHtml} ${topUp}</p><p>The Banyan team</p>`,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function logEmail(workspaceId, contact, subject, user, kind) {
  await Activity.create({
    workspaceId, userId: user._id, type: "email", contactId: contact._id, subject,
    body: `Sent to ${contact.email}.`, occurredAt: new Date(), metadata: { trigger: kind, automatic: kind === "day_pass_low_balance" },
  }).catch((error) => console.error("[day-pass] activity failed:", error.message));
}

/** POST /contacts/:id/day-passes/email-balance */
export async function emailDayPassBalance(workspaceId, contactId, user) {
  const contact = await loadContact(workspaceId, contactId);
  if (!String(contact.email || "").trim()) throw new AppError("This contact has no email address.", 400, "NO_EMAIL");
  const [balance, account] = await Promise.all([
    sumBalance(workspaceId, contact._id),
    DayPassAccount.findOne({ workspaceId, contactId: contact._id }).select("lastUsedDate").lean(),
  ]);
  const mail = balanceEmail(contact, balance, account?.lastUsedDate);
  let sent;
  try {
    sent = await sendWorkspaceEmail(workspaceId, { to: contact.email, ...mail, label: "Day pass balance email" });
  } catch (error) {
    throw new AppError(`The email couldn't be sent: ${String(error.message).slice(0, 200)}`, 502, "EMAIL_FAILED");
  }
  if (!sent) throw new AppError("Gmail isn't connected, so the email couldn't be sent. Connect it in Integrations.", 503, "EMAIL_NOT_CONFIGURED");
  const sentAt = new Date();
  await DayPassAccount.updateOne({ workspaceId, contactId: contact._id }, { $set: { lastBalanceEmailAt: sentAt } }, { upsert: true });
  await logEmail(workspaceId, contact, mail.subject, user, "day_pass_balance");
  return { sentAt };
}

/** After a redeem that leaves <= LOW_THRESHOLD. Never throws. Returns { status, reason? }. */
async function sendLowBalanceEmail(workspaceId, contact, balance, user) {
  try {
    if (isTestContact(contact)) return { status: "skipped", reason: "Test contact (first name starts with TEST)." };
    if (!String(contact.email || "").trim()) return { status: "skipped", reason: "No email address." };
    const account = await DayPassAccount.findOne({ workspaceId, contactId: contact._id }).select("lastLowBalanceEmailAt").lean();
    if (account?.lastLowBalanceEmailAt && hkToday(account.lastLowBalanceEmailAt) === hkToday())
      return { status: "skipped", reason: "Already sent today." };
    const mail = lowBalanceEmail(contact, balance);
    const sent = await sendWorkspaceEmail(workspaceId, { to: contact.email, ...mail, label: "Day pass low balance email" });
    if (!sent) return { status: "failed", reason: "Gmail isn't connected." };
    await DayPassAccount.updateOne({ workspaceId, contactId: contact._id }, { $set: { lastLowBalanceEmailAt: new Date() } });
    await logEmail(workspaceId, contact, mail.subject, user, "day_pass_low_balance");
    return { status: "sent" };
  } catch (error) {
    console.error("[day-pass] low balance email failed:", error.message);
    return { status: "failed", reason: String(error.message).slice(0, 200) };
  }
}

/* ---------- front desk list ---------- */

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** GET /day-passes?search=&low=true&page=&limit= */
export async function listDayPasses(workspaceId, q = {}) {
  const page = Math.max(Number(q.page) || 1, 1);
  const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
  const match = { workspaceId: new mongoose.Types.ObjectId(String(workspaceId)) };
  if (String(q.low) === "true") match.balance = { $lte: LOW_THRESHOLD };
  const contactMatch = { "contact.isArchived": { $ne: true } };
  const terms = String(q.search || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (terms.length)
    contactMatch.$and = terms.map((t) => {
      const rx = new RegExp(escapeRx(t), "i");
      return { $or: [{ "contact.firstName": rx }, { "contact.lastName": rx }, { "contact.email": rx }] };
    });
  const [out] = await DayPassAccount.aggregate([
    { $match: match },
    { $lookup: { from: Contact.collection.name, localField: "contactId", foreignField: "_id", as: "contact" } },
    { $unwind: "$contact" },
    { $match: contactMatch },
    { $sort: { balance: 1, "contact.firstName": 1, "contact.lastName": 1, _id: 1 } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        total: [{ $count: "n" }],
      },
    },
  ]);
  const total = out?.total?.[0]?.n || 0;
  return {
    items: (out?.items || []).map((a) => ({
      contact: { _id: a.contact._id, firstName: a.contact.firstName, lastName: a.contact.lastName, email: a.contact.email },
      balance: a.balance,
      lowThreshold: LOW_THRESHOLD,
      lastUsedAt: a.lastUsedAt || null,
      lastBalanceEmailAt: a.lastBalanceEmailAt || null,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}
