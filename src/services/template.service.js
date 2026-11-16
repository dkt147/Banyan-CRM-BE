/*
 * Email template variables (feedback 17 Nov, #6). Staff write {{firstName}} etc. in a template's
 * subject/body; renderTemplate fills them in at send time. Unknown keys are left as they are.
 * Values inserted into HTML bodies are HTML-escaped.
 */
import mongoose from "mongoose";
import { Booking } from "../models/Booking.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { Template } from "../models/Template.js";
import { AppError } from "../utils/AppError.js";
import { HK_TZ } from "../utils/hkTime.js";
import { looksLikeHtml } from "../utils/mail.js";

export const TEMPLATE_VARIABLES = [
  "firstName", "lastName", "fullName", "email", "companyName", "dealTitle",
  "bookingDate", "bookingTime", "roomName", "staffName", "staffEmail",
];

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hkDate = (d) => new Date(d).toLocaleDateString("en-GB", { timeZone: HK_TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" });
const hkTime = (d) => new Date(d).toLocaleTimeString("en-GB", { timeZone: HK_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Variable values from loaded records ({ contact, company, deal, booking, user }); missing → key absent. */
export function templateValues({ contact, company, deal, booking, user } = {}) {
  const v = {};
  if (contact) {
    v.firstName = contact.firstName || "";
    v.lastName = contact.lastName || "";
    v.fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
    v.email = contact.email || "";
  }
  const companyName = company?.name || contact?.companyId?.name;
  if (companyName) v.companyName = companyName;
  if (deal) v.dealTitle = deal.title || "";
  if (booking) {
    v.bookingDate = hkDate(booking.startAt);
    v.bookingTime = `${hkTime(booking.startAt)} – ${hkTime(booking.endAt)}`;
    v.roomName = booking.metadata?.wp?.roomName || booking.resourceName || "";
  }
  if (user) {
    v.staffName = user.name || "";
    v.staffEmail = user.email || "";
  }
  return v;
}

/** Replace {{ key }} placeholders. html=true escapes the inserted values. */
export function renderString(text, values, { html = false } = {}) {
  return String(text ?? "").replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? (html ? escapeHtml(values[key]) : String(values[key])) : match,
  );
}

/** { subject, body, isHtml } with variables filled in. */
export function renderTemplate(template, context = {}) {
  const values = templateValues(context);
  const isHtml = looksLikeHtml(template.body);
  return {
    subject: renderString(template.subject, values).replace(/[\r\n]+/g, " "),
    body: renderString(template.body, values, { html: isHtml }),
    isHtml,
  };
}

const oid = (v) => (v && mongoose.isValidObjectId(v) ? v : null);

/** Load the records referenced by ids (workspace-scoped) for renderTemplate. */
export async function loadTemplateContext(workspaceId, { contactId, companyId, dealId, bookingId } = {}, user = null) {
  const ws = { workspaceId };
  const [deal, booking] = await Promise.all([
    oid(dealId) ? Deal.findOne({ ...ws, _id: dealId }).lean() : null,
    oid(bookingId) ? Booking.findOne({ ...ws, _id: bookingId }).lean() : null,
  ]);
  const cId = oid(contactId) || deal?.contactId || booking?.contactId;
  const contact = cId ? await Contact.findOne({ ...ws, _id: cId }).populate("companyId", "name").lean() : null;
  const coId = oid(companyId) || deal?.companyId || booking?.companyId;
  const company = coId ? await Company.findOne({ ...ws, _id: coId }).select("name").lean() : null;
  return { contact, company, deal, booking, user };
}

export async function getTemplate(workspaceId, templateId) {
  if (!oid(templateId)) throw new AppError("Invalid template.", 400, "INVALID_TEMPLATE");
  const template = await Template.findOne({ _id: templateId, workspaceId, isActive: { $ne: false } }).lean();
  if (!template) throw new AppError("Template not found.", 404, "TEMPLATE_NOT_FOUND");
  return template;
}
