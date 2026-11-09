/*
 * Phase 1 integration tests: D1 (contact search + booking links), D2 (calendar payload),
 * C1 (connected records), C2 (task links) and the foundation migration.
 *
 * Runs against a throwaway MongoDB only:
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27999/banyan_phase1_test npm run test:phase1
 * The database name must contain "test"; it is dropped before and after the run.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

const TEST_URI = process.env.TEST_MONGODB_URI;
const skip = !TEST_URI ? "TEST_MONGODB_URI not set" : !/test/i.test(new URL(TEST_URI).pathname) ? "database name must contain 'test'" : false;

let mongoose, server, base, models = {}, tokens = {}, ids = {};

async function api(path, { method = "GET", body, as = "admin" } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokens[as]}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const day = (offsetDays, hour, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d;
};

before(async () => {
  if (skip) return;
  process.env.MONGODB_URI = TEST_URI;
  process.env.JWT_ACCESS_SECRET ||= "phase1-test-access-secret";
  process.env.JWT_REFRESH_SECRET ||= "phase1-test-refresh-secret";
  mongoose = (await import("mongoose")).default;
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  const app = (await import("../src/app.js")).default;
  const { signAccessToken } = await import("../src/utils/tokens.js");
  for (const name of ["User", "Workspace", "Contact", "Company", "Booking", "Deal", "Pipeline", "PipelineStage", "Task", "Resource", "Conversation", "Document", "Activity"])
    models[name] = (await import(`../src/models/${name}.js`))[name];
  const { User, Workspace, Pipeline, PipelineStage } = models;

  const wsId = new mongoose.Types.ObjectId();
  const admin = await User.create({ workspaceId: wsId, name: "Admin User", email: "admin@phase1.test", passwordHash: "x", role: "admin" });
  const operator = await User.create({ workspaceId: wsId, name: "Operator User", email: "op@phase1.test", passwordHash: "x", role: "operator" });
  await Workspace.create({ _id: wsId, name: "Phase1", slug: "phase1-test", createdBy: admin._id });
  const pipeline = await Pipeline.create({ workspaceId: wsId, name: "Membership", key: "membership", ownerId: admin._id });
  const stage = await PipelineStage.create({ workspaceId: wsId, pipelineId: pipeline._id, name: "Enquiry", key: "enquiry" });
  Object.assign(ids, { wsId, admin: admin._id, operator: operator._id, pipeline: pipeline._id, stage: stage._id });
  tokens.admin = signAccessToken(admin);
  tokens.operator = signAccessToken(operator);

  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  if (skip) return;
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("D1: a contact created by one user is found by another user's partial search", { skip }, async () => {
  const company = await api("/companies", { method: "POST", body: { name: "Aurora Studio" } });
  assert.equal(company.status, 201, JSON.stringify(company.json));
  ids.company = company.json.data._id;
  const created = await api("/contacts", {
    method: "POST",
    body: { firstName: "Janet", lastName: "Wong", email: "janet.wong@example.com", phone: "+852 9123-4567", companyId: ids.company },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  ids.contact = created.json.data._id;

  for (const term of ["jan", "Janet Wo", "WONG", "janet.wong@", "91234567", "9123-4567"]) {
    const found = await api(`/contacts?search=${encodeURIComponent(term)}`, { as: "operator" });
    assert.equal(found.status, 200);
    assert.ok(found.json.data.some((c) => c._id === ids.contact), `search "${term}" should find the contact`);
  }
  const none = await api(`/contacts?search=${encodeURIComponent("zzz-no-match")}`, { as: "operator" });
  assert.equal(none.json.data.length, 0);
  // Regex metacharacters are treated literally.
  const weird = await api(`/contacts?search=${encodeURIComponent("(.*")}`, { as: "operator" });
  assert.equal(weird.status, 200);

  const detail = await api(`/contacts/${ids.contact}`, { as: "operator" });
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.ownerId.name, "Admin User");
});

test("D1: staff bookings require an existing contact", { skip }, async () => {
  const start = day(1, 10), end = day(1, 11);
  const noContact = await api("/bookings", { method: "POST", body: { resourceName: "Harbour Room", startAt: start, endAt: end } });
  assert.equal(noContact.status, 400);
  assert.equal(noContact.json.code, "BOOKING_CONTACT_REQUIRED");

  const holdNoContact = await api("/calendar/hold", { method: "POST", body: { title: "x", resourceName: "Harbour Room", startAt: start, endAt: end, source: "manual" } });
  assert.equal(holdNoContact.status, 400);

  const foreign = await api("/bookings", { method: "POST", body: { resourceName: "Harbour Room", startAt: start, endAt: end, contactId: new mongoose.Types.ObjectId().toString() } });
  assert.equal(foreign.status, 404);

  const ok = await api("/bookings", { method: "POST", body: { title: "Test booking", resourceName: "Harbour Room", bookingType: "meeting_room", startAt: start, endAt: end, status: "confirmed", contactId: ids.contact } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  ids.booking = ok.json.data._id;
  // Company is inherited from the contact so the company page shows the booking.
  assert.equal(String(ok.json.data.companyId), ids.company);

  const clear = await api(`/bookings/${ids.booking}`, { method: "PATCH", body: { contactId: "" } });
  assert.equal(clear.status, 400, "removing the contact from a staff booking is rejected");
  const patch = await api(`/bookings/${ids.booking}`, { method: "PATCH", body: { notes: "updated" } });
  assert.equal(patch.status, 200);
});

test("D1: contact search result opens with its booking in related records", { skip }, async () => {
  const found = await api(`/contacts?search=janet`, { as: "operator" });
  const contact = found.json.data.find((c) => c._id === ids.contact);
  assert.ok(contact);
  const related = await api(`/related/contact/${contact._id}`, { as: "operator" });
  assert.equal(related.status, 200, JSON.stringify(related.json));
  assert.ok(related.json.data.sections.bookings.items.some((b) => b.id === ids.booking));
  assert.equal(related.json.data.links.company.id, ids.company);
  const companyRelated = await api(`/related/company/${ids.company}`, { as: "operator" });
  assert.ok(companyRelated.json.data.sections.bookings.items.some((b) => b.id === ids.booking));
});

test("D1: website holds match contacts by email first, then phone, else create", { skip }, async () => {
  const mk = (h) => ({ resourceName: "Studio A", bookingType: "studio", startAt: day(2, h), endAt: day(2, h + 1), source: "website" });
  const byEmail = await api("/calendar/hold", { method: "POST", body: { ...mk(9), contact: { email: "JANET.WONG@example.com", phone: "000000" } } });
  assert.equal(byEmail.status, 201, JSON.stringify(byEmail.json));
  assert.equal(String(byEmail.json.data.contactId), ids.contact);
  assert.equal(byEmail.json.data.metadata.contactMatch, "email");

  const byPhone = await api("/calendar/hold", { method: "POST", body: { ...mk(11), contact: { email: "other@example.com", phone: "(852) 91234567" } } });
  assert.equal(byPhone.status, 201, JSON.stringify(byPhone.json));
  assert.equal(String(byPhone.json.data.contactId), ids.contact);
  assert.equal(byPhone.json.data.metadata.contactMatch, "phone");

  const fresh = await api("/calendar/hold", { method: "POST", body: { ...mk(13), contact: { firstName: "New", lastName: "Guest", email: "new.guest@example.com" } } });
  assert.equal(fresh.status, 201);
  assert.notEqual(String(fresh.json.data.contactId), ids.contact);
  assert.equal(fresh.json.data.metadata.contactMatch, "created");
  const found = await api(`/contacts?search=new.guest`, { as: "operator" });
  assert.equal(found.json.data.length, 1);

  const missing = await api("/calendar/hold", { method: "POST", body: { ...mk(15), contact: { firstName: "Anon" } } });
  assert.equal(missing.status, 400);

  const google = await api("/bookings", { method: "POST", body: { resourceName: "Studio A", startAt: day(2, 16), endAt: day(2, 17), source: "google" } });
  assert.equal(google.status, 201, "unlinked Google bookings are allowed");
});

test("C2: a task linked to a deal gets the deal's contact and navigates both ways", { skip }, async () => {
  // Deal owned by admin; task created by the operator (previously rejected: owner check).
  const deal = await api("/deals", { method: "POST", body: { title: "Janet membership", contactId: ids.contact, pipelineId: ids.pipeline, stageId: ids.stage } });
  assert.equal(deal.status, 201, JSON.stringify(deal.json));
  ids.deal = deal.json.data._id;
  const task = await api("/tasks", { as: "operator", method: "POST", body: { title: "Call Janet", dueAt: day(0, 17), dealId: ids.deal } });
  assert.equal(task.status, 201, JSON.stringify(task.json));
  ids.task = task.json.data._id;
  assert.equal(task.json.data.contactId._id, ids.contact, "contact filled from deal");
  assert.equal(task.json.data.dealId._id, ids.deal);
  assert.equal(task.json.data.dealId.contactId._id, ids.contact);

  const list = await api("/tasks", { as: "operator" });
  const row = list.json.data.find((t) => t._id === ids.task);
  assert.equal(row.dealId.title, "Janet membership");
  assert.equal(row.contactId.firstName, "Janet");

  const related = await api(`/related/task/${ids.task}`, { as: "operator" });
  assert.equal(related.json.data.links.deal.id, ids.deal);
  assert.equal(related.json.data.links.contact.id, ids.contact);
  // Deal -> contact
  const dealRelated = await api(`/related/deal/${ids.deal}`, { as: "operator" });
  assert.equal(dealRelated.json.data.links.contact.id, ids.contact);
  assert.ok(dealRelated.json.data.sections.tasks.items.some((t) => t.id === ids.task));
  // Every role can view every workspace task (decision 2026-11-10).
  const visible = await api(`/related/task/${ids.task}`, { as: "admin" });
  assert.equal(visible.status, 200);
  const contactTasks = await api(`/related/contact/${ids.contact}`, { as: "admin" });
  assert.ok(contactTasks.json.data.sections.tasks.items.some((t) => t.id === ids.task));
  const adminList = await api(`/tasks`, { as: "admin" });
  assert.ok(adminList.json.data.some((t) => t._id === ids.task));
});

test("C1: related records include emails, WhatsApp, files and activity", { skip }, async () => {
  const { Conversation, Document, Activity } = models;
  await Conversation.create({ workspaceId: ids.wsId, channel: "email", contactId: ids.contact, subject: "Quote" });
  await Conversation.create({ workspaceId: ids.wsId, channel: "whatsapp", contactId: ids.contact, participantAddress: "+85291234567" });
  await Document.create({ workspaceId: ids.wsId, name: "Contract.pdf", contactId: ids.contact, dealId: ids.deal, uploadedBy: ids.admin, url: "javascript:alert(1)" });
  await Activity.create({ workspaceId: ids.wsId, type: "note", contactId: ids.contact, userId: ids.admin, subject: "Met at event" });
  const r = await api(`/related/contact/${ids.contact}`);
  const s = r.json.data.sections;
  assert.equal(s.emails.total, 1);
  assert.equal(s.whatsapp.total, 1);
  assert.equal(s.files.total, 1);
  assert.equal(s.files.items[0].url, null, "non-http file URLs are not passed through");
  assert.ok(s.activities.total >= 1);
  assert.ok(s.deals.items.some((d) => d.id === ids.deal));
  const bad = await api(`/related/invoice/${ids.contact}`);
  assert.equal(bad.status, 400);
  const missing = await api(`/related/contact/${new mongoose.Types.ObjectId()}`);
  assert.equal(missing.status, 404);
});

test("D2: calendar payload is stable for zero, one and overlapping bookings", { skip }, async () => {
  const empty = await api(`/calendar/week?from=${encodeURIComponent(day(30, 0).toISOString())}&days=5`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.data.items, []);
  assert.ok(Array.isArray(empty.json.data.resources));

  const from = encodeURIComponent(day(1, 0).toISOString());
  const one = await api(`/calendar/week?from=${from}&days=1`);
  assert.equal(one.json.data.items.length, 1);
  assert.equal(one.json.data.items[0].status, "confirmed");
  assert.equal(one.json.data.items[0].contactId, ids.contact);
  assert.ok(one.json.data.resources.some((r) => r.name === "Harbour Room"));

  // Overlap: a hold over the confirmed booking (inserted directly; the API would refuse it).
  const { Booking } = models;
  await Booking.create({ workspaceId: ids.wsId, createdBy: ids.admin, contactId: ids.contact, resourceName: "Harbour Room", startAt: day(1, 10, 30), endAt: day(1, 11, 30), status: "held", holdExpiresAt: day(3, 0) });
  // Expired hold and cancelled booking in the same slot.
  await Booking.create({ workspaceId: ids.wsId, createdBy: ids.admin, contactId: ids.contact, resourceName: "Harbour Room", startAt: day(1, 10), endAt: day(1, 11), status: "held", holdExpiresAt: new Date(Date.now() - 60000) });
  await Booking.create({ workspaceId: ids.wsId, createdBy: ids.admin, contactId: ids.contact, resourceName: "Harbour Room", startAt: day(1, 10), endAt: day(1, 11), status: "cancelled" });
  const many = await api(`/calendar/week?from=${from}&days=1`);
  const statuses = many.json.data.items.map((i) => i.status).sort();
  assert.deepEqual(statuses, ["cancelled", "confirmed", "expired", "held"]);
  assert.equal(many.json.data.conflicts.length, 1, "only the live hold conflicts; expired/cancelled do not");

  // Expired holds no longer block the slot.
  const avail = await api(`/calendar/availability?startAt=${encodeURIComponent(day(1, 10).toISOString())}&endAt=${encodeURIComponent(day(1, 10, 20).toISOString())}&resourceName=Harbour%20Room`);
  assert.equal(avail.json.data.conflicts.length, 1);
  assert.equal(avail.json.data.conflicts[0].status, "confirmed");
});

test("Phase 2: global search returns the contact with its bookings, deals and company", { skip }, async () => {
  const r = await api(`/search?q=${encodeURIComponent("Janet")}&limit=20`, { as: "operator" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const c = r.json.data.contacts.find((x) => x.id === ids.contact);
  assert.ok(c, "contact found");
  assert.equal(c.company.id, ids.company);
  assert.ok(c.bookingCount >= 1);
  assert.ok(c.dealCount >= 1);
  assert.ok(r.json.data.bookings.some((b) => b.id === ids.booking), "contact name finds the booking");
  assert.ok(r.json.data.deals.some((d) => d.id === ids.deal));
  const short = await api(`/search?q=J`);
  assert.deepEqual(short.json.data.contacts, []);
});

test("Phase 2: contact list carries counts and matches company name", { skip }, async () => {
  const r = await api(`/contacts?search=${encodeURIComponent("Aurora")}`, { as: "operator" });
  const row = r.json.data.find((c) => c._id === ids.contact);
  assert.ok(row, "company-name search finds the contact");
  assert.ok(row.bookingCount >= 1 && row.dealCount >= 1);
  const tag = await api(`/contacts?tag=vip`);
  assert.equal(tag.status, 200);
  assert.ok(!tag.json.data.some((c) => c._id === ids.contact));
  await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { tags: ["vip"] } });
  assert.ok((await api(`/contacts?tag=vip`)).json.data.some((c) => c._id === ids.contact));
  const archivedAll = await api(`/contacts?isArchived=all`);
  assert.equal(archivedAll.status, 200);
});

test("Phase 2: partial updates do not reset other fields", { skip }, async () => {
  const before = (await api(`/contacts/${ids.contact}`)).json.data;
  await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { language: "zh" } });
  await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { phone: "+852 9123-4567" } });
  const after = (await api(`/contacts/${ids.contact}`)).json.data;
  assert.equal(after.lastName, before.lastName, "lastName kept");
  assert.equal(after.language, "zh", "language kept");
  await api(`/tasks/${ids.task}`, { as: "operator", method: "PATCH", body: { priority: "urgent", status: "in_progress" } });
  const t = (await api(`/tasks/${ids.task}`, { as: "operator", method: "PATCH", body: { title: "Call Janet (renamed)" } })).json.data;
  assert.equal(t.priority, "urgent");
  assert.equal(t.status, "in_progress");
});

test("Phase 2: booking list search by contact and expiry-aware status filter", { skip }, async () => {
  const bySearch = await api(`/bookings?search=${encodeURIComponent("janet")}&limit=100`);
  assert.equal(bySearch.status, 200);
  assert.ok(bySearch.json.data.items.some((b) => b._id === ids.booking));
  const held = await api(`/bookings?status=held&limit=100`);
  assert.ok(held.json.data.items.every((b) => b.displayStatus === "held"), "lapsed holds are not listed as held");
  const expired = await api(`/bookings?status=expired&limit=100`);
  assert.ok(expired.json.data.items.length >= 1);
  assert.ok(expired.json.data.items.every((b) => b.displayStatus === "expired"));
  const tasks = await api(`/tasks?search=renamed`, { as: "operator" });
  assert.ok(tasks.json.data.some((t) => t._id === ids.task));
  const forms = await api(`/forms`);
  assert.equal(forms.status, 200);
  assert.deepEqual(forms.json.data.items, []);
});

test("Migration: dry run writes nothing; apply and down are reversible", { skip }, async () => {
  const m = await import("../src/migrations/20261109-phase1-foundation.js");
  const { Contact, Resource, Booking } = models;
  const lines = [];
  const log = (l) => lines.push(l);
  // Simulate a legacy contact saved before phoneNormalized existed.
  const legacy = await Contact.collection.insertOne({ workspaceId: ids.wsId, firstName: "Legacy", lastName: "Phone", phone: "+852 5555 1234", ownerId: ids.admin, isArchived: false });
  await Booking.collection.updateMany({}, { $unset: { resourceId: "" } });

  await m.up({ apply: false, log });
  assert.equal((await Contact.collection.findOne({ _id: legacy.insertedId })).phoneNormalized, undefined);
  assert.equal(await Resource.countDocuments(), 0);

  await m.up({ apply: true, log });
  assert.equal((await Contact.collection.findOne({ _id: legacy.insertedId })).phoneNormalized, "85255551234");
  assert.ok(await Resource.exists({ name: "Harbour Room" }));
  assert.equal(await Booking.countDocuments({ resourceName: "Harbour Room", resourceId: { $exists: false } }), 0);
  await m.up({ apply: true, log }); // idempotent
  assert.equal(await Resource.countDocuments({ name: "Harbour Room" }), 1);

  await m.down({ apply: true, log });
  assert.equal((await Contact.collection.findOne({ _id: legacy.insertedId })).phoneNormalized, undefined);
  assert.equal(await Resource.countDocuments(), 0);
  assert.equal(await Booking.countDocuments({ resourceId: { $exists: true } }), 0);
  // Data created by users is untouched.
  assert.ok(await Contact.exists({ _id: ids.contact }));
  assert.ok(await Booking.exists({ _id: ids.booking }));
});
