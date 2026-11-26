/*
 * Notes (client feedback 26 Nov, A): dated notes with their author, stored as Activity { type: "note" }
 * so they also show on the timeline. A note on a deal carries the deal's contact and company, and a note
 * on a contact carries the contact's company, so it shows on every related page. Plain text only.
 * Notes never go through automations or emails.
 */
import mongoose from "mongoose";
import { Activity } from "../models/Activity.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { AppError } from "../utils/AppError.js";

const TARGETS = ["contactId", "companyId", "dealId"];
const notFound = () => new AppError("Not found.", 404, "NOT_FOUND");
const oid = (v) => (v === undefined || v === null || v === "" ? null : String(v));

function cleanBody(value) {
  const body = typeof value === "string" ? value.trim() : "";
  if (!body) throw new AppError("Write something in the note first.", 400, "NOTE_EMPTY");
  if (body.length > 5000) throw new AppError("A note can be at most 5000 characters.", 400, "NOTE_TOO_LONG");
  return body;
}

async function mustExist(Model, workspaceId, id, select) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const doc = await Model.findOne({ _id: id, workspaceId }).select(select).lean();
  if (!doc) throw notFound();
  return doc;
}

const populateNote = (q) => q.populate("userId", "name").populate("dealId", "title");

function toNote(a) {
  return {
    _id: a._id,
    body: a.body || "",
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    occurredAt: a.occurredAt,
    userId: a.userId && a.userId._id ? { _id: a.userId._id, name: a.userId.name || "User" } : a.userId || null,
    contactId: a.contactId || null,
    companyId: a.companyId || null,
    dealId: a.dealId && a.dealId._id ? { _id: a.dealId._id, title: a.dealId.title } : a.dealId || null,
    editedAt: a.metadata?.editedAt || null,
    editedBy: a.metadata?.editedBy || null,
  };
}

/** GET /notes?contactId|companyId|dealId (exactly one) &page&limit */
export async function listNotes(workspaceId, q = {}) {
  const given = TARGETS.filter((k) => oid(q[k]));
  if (given.length !== 1)
    throw new AppError("Pass exactly one of contactId, companyId or dealId.", 400, "NOTE_TARGET_REQUIRED");
  const key = given[0];
  const Model = { contactId: Contact, companyId: Company, dealId: Deal }[key];
  await mustExist(Model, workspaceId, oid(q[key]), "_id");
  const page = Math.max(Number(q.page) || 1, 1);
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100);
  const filter = { workspaceId, type: "note", [key]: oid(q[key]) };
  const [rows, total] = await Promise.all([
    populateNote(Activity.find(filter).sort({ occurredAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
    Activity.countDocuments(filter),
  ]);
  return { items: rows.map(toNote), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/** POST /notes { body, contactId?, companyId?, dealId? } (at least one id). */
export async function createNote(workspaceId, user, input = {}) {
  const body = cleanBody(input.body);
  let contactId = oid(input.contactId);
  let companyId = oid(input.companyId);
  const dealId = oid(input.dealId);
  if (!contactId && !companyId && !dealId)
    throw new AppError("Attach the note to a contact, company or deal.", 400, "NOTE_TARGET_REQUIRED");
  if (dealId) {
    const deal = await mustExist(Deal, workspaceId, dealId, "contactId companyId");
    contactId = contactId || oid(deal.contactId);
    companyId = companyId || oid(deal.companyId);
  }
  if (contactId) {
    const contact = await mustExist(Contact, workspaceId, contactId, "companyId");
    companyId = companyId || oid(contact.companyId);
  }
  if (companyId) await mustExist(Company, workspaceId, companyId, "_id");
  const note = await Activity.create({
    workspaceId, type: "note", userId: user._id, subject: "Note", body,
    contactId: contactId || undefined, companyId: companyId || undefined, dealId: dealId || undefined,
    occurredAt: new Date(),
  });
  return toNote(await populateNote(Activity.findById(note._id)).lean());
}

async function ownNote(workspaceId, user, id) {
  if (!mongoose.isValidObjectId(id)) throw notFound();
  const note = await Activity.findOne({ _id: id, workspaceId, type: "note" });
  if (!note) throw notFound();
  if (String(note.userId) !== String(user._id) && user.role !== "admin")
    throw new AppError("Only the person who wrote this note, or an admin, can change it.", 403, "NOT_NOTE_AUTHOR");
  return note;
}

/** PATCH /notes/:id { body } (author or admin). */
export async function updateNote(workspaceId, user, id, input = {}) {
  const note = await ownNote(workspaceId, user, id);
  note.body = cleanBody(input.body);
  note.metadata = { ...(note.metadata || {}), editedAt: new Date(), editedBy: { _id: user._id, name: user.name || user.email } };
  note.markModified("metadata");
  await note.save();
  return toNote(await populateNote(Activity.findById(note._id)).lean());
}

/** DELETE /notes/:id (author or admin). Returns the deleted note for the audit log. */
export async function deleteNote(workspaceId, user, id) {
  const note = await ownNote(workspaceId, user, id);
  const before = { body: note.body, contactId: note.contactId, companyId: note.companyId, dealId: note.dealId, userId: note.userId };
  await note.deleteOne();
  return before;
}
