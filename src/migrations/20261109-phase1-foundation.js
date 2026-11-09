/*
 * Phase 1 foundation migration (MongoDB / Mongoose).
 *
 * up:
 *   1. Create indexes for new collections and the new Booking/Contact/Task fields.
 *      Uses createIndexes (additive). It never calls syncIndexes, so no index is dropped.
 *   2. Backfill Contact.phoneNormalized where it is missing (digits of phone or WhatsApp).
 *   3. Create a Resource for each distinct Booking.resourceName per workspace that has
 *      no Resource yet, and set Booking.resourceId where it is missing.
 *   4. Report bookings that have no contact (D1). They are NOT changed: which contact a
 *      booking belongs to cannot be inferred safely, so staff must link them.
 *
 * down: removes only what up added (fields it set and resources it created, which are
 * tagged), and drops the new indexes. Collections are never dropped.
 *
 * Every step is idempotent and safe to re-run.
 */
import { Booking } from "../models/Booking.js";
import { Contact } from "../models/Contact.js";
import { Task } from "../models/Task.js";
import { Resource } from "../models/Resource.js";
import { Segment } from "../models/Segment.js";
import { WorkflowRunStep } from "../models/WorkflowRunStep.js";
import { Form } from "../models/Form.js";
import { FormSubmission } from "../models/FormSubmission.js";
import { GoogleCalendarChannel } from "../models/GoogleCalendarChannel.js";
import { DashboardLayout } from "../models/DashboardLayout.js";
import { Workflow } from "../models/Workflow.js";
import { WorkflowRun } from "../models/WorkflowRun.js";
import { normalizePhone } from "../utils/phone.js";

export const id = "20261109-phase1-foundation";
const TAG = id;

const NEW_MODELS = [Resource, Segment, Workflow, WorkflowRun, WorkflowRunStep, Form, FormSubmission, GoogleCalendarChannel, DashboardLayout];
const CHANGED_MODELS = [Booking, Contact, Task];

// Indexes added to existing collections by this migration (dropped by down).
const ADDED_INDEXES = {
  [Booking.collection.collectionName]: [
    "workspaceId_1_contactId_1_startAt_-1",
    "workspaceId_1_companyId_1_startAt_-1",
    "resourceId_1",
    "dealId_1",
    "paymentStatus_1",
    "googleEventId_1",
    "stripeCheckoutSessionId_1",
  ],
  // contact_text_search replaces the legacy text index and is kept on down: restoring
  // the old index would break saving contacts whose language is "zh".
  [Contact.collection.collectionName]: ["workspaceId_1_phoneNormalized_1", "workspaceId_1_lastEngagedAt_1"],
  [Task.collection.collectionName]: ["bookingId_1", "workflowRunId_1"],
};

const LEGACY_CONTACT_TEXT_INDEX = "firstName_text_lastName_text_email_text";

export async function up({ apply, log }) {
  // 0. The old contact text index read each contact's `language` field as the search
  //    language, so saving a contact with language "zh" failed. Only one text index is
  //    allowed per collection, so drop it before creating contact_text_search.
  const contactIndexes = new Set((await Contact.collection.indexes().catch(() => [])).map((i) => i.name));
  if (contactIndexes.has(LEGACY_CONTACT_TEXT_INDEX)) {
    if (apply) await Contact.collection.dropIndex(LEGACY_CONTACT_TEXT_INDEX);
    log(`${apply ? "dropped" : "would drop"} index contacts.${LEGACY_CONTACT_TEXT_INDEX} (unsupported language override)`);
  }

  // 1. Indexes
  for (const Model of [...CHANGED_MODELS, ...NEW_MODELS]) {
    if (apply) await Model.createIndexes();
    log(`${apply ? "created" : "would create"} indexes for ${Model.collection.collectionName}`);
  }

  // 2. phoneNormalized backfill
  const contacts = Contact.find({
    phoneNormalized: { $exists: false },
    $or: [{ phone: { $nin: [null, ""] } }, { whatsapp: { $nin: [null, ""] } }],
  }).select("workspaceId phone whatsapp").lean().cursor();
  let phones = 0;
  for await (const c of contacts) {
    const value = normalizePhone(c.phone) || normalizePhone(c.whatsapp);
    if (!value) continue;
    phones += 1;
    if (apply)
      await Contact.collection.updateOne(
        { _id: c._id, phoneNormalized: { $exists: false } },
        { $set: { phoneNormalized: value, "metadata.phoneNormalizedBy": TAG } },
      );
  }
  log(`${apply ? "backfilled" : "would backfill"} phoneNormalized on ${phones} contact(s)`);

  // 2b. Report numbers shared by several contacts. Website bookings match by email
  //     first, then phone; a shared number (e.g. a company switchboard) would link a
  //     booking to the oldest of these contacts, so staff should review them.
  const byNumber = new Map();
  for await (const c of Contact.find({ $or: [{ phone: { $nin: [null, ""] } }, { whatsapp: { $nin: [null, ""] } }] })
    .select("workspaceId phone whatsapp firstName lastName").lean().cursor()) {
    const value = normalizePhone(c.phone) || normalizePhone(c.whatsapp);
    if (!value) continue;
    const key = `${c.workspaceId}:${value}`;
    byNumber.set(key, [...(byNumber.get(key) || []), `${c.firstName || ""} ${c.lastName || ""}`.trim() || String(c._id)]);
  }
  const shared = [...byNumber.entries()].filter(([, names]) => names.length > 1);
  for (const [key, names] of shared.slice(0, 50))
    log(`REVIEW: phone ${key.split(":")[1]} is shared by ${names.length} contacts: ${names.slice(0, 5).join(", ")}`);
  if (shared.length > 50) log(`REVIEW: ${shared.length - 50} more shared phone numbers not listed`);
  if (!shared.length) log("no phone number is shared by more than one contact");

  // 3. Resources from existing booking resource names
  const pairs = await Booking.aggregate([
    { $match: { resourceName: { $nin: [null, ""] } } },
    { $group: { _id: { workspaceId: "$workspaceId", name: "$resourceName" } } },
  ]);
  let createdResources = 0, linkedBookings = 0;
  for (const { _id: { workspaceId, name } } of pairs) {
    let resource = await Resource.findOne({ workspaceId, name }).select("_id").lean();
    if (!resource) {
      createdResources += 1;
      if (apply)
        resource = await Resource.create({ workspaceId, name, type: "other", metadata: { createdBy: TAG } });
    }
    const filter = { workspaceId, resourceName: name, resourceId: { $exists: false } };
    if (apply && resource) {
      const result = await Booking.collection.updateMany(filter, { $set: { resourceId: resource._id, "metadata.resourceIdBy": TAG } });
      linkedBookings += result.modifiedCount;
    } else linkedBookings += await Booking.countDocuments(filter);
  }
  log(`${apply ? "created" : "would create"} ${createdResources} resource(s); ${apply ? "linked" : "would link"} ${linkedBookings} booking(s)`);
  // Room names that differ only in case or spacing become separate resources; list
  // them so an admin can merge them before the public booking widget uses rooms.
  const variants = new Map();
  for (const { _id: { workspaceId, name } } of pairs) {
    const key = `${workspaceId}:${String(name).trim().toLowerCase().replace(/\s+/g, " ")}`;
    variants.set(key, [...(variants.get(key) || []), name]);
  }
  for (const names of variants.values())
    if (names.length > 1) log(`REVIEW: room names look like the same room: ${names.map((n) => JSON.stringify(n)).join(", ")}`);
  if (pairs.length) log(`REVIEW: ${pairs.length} room(s) from booking names start with price 0; set prices and opening hours before the public booking flow is enabled`);

  // 4. D1 report: bookings without a contact (Google events live in CalendarEvent).
  const missing = await Booking.aggregate([
    { $match: { $or: [{ contactId: null }, { contactId: { $exists: false } }] } },
    { $group: { _id: "$source", count: { $sum: 1 } } },
  ]);
  if (missing.length)
    for (const row of missing) log(`REVIEW: ${row.count} booking(s) with source "${row._id || "unknown"}" have no contact. Link them in Bookings > Edit.`);
  else log("all bookings are linked to a contact");
}

export async function down({ apply, log }) {
  const unsetPhones = { "metadata.phoneNormalizedBy": TAG };
  const phoneCount = await Contact.countDocuments(unsetPhones);
  if (apply) await Contact.collection.updateMany(unsetPhones, { $unset: { phoneNormalized: "", "metadata.phoneNormalizedBy": "" } });
  log(`${apply ? "removed" : "would remove"} phoneNormalized from ${phoneCount} contact(s) set by this migration`);

  const linked = { "metadata.resourceIdBy": TAG };
  const bookingCount = await Booking.countDocuments(linked);
  if (apply) await Booking.collection.updateMany(linked, { $unset: { resourceId: "", "metadata.resourceIdBy": "" } });
  log(`${apply ? "unlinked" : "would unlink"} resourceId on ${bookingCount} booking(s)`);

  // Only delete resources this migration created and nothing else references.
  const created = await Resource.find({ "metadata.createdBy": TAG }).select("_id").lean();
  let removed = 0;
  for (const r of created) {
    if (await Booking.exists({ resourceId: r._id })) continue;
    removed += 1;
    if (apply) await Resource.deleteOne({ _id: r._id });
  }
  log(`${apply ? "deleted" : "would delete"} ${removed} resource(s) created by this migration`);

  for (const [collection, names] of Object.entries(ADDED_INDEXES)) {
    const coll = Booking.db.collection(collection);
    const existing = new Set((await coll.indexes()).map((i) => i.name));
    for (const name of names) {
      if (!existing.has(name)) continue;
      if (apply) await coll.dropIndex(name);
      log(`${apply ? "dropped" : "would drop"} index ${collection}.${name}`);
    }
  }
  log("new collections are left in place (never dropped automatically)");
}
