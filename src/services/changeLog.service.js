/*
 * Detailed timeline (client feedback 26 Nov, B1). Compares a record before and after a save and writes
 * ONE Activity with every change in readable form:
 *   metadata.changed = ["stageId", "value"]                       (kept for older screens)
 *   metadata.changes = [{ field, label, from, to }]               (strings, or null for "empty")
 * Values are made readable (names for ids, HK$ for money, HK dates, Yes/No, tag labels, birthdays).
 * Nothing is written when nothing actually changed. The payload's keys are never trusted.
 */
import mongoose from "mongoose";
import { Activity } from "../models/Activity.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { User } from "../models/User.js";
import { formatBirthday } from "../utils/birthday.js";
import { tagLabelMap } from "./contactTags.service.js";

const SKIP = new Set([
  "_id", "id", "__v", "workspaceId", "createdAt", "updatedAt", "metadata", "lastActivityAt", "stageChangedAt",
  "closedAt", "completedAt", "phoneNormalized", "birthdayMonthDay", "lastEngagedAt", "dealNumber", "createdBy",
  "publicPaymentToken", "fullName", "consentIp", "workflowRunId",
]);

const LABELS = {
  stageId: "Stage", pipelineId: "Pipeline", ownerId: "Owner", assignedTo: "Assigned to", contactId: "Contact",
  companyId: "Company", dealId: "Deal", bookingId: "Booking", value: "Value", recurringValue: "Recurring value",
  currency: "Currency", productType: "Product", source: "Source", expectedCloseDate: "Expected close date",
  membershipStartAt: "Membership start", membershipEndAt: "Membership end", status: "Status", lostReason: "Lost reason",
  description: "Description", nextActionAt: "Next action", title: "Title", firstName: "First name", lastName: "Last name",
  email: "Email", phone: "Phone", whatsapp: "WhatsApp", jobTitle: "Job title", tags: "Tags", language: "Language",
  notes: "Notes", isArchived: "Archived", birthday: "Birthday", name: "Name", legalName: "Legal name",
  industry: "Industry", website: "Website", address: "Address", meetingRoomCreditHours: "Meeting room credits (h/month)",
  dueAt: "Due", priority: "Priority", snoozedUntil: "Snoozed until", marketingConsentAt: "Marketing consent",
  unsubscribedAt: "Unsubscribed", whatsappOptInAt: "WhatsApp opt-in", consentSource: "Consent source",
  consentText: "Consent text",
};
const MONEY = new Set(["value", "recurringValue", "amount", "total", "subtotal", "tax"]);
const DATE_ONLY = new Set(["expectedCloseDate", "membershipStartAt", "membershipEndAt"]);
const REFS = {
  stageId: "stage", pipelineId: "pipeline", ownerId: "user", assignedTo: "user", contactId: "contact",
  companyId: "company", dealId: "deal",
};
const STATUS_LABELS = { open: "Open", won: "Won", lost: "Lost", pending: "Pending", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", snoozed: "Snoozed" };

const humanize = (field) => field.replace(/Id$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const isOid = (v) => v instanceof mongoose.Types.ObjectId || (v && v._bsontype === "ObjectId");

/** Comparable form: ids and dates as strings, empties as null, arrays element-wise. */
function norm(v) {
  if (v === undefined || v === null || v === "") return null;
  if (isOid(v)) return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.length ? v.map(norm) : null;
  if (typeof v === "object") {
    if (v._id && Object.keys(v).length > 1 && !Array.isArray(v)) return String(v._id); // populated ref
    const entries = Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== "");
    return entries.length ? Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)])) : null;
  }
  return v;
}

const HK = { timeZone: "Asia/Hong_Kong" };
function fmtDate(value, withTime) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  const date = d.toLocaleDateString("en-GB", { ...HK, day: "numeric", month: "short", year: "numeric" });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString("en-GB", { ...HK, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}
const isHkMidnight = (d) => {
  const t = new Date(new Date(d).getTime() + 8 * 3600000);
  return t.getUTCHours() === 0 && t.getUTCMinutes() === 0;
};
const money = (n, currency = "HKD") =>
  `${!currency || currency === "HKD" ? "HK$" : `${currency} `}${Number(n || 0).toLocaleString("en-HK", { maximumFractionDigits: 2 })}`;
const cut = (s, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Changed fields between two plain objects: [{ field, from, to }] with raw values. */
export function diffFields(before = {}, after = {}, { only } = {}) {
  const keys = only || [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const out = [];
  for (const field of keys) {
    if (SKIP.has(field)) continue;
    const a = before?.[field];
    const b = after?.[field];
    if (JSON.stringify(norm(a)) === JSON.stringify(norm(b))) continue;
    out.push({ field, from: a, to: b });
  }
  return out;
}

async function nameMaps(workspaceId, raw) {
  const ids = { stage: new Set(), pipeline: new Set(), user: new Set(), contact: new Set(), company: new Set(), deal: new Set() };
  for (const c of raw) {
    const kind = REFS[c.field];
    if (!kind) continue;
    for (const v of [c.from, c.to]) if (v && mongoose.isValidObjectId(String(v?._id || v))) ids[kind].add(String(v?._id || v));
  }
  const q = (Model, set, select) => (set.size ? Model.find({ _id: { $in: [...set] } }).select(select).lean() : Promise.resolve([]));
  const [stages, pipelines, users, contacts, companies, deals] = await Promise.all([
    q(PipelineStage, ids.stage, "name"), q(Pipeline, ids.pipeline, "name"), q(User, ids.user, "name email"),
    q(Contact, ids.contact, "firstName lastName email"), q(Company, ids.company, "name"), q(Deal, ids.deal, "title"),
  ]);
  const m = (rows, f) => new Map(rows.map((r) => [String(r._id), f(r)]));
  return {
    stage: m(stages, (r) => r.name), pipeline: m(pipelines, (r) => r.name), user: m(users, (r) => r.name || r.email),
    contact: m(contacts, (r) => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "Contact"),
    company: m(companies, (r) => r.name), deal: m(deals, (r) => r.title),
  };
}

function readable(field, value, ctx) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return null;
  const kind = REFS[field];
  if (kind) {
    const id = String(value?._id || value);
    return ctx.names[kind]?.get(id) || (kind === "user" ? "Unknown user" : `Unknown ${kind}`);
  }
  if (field === "tags") return value.map((k) => ctx.tags?.get(k) || k).join(", ");
  if (field === "birthday") return formatBirthday(value) || String(value);
  if (MONEY.has(field)) return money(value, ctx.currency);
  if (value instanceof Date || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)))
    return fmtDate(value, !DATE_ONLY.has(field) && !isHkMidnight(value));
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "status") return STATUS_LABELS[value] || String(value);
  if (Array.isArray(value)) return cut(value.map((v) => String(v)).join(", "));
  if (typeof value === "object") {
    const parts = Object.values(value).filter((x) => x !== undefined && x !== null && x !== "").map(String);
    return parts.length ? cut(parts.join(", ")) : null;
  }
  return cut(String(value));
}

/** Readable changes [{ field, label, from, to }] (from/to are strings or null). */
export async function describeChanges(workspaceId, raw, { currency } = {}) {
  if (!raw.length) return [];
  const names = await nameMaps(workspaceId, raw);
  const tags = raw.some((c) => c.field === "tags") ? await tagLabelMap(workspaceId) : null;
  const ctx = { names, tags, currency };
  return raw.map((c) => ({
    field: c.field,
    label: LABELS[c.field] || humanize(c.field),
    from: readable(c.field, c.from, ctx),
    to: readable(c.field, c.to, ctx),
  }));
}

const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject({ depopulate: true }) : doc || {});

/**
 * Write one "<kind>_updated" Activity for a save, or nothing when nothing changed.
 * subject: string, or (changes) => string. Returns the activity or null. Never throws.
 */
export async function recordUpdate({ workspaceId, userId, type, before, after, subject, links = {}, currency, extraMeta = {} }) {
  try {
    const raw = diffFields(plain(before), plain(after));
    if (!raw.length) return null;
    const changes = await describeChanges(workspaceId, raw, { currency });
    if (!userId) return null; // Activity.userId is required; system edits without a user aren't logged here.
    return await Activity.create({
      workspaceId, userId, type,
      subject: typeof subject === "function" ? subject(changes) : subject,
      ...links,
      metadata: { changed: changes.map((c) => c.field), changes, ...extraMeta },
    });
  } catch (error) {
    console.error(`[timeline] ${type} activity failed:`, error.message);
    return null;
  }
}
