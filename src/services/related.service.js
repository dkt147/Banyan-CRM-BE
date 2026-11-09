import mongoose from "mongoose";
import { Activity } from "../models/Activity.js";
import { Booking } from "../models/Booking.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Conversation } from "../models/Conversation.js";
import { Deal } from "../models/Deal.js";
import { Document } from "../models/Document.js";
import { Task } from "../models/Task.js";
import { AppError } from "../utils/AppError.js";
import { displayStatus } from "./booking.service.js";

/*
 * Connected records (C1). One read-only endpoint returns, for a contact, company, deal,
 * task or booking: the records it links to, and its bookings, deals, tasks, emails,
 * WhatsApp threads, files and activity. Everything is workspace-scoped.
 */

export const RELATED_TYPES = ["contact", "company", "deal", "task", "booking"];
const DEFAULT_LIMIT = 10;

const idOf = (value) => (value && typeof value === "object" && value._id ? value._id : value) || null;
const str = (value) => (value ? String(value) : null);
const personName = (c) => (c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed contact" : "");

function contactLink(c) {
  return c && c._id ? { id: String(c._id), label: personName(c), email: c.email || "" } : null;
}
function companyLink(c) {
  return c && c._id ? { id: String(c._id), label: c.name || "Company" } : null;
}
function dealLink(d) {
  return d && d._id ? { id: String(d._id), label: d.title || "Deal", dealNumber: d.dealNumber || null } : null;
}

async function loadEntity(type, workspaceId, id) {
  const base = { _id: id, workspaceId };
  const contactSel = "firstName lastName email companyId";
  switch (type) {
    case "contact":
      return Contact.findOne(base).select(contactSel).populate("companyId", "name").lean();
    case "company":
      return Company.findOne(base).select("name").lean();
    case "deal":
      return Deal.findOne(base).select("title dealNumber contactId companyId")
        .populate("contactId", contactSel).populate("companyId", "name").lean();
    case "task":
      return Task.findOne(base).select("title contactId companyId dealId createdBy assignedTo")
        .populate("contactId", contactSel).populate("companyId", "name").populate("dealId", "title dealNumber contactId companyId").lean();
    case "booking":
      return Booking.findOne(base).select("title resourceName bookingType contactId companyId dealId")
        .populate("contactId", contactSel).populate("companyId", "name").populate("dealId", "title dealNumber").lean();
    default:
      return null;
  }
}

/** Build per-collection filters for the entity. */
async function buildScope(type, workspaceId, entity) {
  const ws = { workspaceId };
  if (type === "contact") {
    const f = { ...ws, contactId: entity._id };
    return { bookings: f, deals: f, tasks: f, conversations: f, files: f, activities: f };
  }
  if (type === "company") {
    const contactIds = await Contact.find({ ...ws, companyId: entity._id }).distinct("_id");
    const f = { ...ws, $or: [{ companyId: entity._id }, { contactId: { $in: contactIds } }] };
    return { bookings: f, deals: f, tasks: f, conversations: f, files: f, activities: f };
  }
  // Deal, or a task/booking that points to a deal: records of that deal. A deal's emails
  // and WhatsApp threads are usually linked to its contact rather than the deal itself.
  const deal = type === "deal" ? entity : idOf(entity.dealId) ? entity.dealId : null;
  if (deal) {
    const dealId = idOf(deal);
    const dealContactId = idOf(deal.contactId);
    const f = { ...ws, dealId };
    const conversations = dealContactId
      ? { ...ws, $or: [{ dealId }, { contactId: dealContactId }] }
      : f;
    const deals = dealContactId
      ? { ...ws, contactId: dealContactId, _id: { $ne: dealId } }
      : { ...ws, _id: null };
    return { bookings: f, deals, tasks: f, conversations, files: f, activities: f };
  }
  const contactId = idOf(entity.contactId);
  if (contactId) {
    const f = { ...ws, contactId };
    return { bookings: f, deals: f, tasks: f, conversations: f, files: f, activities: f };
  }
  const none = { ...ws, _id: null };
  return { bookings: none, deals: none, tasks: none, conversations: none, files: none, activities: none };
}

async function section(Model, filter, { sort, select, populate = [], limit, map }) {
  let q = Model.find(filter).sort(sort).limit(limit).select(select);
  for (const p of populate) q = q.populate(p);
  const [rows, total] = await Promise.all([q.lean(), Model.countDocuments(filter)]);
  return { total, items: rows.map(map) };
}

export async function getRelatedRecords({ type, id, workspaceId, userId, limit = DEFAULT_LIMIT }) {
  if (!RELATED_TYPES.includes(type)) throw new AppError("Unsupported record type.", 400, "INVALID_RELATED_TYPE");
  if (!mongoose.isValidObjectId(id)) throw new AppError("Invalid record id.", 400, "INVALID_ID");
  const size = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), 50);

  const entity = await loadEntity(type, workspaceId, id);
  if (!entity) throw new AppError("Record not found.", 404, "NOT_FOUND");

  const scope = await buildScope(type, workspaceId, entity);
  // All roles can view all workspace tasks (brief section 7).
  const taskFilter = scope.tasks;
  const now = new Date();
  const opts = { limit: size };

  const [bookings, deals, tasks, emails, whatsapp, files, activities] = await Promise.all([
    section(Booking, scope.bookings, {
      ...opts,
      sort: { startAt: -1 },
      select: "title resourceName bookingType status holdExpiresAt startAt endAt contactId source",
      populate: [{ path: "contactId", select: "firstName lastName email" }],
      map: (b) => ({
        id: String(b._id),
        title: b.title || b.resourceName || b.bookingType || "Booking",
        subtitle: [b.resourceName, personName(b.contactId)].filter(Boolean).join(" · "),
        status: displayStatus(b, now),
        date: b.startAt,
        endAt: b.endAt,
        contactId: str(idOf(b.contactId)),
      }),
    }),
    section(Deal, scope.deals, {
      ...opts,
      sort: { updatedAt: -1 },
      select: "title dealNumber value currency status stageId contactId updatedAt",
      populate: [{ path: "stageId", select: "name" }, { path: "contactId", select: "firstName lastName email" }],
      map: (d) => ({
        id: String(d._id),
        title: d.title,
        subtitle: [d.stageId?.name, personName(d.contactId)].filter(Boolean).join(" · "),
        status: d.status,
        date: d.updatedAt,
        value: d.value,
        currency: d.currency,
        dealNumber: d.dealNumber || null,
        contactId: str(idOf(d.contactId)),
      }),
    }),
    section(Task, taskFilter, {
      ...opts,
      sort: { dueAt: 1 },
      select: "title status priority dueAt dealId contactId",
      populate: [{ path: "dealId", select: "title" }, { path: "contactId", select: "firstName lastName email" }],
      map: (t) => ({
        id: String(t._id),
        title: t.title,
        subtitle: [t.dealId?.title, personName(t.contactId)].filter(Boolean).join(" · "),
        status: t.status,
        priority: t.priority,
        date: t.dueAt,
        dealId: str(idOf(t.dealId)),
        contactId: str(idOf(t.contactId)),
      }),
    }),
    ...["email", "whatsapp"].map((channel) =>
      section(Conversation, { $and: [scope.conversations, { channel }] }, {
        ...opts,
        sort: { lastMessageAt: -1 },
        select: "subject participantName participantAddress status lastMessageAt unreadCount",
        map: (c) => ({
          id: String(c._id),
          title: c.subject || c.participantName || c.participantAddress || "Conversation",
          subtitle: [c.participantName, c.participantAddress].filter(Boolean).join(" · "),
          status: c.status,
          date: c.lastMessageAt,
          unreadCount: c.unreadCount || 0,
        }),
      }),
    ),
    section(Document, scope.files, {
      ...opts,
      sort: { createdAt: -1 },
      select: "name type mimeType size url createdAt",
      map: (d) => ({
        id: String(d._id),
        title: d.name,
        subtitle: [d.type, d.mimeType].filter(Boolean).join(" · "),
        date: d.createdAt,
        // Only http(s) links are passed to the browser.
        url: /^https?:\/\//i.test(d.url || "") ? d.url : null,
      }),
    }),
    section(Activity, scope.activities, {
      ...opts,
      sort: { occurredAt: -1 },
      select: "type subject body occurredAt dealId contactId",
      map: (a) => ({
        id: String(a._id),
        title: a.subject || String(a.type || "Activity").replace(/_/g, " "),
        subtitle: a.body ? String(a.body).slice(0, 140) : "",
        status: a.type,
        date: a.occurredAt,
        dealId: str(idOf(a.dealId)),
        contactId: str(idOf(a.contactId)),
      }),
    }),
  ]);

  // Links: the records this entity points to.
  let links = { contact: null, company: null, deal: null };
  if (type === "contact") links.company = companyLink(entity.companyId);
  else if (type === "deal") links = { ...links, contact: contactLink(entity.contactId), company: companyLink(entity.companyId) };
  else if (type === "task" || type === "booking") {
    links = { contact: contactLink(entity.contactId), company: companyLink(entity.companyId), deal: dealLink(entity.dealId) };
  }

  const label =
    type === "contact" ? personName(entity)
      : type === "company" ? entity.name
        : type === "booking" ? entity.title || entity.resourceName || "Booking"
          : entity.title;

  return {
    entity: { type, id: String(entity._id), label },
    links,
    sections: { bookings, deals, tasks, emails, whatsapp, files, activities },
  };
}
