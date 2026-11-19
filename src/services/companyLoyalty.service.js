/*
 * Company loyalty tiers by spend (client meeting 19 Nov, §6). Separate from memberships and from the
 * per-contact points system (unchanged).
 *
 * spend12m = paid, live revenue in the current Hong Kong month and the 11 months before it:
 *   - WordPress room bookings paid by card (live mode; credit bookings are HK$0), by payment date;
 *   - won day pass / day pass package deals (Stripe Payment Links, live), by close date;
 *   - paid invoices, by paid date.
 * A record counts for a company through its own companyId, else its contact's company.
 * Tier = the active LoyaltyTier with the highest minSpend <= spend12m.
 */
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { Invoice } from "../models/Invoice.js";
import { LoyaltyTier } from "../models/LoyaltyTier.js";
import { AppError } from "../utils/AppError.js";
import { hkInstant, hkParts } from "../utils/hkTime.js";
import { escapeRegex } from "../utils/phone.js";

// Placeholders until the client agrees names and thresholds; only created when no tier exists.
export const PLACEHOLDER_TIERS = [
  { name: "Member", minSpend: 0, benefits: [], sortOrder: 1 },
  { name: "Silver", minSpend: 10000, benefits: ["Priority booking"], sortOrder: 2 },
  { name: "Gold", minSpend: 30000, benefits: ["Priority booking"], sortOrder: 3 },
];

export async function ensureTiers(workspaceId) {
  if (await LoyaltyTier.exists({ workspaceId })) return;
  await LoyaltyTier.insertMany(PLACEHOLDER_TIERS.map((t) => ({ ...t, workspaceId })), { ordered: false }).catch((error) => {
    if (error?.code !== 11000 && !error?.writeErrors) throw error; // created at the same time elsewhere
  });
}

async function activeTiers(workspaceId) {
  await ensureTiers(workspaceId);
  return LoyaltyTier.find({ workspaceId, isActive: { $ne: false } }).sort({ minSpend: 1 }).lean();
}

/** The 12 Hong Kong months ending with the current one: [{ key: "YYYY-MM" }], window [start, end). */
export function spendWindow(now = new Date()) {
  const { year, month } = hkParts(now);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return { months, start: hkInstant(year, month - 11, 1), end: hkInstant(year, month + 1, 1) };
}
const monthKey = (instant) => {
  const { year, month } = hkParts(instant);
  return `${year}-${String(month).padStart(2, "0")}`;
};

/** Map companyId -> { total, byMonth: { "YYYY-MM": amount } } for the 12-month window. */
export async function companySpend(workspaceId, { companyIds = null, now = new Date() } = {}) {
  const ws = new mongoose.Types.ObjectId(String(workspaceId));
  const { months, start, end } = spendWindow(now);
  const range = { $gte: start, $lt: end };
  const [contacts, rooms, dayPasses, invoices] = await Promise.all([
    Contact.find({ workspaceId: ws, companyId: { $ne: null } }).select("_id companyId").lean(),
    Booking.find({
      workspaceId: ws, externalRef: { $type: "string" }, "metadata.wp.status": "paid", "metadata.wp.payment.mode": "live",
      "metadata.wp.payment.method": { $ne: "credits" },
    }).select("contactId companyId createdAt metadata.wp.payment").lean(),
    Deal.find({ workspaceId: ws, "metadata.isTest": { $ne: true }, status: "won", productType: { $in: ["day_pass", "day_pass_package"] }, closedAt: range })
      .select("contactId companyId closedAt value").lean(),
    Invoice.find({ workspaceId: ws, status: "paid", paidAt: range, "metadata.isTest": { $ne: true } }).select("contactId companyId paidAt total").lean(),
  ]);
  const contactCompany = new Map(contacts.map((c) => [String(c._id), String(c.companyId)]));
  const wanted = companyIds ? new Set(companyIds.map(String)) : null;
  const out = new Map();
  const add = (row, at, amount) => {
    const company = row.companyId ? String(row.companyId) : contactCompany.get(String(row.contactId));
    if (!company || !amount || (wanted && !wanted.has(company))) return;
    if (!(at >= start && at < end)) return;
    if (!out.has(company)) out.set(company, { total: 0, byMonth: Object.fromEntries(months.map((m) => [m, 0])) });
    const s = out.get(company);
    const k = monthKey(at);
    s.total = Math.round((s.total + amount) * 100) / 100;
    if (k in s.byMonth) s.byMonth[k] = Math.round((s.byMonth[k] + amount) * 100) / 100;
  };
  for (const b of rooms) {
    const p = b.metadata.wp.payment || {};
    add(b, p.paidAt ? new Date(p.paidAt) : b.createdAt, Number(p.amount) || 0);
  }
  for (const d of dayPasses) add(d, d.closedAt, Number(d.value) || 0);
  for (const i of invoices) add(i, i.paidAt, Number(i.total) || 0);
  return { months, map: out };
}

function tierFor(tiers, spend) {
  let tier = null;
  let next = null;
  for (const t of tiers) {
    if (spend >= (t.minSpend || 0)) tier = t;
    else if (!next) next = t;
  }
  return {
    tier: tier ? { id: String(tier._id), name: tier.name, benefits: tier.benefits || [], minSpend: tier.minSpend } : null,
    nextTier: next ? { id: String(next._id), name: next.name, minSpend: next.minSpend } : null,
    toNextTier: next ? Math.round((next.minSpend - spend) * 100) / 100 : null,
  };
}

/** GET /loyalty/companies?search=&tier=&page=&limit= (sorted by spend12m, highest first). */
export async function companyLoyaltyList(workspaceId, { search, tier, page = 1, limit = 25 } = {}) {
  const tiers = await activeTiers(workspaceId);
  const filter = { workspaceId, isArchived: { $ne: true } };
  if (search) filter.name = { $regex: escapeRegex(String(search).trim().slice(0, 100)), $options: "i" };
  const companies = await Company.find(filter).select("name").lean();
  const { map } = await companySpend(workspaceId, { companyIds: companies.map((c) => c._id) });
  let items = companies.map((c) => {
    const spend12m = map.get(String(c._id))?.total || 0;
    return { company: { id: String(c._id), name: c.name }, spend12m, ...tierFor(tiers, spend12m) };
  });
  if (tier) {
    const t = String(tier).toLowerCase();
    items = items.filter((i) => i.tier && (i.tier.id === String(tier) || i.tier.name.toLowerCase() === t));
  }
  items.sort((a, b) => b.spend12m - a.spend12m || a.company.name.localeCompare(b.company.name));
  const p = Math.max(Number(page) || 1, 1);
  const l = Math.min(Math.max(Number(limit) || 25, 1), 100);
  return {
    items: items.slice((p - 1) * l, p * l),
    tiers: tiers.map((t) => ({ id: String(t._id), name: t.name, minSpend: t.minSpend, benefits: t.benefits || [] })),
    currency: "HKD",
    pagination: { page: p, limit: l, total: items.length, pages: Math.ceil(items.length / l) },
  };
}

/** GET /companies/:id/loyalty: tier, next tier and monthly spend for the last 12 months. */
export async function companyLoyalty(workspaceId, companyId) {
  const company = await Company.findOne({ _id: companyId, workspaceId }).select("name").lean();
  if (!company) throw new AppError("Company not found.", 404, "NOT_FOUND");
  const tiers = await activeTiers(workspaceId);
  const { months, map } = await companySpend(workspaceId, { companyIds: [company._id] });
  const s = map.get(String(company._id));
  const spend12m = s?.total || 0;
  return {
    company: { id: String(company._id), name: company.name },
    spend12m,
    ...tierFor(tiers, spend12m),
    currency: "HKD",
    monthly: months.map((m) => ({ month: m, spend: s?.byMonth[m] || 0 })),
  };
}
