/*
 * GET /reports/breakdown (client meeting 19 Nov, §4):
 *   by=revenue|leadSource|enquiryType, period=week|month, from/to=YYYY-MM-DD (Hong Kong dates).
 * Weeks start on Monday. Every period and every category is present (0 when empty).
 * Stripe test-mode payments and test contacts never count.
 */
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { Form } from "../models/Form.js";
import { FormSubmission } from "../models/FormSubmission.js";
import { Invoice } from "../models/Invoice.js";
import { Pipeline } from "../models/Pipeline.js";
import { AppError } from "../utils/AppError.js";
import { HK_TZ, hkInstant } from "../utils/hkTime.js";

const DAY_MS = 86400000;
const HK_OFFSET_MS = 8 * 3600000;
const DATE_RX = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_PERIODS = { week: 53, month: 36 };

/* ---------- periods ---------- */
function parseDate(value, name) {
  const m = DATE_RX.exec(String(value || ""));
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!d || d.getUTCDate() !== +m[3]) throw new AppError(`${name} must be a date like 2026-11-19.`, 400, "INVALID_PERIOD");
  return d; // UTC midnight standing for the Hong Kong calendar day
}
const ymd = (d) => d.toISOString().slice(0, 10);
/** Hong Kong calendar day of an instant, as a UTC-midnight Date. */
const hkDay = (instant) => {
  const s = new Date(new Date(instant).getTime() + HK_OFFSET_MS);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
};
const mondayOf = (d) => new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
const label = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

export function buildPeriods(period, fromValue, toValue) {
  if (!["week", "month"].includes(period)) throw new AppError("period must be week or month.", 400, "INVALID_PERIOD");
  const from = parseDate(fromValue, "from");
  const to = parseDate(toValue, "to");
  if (from > to) throw new AppError("from must not be after to.", 400, "INVALID_PERIOD");
  const periods = [];
  if (period === "week") {
    for (let s = mondayOf(from); s <= to; s = new Date(s.getTime() + 7 * DAY_MS)) {
      const e = new Date(s.getTime() + 6 * DAY_MS);
      periods.push({ key: ymd(s), label: `Week of ${label(s)}`, from: ymd(s), to: ymd(e) });
      if (periods.length > MAX_PERIODS.week) break;
    }
  } else {
    for (let y = from.getUTCFullYear(), m = from.getUTCMonth(); Date.UTC(y, m, 1) <= to.getTime(); m === 11 ? ((m = 0), y++) : m++) {
      const e = new Date(Date.UTC(y, m + 1, 0));
      periods.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MONTHS[m]} ${y}`, from: `${y}-${String(m + 1).padStart(2, "0")}-01`, to: ymd(e) });
      if (periods.length > MAX_PERIODS.month) break;
    }
  }
  if (periods.length > MAX_PERIODS[period])
    throw new AppError(`At most ${MAX_PERIODS[period]} ${period}s per request.`, 400, "INVALID_PERIOD");
  // Whole periods: the first week/month starts before `from` when needed.
  const start = parseDate(periods[0].from, "from");
  const end = parseDate(periods.at(-1).to, "to");
  const range = { $gte: hkInstant(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()), $lt: hkInstant(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate() + 1) };
  const keyOf = (instant) => {
    if (!instant) return null;
    const d = hkDay(instant);
    return period === "week" ? ymd(mondayOf(d)) : ymd(d).slice(0, 7);
  };
  return { periods, range, keyOf };
}

function table(periods, categories) {
  const rows = Object.fromEntries(periods.map((p) => [p.key, Object.fromEntries(categories.map((c) => [c.key, 0]))]));
  const totals = Object.fromEntries(categories.map((c) => [c.key, 0]));
  const add = (periodKey, cat, amount) => {
    if (!rows[periodKey] || !(cat in totals) || !amount) return;
    rows[periodKey][cat] = Math.round((rows[periodKey][cat] + amount) * 100) / 100;
    totals[cat] = Math.round((totals[cat] + amount) * 100) / 100;
  };
  return { rows, totals, add };
}

/* ---------- revenue ---------- */
export const REVENUE_CATEGORIES = [
  { key: "meeting_rooms", label: "Meeting rooms" },
  { key: "day_passes", label: "Day passes" },
  { key: "coworking", label: "Coworking" },
  { key: "private_office", label: "Serviced offices" },
  { key: "virtual_office", label: "Virtual office" },
  { key: "events", label: "Events & venue hire" },
  { key: "podcast", label: "Podcast studio" },
  { key: "other", label: "Other" },
];
const PRODUCT_TO_REVENUE = {
  membership: "coworking",
  private_office: "private_office",
  virtual_office: "virtual_office",
  venue_hire: "events",
  event_space: "events",
  photoshoot: "events",
  podcast: "podcast",
  studio: "podcast",
  meeting_room: "meeting_rooms",
  day_pass: "day_passes",
  day_pass_package: "day_passes",
};
const PIPELINE_TO_REVENUE = { membership: "coworking", "private-office": "private_office", "virtual-office": "virtual_office", "venue-hire": "events" };

async function revenueBreakdown(ws, { range, keyOf }, t) {
  const [rooms, dayPasses, invoices] = await Promise.all([
    Booking.find({
      workspaceId: ws, externalRef: { $type: "string" }, "metadata.wp.status": "paid", "metadata.wp.payment.mode": "live",
      "metadata.wp.payment.method": { $ne: "credits" },
      $or: [{ "metadata.wp.payment.paidAt": { $exists: true, $ne: null } }, { createdAt: range }],
    }).select("createdAt metadata.wp.payment").lean(),
    Deal.find({ workspaceId: ws, "metadata.isTest": { $ne: true }, status: "won", productType: { $in: ["day_pass", "day_pass_package"] }, closedAt: range })
      .select("closedAt value").lean(),
    Invoice.find({ workspaceId: ws, status: "paid", paidAt: range, "metadata.isTest": { $ne: true } }).select("paidAt total dealId").lean(),
  ]);
  for (const b of rooms) {
    const paidAt = b.metadata.wp.payment.paidAt ? new Date(b.metadata.wp.payment.paidAt) : b.createdAt;
    if (paidAt >= range.$gte && paidAt < range.$lt) t.add(keyOf(paidAt), "meeting_rooms", Number(b.metadata.wp.payment.amount) || 0);
  }
  for (const d of dayPasses) t.add(keyOf(d.closedAt), "day_passes", Number(d.value) || 0);

  const deals = await Deal.find({ _id: { $in: invoices.map((i) => i.dealId).filter(Boolean) } }).select("productType pipelineId").lean();
  const pipelines = await Pipeline.find({ _id: { $in: deals.map((d) => d.pipelineId).filter(Boolean) } }).select("key").lean();
  const pipelineKey = new Map(pipelines.map((p) => [String(p._id), p.key]));
  const dealCat = new Map(deals.map((d) => [String(d._id), PRODUCT_TO_REVENUE[d.productType] || PIPELINE_TO_REVENUE[pipelineKey.get(String(d.pipelineId))] || "other"]));
  for (const inv of invoices) t.add(keyOf(inv.paidAt), dealCat.get(String(inv.dealId)) || "other", Number(inv.total) || 0);

  return {
    unit: "HKD",
    definitions: {
      meeting_rooms: "Paid live WordPress room bookings (card payments; credit bookings are HK$0), by payment date.",
      day_passes: "Day passes and day pass packages bought with Stripe Payment Links (live only), by payment date.",
      coworking: "Paid invoices whose deal is a membership / coworking desk (or in the Membership pipeline), by paid date.",
      private_office: "Paid invoices for serviced (private) offices, by paid date.",
      virtual_office: "Paid invoices for virtual office, by paid date.",
      events: "Paid invoices for venue hire, event space and photoshoots, by paid date.",
      podcast: "Paid invoices for the podcast studio, by paid date.",
      other: "Paid invoices with no linked deal, or a deal of another type, by paid date.",
    },
  };
}

/* ---------- lead source ---------- */
export const LEAD_SOURCE_CATEGORIES = [
  { key: "website", label: "Website" },
  { key: "walk_in", label: "Walk-in" },
  { key: "newsletter", label: "Newsletter" },
  { key: "email", label: "Email" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "phone", label: "Phone" },
  { key: "referral", label: "Referral / broker / partner" },
  { key: "social", label: "Social media" },
  { key: "search", label: "Search engine" },
  { key: "event", label: "Event" },
  { key: "other", label: "Other" },
  { key: "unknown", label: "Unknown" },
];
// First match wins; tested against the lowercased source.
const SOURCE_RULES = [
  ["walk_in", /walk[\s_-]?in|reception|passing by|walked/],
  ["newsletter", /newsletter|flodesk|mailing/],
  ["whatsapp", /whats\s?app/],
  ["social", /instagram|\big\b|facebook|\bfb\b|linkedin|tiktok|xiaohongshu|red ?note|\bxhs\b|twitter|\bx\.com|social|youtube|threads|wechat/],
  ["search", /google|search|seo|\bbing\b|yahoo|baidu|\bads?\b|adwords/],
  ["referral", /refer|friend|word of mouth|broker|agent|partner|colleague|recommend/],
  ["event", /event|workshop|meetup|conference|seminar/],
  ["email", /e-?mail|gmail|outlook/],
  ["phone", /phone|call|\btel\b/],
  ["website", /website|web|form|enquiry|inquiry|booking|online|banyanworkspace/],
];
export function leadSourceKey(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";
  return SOURCE_RULES.find(([, rx]) => rx.test(s))?.[0] || "other";
}

async function leadSourceBreakdown(ws, { range, keyOf }, t) {
  const contacts = await Contact.find({ workspaceId: ws, createdAt: range, tags: { $ne: "test_booking" } }).select("createdAt source").lean();
  const mapping = {};
  for (const c of contacts) {
    const key = leadSourceKey(c.source);
    t.add(keyOf(c.createdAt), key, 1);
    const raw = String(c.source || "").trim() || "(none)";
    mapping[raw] = key;
  }
  const seen = (key) => Object.entries(mapping).filter(([, k]) => k === key).map(([raw]) => raw);
  const definitions = Object.fromEntries(
    LEAD_SOURCE_CATEGORIES.map((c) => {
      const raws = seen(c.key);
      return [c.key, `New contacts (by date created) whose source is ${c.label.toLowerCase()}.${raws.length ? ` Sources in this range: ${raws.join(", ")}.` : ""}`];
    }),
  );
  return { unit: "contacts", definitions, mapping };
}

/* ---------- enquiry type ---------- */
export const ENQUIRY_CATEGORIES = [
  { key: "virtual_office", label: "Virtual Office" },
  { key: "flexible_day_pass", label: "Flexible Day Pass" },
  { key: "coworking_desks", label: "Coworking Desks" },
  { key: "serviced_offices", label: "Serviced Offices" },
  { key: "meeting_rooms", label: "Meeting Rooms" },
  { key: "event_venue", label: "Event Venue" },
  { key: "photoshoot_space", label: "Photoshoot Space" },
  { key: "podcast_studio", label: "Podcast Studio" },
  { key: "other", label: "Other" },
];
const ENQUIRY_ALIASES = {
  "virtual office": "virtual_office",
  "flexible day pass": "flexible_day_pass", "day pass": "flexible_day_pass", "day pass package": "flexible_day_pass", "day pass packages": "flexible_day_pass",
  "coworking": "coworking_desks", "coworking desk": "coworking_desks", "coworking desks": "coworking_desks", "dedicated desk": "coworking_desks",
  "serviced office": "serviced_offices", "serviced offices": "serviced_offices", "private office": "serviced_offices",
  "meeting room": "meeting_rooms", "meeting rooms": "meeting_rooms",
  "event venue": "event_venue", "event space": "event_venue", "event space / venue hire": "event_venue", "venue hire": "event_venue",
  "photoshoot space": "photoshoot_space", "photo shoot space": "photoshoot_space",
  "podcast studio": "podcast_studio", "podcast services": "podcast_studio",
};
export const enquiryKey = (interest) => ENQUIRY_ALIASES[String(interest || "").trim().toLowerCase()] || "other";

async function enquiryTypeBreakdown(ws, { range, keyOf }, t) {
  // 1. Website enquiries (pop-up, and CRM forms routed the same way): one deal per pipeline, so count
  //    each enquiry once by contact + received time.
  const deals = await Deal.find({ workspaceId: ws, "metadata.allInterests.0": { $exists: true }, "metadata.receivedAt": range })
    .select("_id contactId metadata.receivedAt metadata.allInterests").lean();
  const enquiries = new Map();
  for (const d of deals) {
    const id = `${d.contactId}|${new Date(d.metadata.receivedAt).toISOString()}`;
    if (!enquiries.has(id)) enquiries.set(id, { at: d.metadata.receivedAt, interests: d.metadata.allInterests });
  }
  const enquiryDealIds = new Set(deals.map((d) => String(d._id)));
  // 2. Enquiry and walk-in form submissions not already counted as a website enquiry. A walk-in
  //    visitor who ticked no service left their details only: not an enquiry.
  const forms = await Form.find({ workspaceId: ws, type: { $in: ["enquiry", "walk_in"] } }).select("_id").lean();
  const subs = await FormSubmission.find({ workspaceId: ws, formId: { $in: forms.map((f) => f._id) }, status: "processed", createdAt: range })
    .select("createdAt dealId payload.interests").lean();
  let n = 0;
  for (const s of subs) if (s.payload?.interests?.length && (!s.dealId || !enquiryDealIds.has(String(s.dealId)))) enquiries.set(`sub|${n++}|${s._id}`, { at: s.createdAt, interests: s.payload?.interests || [] });

  for (const e of enquiries.values()) {
    const keys = new Set((e.interests || []).map(enquiryKey));
    if (!keys.size) keys.add("other");
    for (const k of keys) t.add(keyOf(e.at), k, 1); // two services ticked: counted once in each
  }
  const def = (label) => `Enquiries (website enquiry form, CRM enquiry forms and walk-in forms) that ticked ${label}, by date received. An enquiry with two services counts once in each.`;
  return {
    unit: "enquiries",
    definitions: {
      ...Object.fromEntries(ENQUIRY_CATEGORIES.map((c) => [c.key, def(c.label)])),
      flexible_day_pass: def("Flexible Day Pass or Day Pass Packages"),
      other: "Enquiries for a service not listed here, by date received. Walk-in visitors who ticked no service are not counted.",
    },
  };
}

const BREAKDOWNS = {
  revenue: [REVENUE_CATEGORIES, revenueBreakdown],
  leadSource: [LEAD_SOURCE_CATEGORIES, leadSourceBreakdown],
  enquiryType: [ENQUIRY_CATEGORIES, enquiryTypeBreakdown],
};

export async function breakdownReport(workspaceId, { by, period = "month", from, to } = {}) {
  if (!BREAKDOWNS[by]) throw new AppError("by must be revenue, leadSource or enquiryType.", 400, "INVALID_BREAKDOWN");
  const p = buildPeriods(period, from, to);
  const [categories, run] = BREAKDOWNS[by];
  const t = table(p.periods, categories);
  const ws = new mongoose.Types.ObjectId(String(workspaceId));
  const extra = await run(ws, p, t);
  return { by, period, from, to, timezone: HK_TZ, periods: p.periods, categories, rows: t.rows, totals: t.totals, ...extra };
}
