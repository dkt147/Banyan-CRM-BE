/*
 * Client feedback round (26 Nov 2026): notes, detailed timeline, birthdays, editable contact tags,
 * Xero invoice pull.
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/banyan_round26_test node --test tests/round-2026-11-26.test.js
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_ACCESS_SECRET ||= "r26-access";
process.env.JWT_REFRESH_SECRET ||= "r26-refresh";
process.env.MONGODB_URI ||= process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:1/unused";
process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "c".repeat(64);
process.env.BANYAN_BOOKING_SYNC_MINUTES = "0";

const { normalizeBirthday, formatBirthday } = await import("../src/utils/birthday.js");
const { mapXeroStatus, xeroDate } = await import("../src/services/xeroInvoiceSync.service.js");
const { tagKeyFromLabel } = await import("../src/services/contactTags.service.js");

test("C birthday rules; D tag keys; E Xero status and dates", () => {
  assert.equal(normalizeBirthday("03-14"), "03-14");
  assert.equal(normalizeBirthday("1990-03-14"), "1990-03-14");
  assert.equal(normalizeBirthday("02-29"), "02-29");
  assert.equal(normalizeBirthday("2000-02-29"), "2000-02-29");
  assert.equal(normalizeBirthday(null), null);
  assert.equal(normalizeBirthday(""), null);
  for (const bad of ["2023-02-29", "1899-01-01", "13-01", "04-31", "14/03", "3000-01-01"])
    assert.throws(() => normalizeBirthday(bad), (e) => e.code === "INVALID_BIRTHDAY", bad);
  assert.equal(formatBirthday("03-14"), "14 Mar");
  assert.equal(formatBirthday("1990-03-14"), "14 Mar 1990");

  assert.equal(tagKeyFromLabel("VIP Client!"), "vip_client");
  assert.equal(tagKeyFromLabel("  Coworking -- Day Pass "), "coworking_day_pass");
  assert.equal(tagKeyFromLabel("!!!"), "");

  const now = new Date("2026-11-27T04:00:00Z");
  assert.equal(mapXeroStatus({ Status: "DRAFT" }, now), "draft");
  assert.equal(mapXeroStatus({ Status: "SUBMITTED" }, now), "draft");
  assert.equal(mapXeroStatus({ Status: "AUTHORISED", DueDateString: "2026-12-01T00:00:00" }, now), "awaiting");
  assert.equal(mapXeroStatus({ Status: "AUTHORISED", DueDateString: "2026-11-01T00:00:00" }, now), "overdue");
  assert.equal(mapXeroStatus({ Status: "PAID" }, now), "paid");
  assert.equal(mapXeroStatus({ Status: "VOIDED" }, now), "cancelled");
  assert.equal(mapXeroStatus({ Status: "DELETED" }, now), "cancelled");
  assert.equal(xeroDate("/Date(1767225600000+0000)/").toISOString(), "2026-01-01T00:00:00.000Z");
});

/* ---------- fake Xero ---------- */
const realFetch = globalThis.fetch;
const xero = { invoices: [], contacts: new Map(), requests: [], writes: 0 };
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  if (url.hostname !== "api.xero.com") return realFetch(input, init);
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  xero.requests.push({ method, path: url.pathname, search: url.search, since: headers.get("if-modified-since") });
  if (method !== "GET") { xero.writes++; return json(405, { Message: "not allowed in test" }); }
  const p = url.pathname.replace("/api.xro/2.0", "");
  if (p === "/Invoices") {
    const page = Number(url.searchParams.get("page") || 1);
    return json(200, { Invoices: xero.invoices.slice((page - 1) * 100, page * 100) });
  }
  const online = p.match(/^\/Invoices\/([^/]+)\/OnlineInvoice$/);
  if (online) return json(200, { OnlineInvoices: [{ OnlineInvoiceUrl: `https://in.xero.com/${online[1]}` }] });
  if (p === "/Contacts") {
    const idsParam = (url.searchParams.get("IDs") || "").split(",");
    return json(200, { Contacts: idsParam.map((id) => xero.contacts.get(id)).filter(Boolean) });
  }
  return json(404, { Message: "Not found" });
};

/* ---------- integration ---------- */
const TEST_URI = process.env.TEST_MONGODB_URI;
const skip = !TEST_URI ? "TEST_MONGODB_URI not set" : !/test/i.test(new URL(TEST_URI).pathname) ? "database name must contain 'test'" : false;
let mongoose, server, base, M = {}, tokens = {}, ids = {};

before(async () => {
  if (skip) return;
  process.env.MONGODB_URI = TEST_URI;
  mongoose = (await import("mongoose")).default;
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  const app = (await import("../src/app.js")).default;
  const { signAccessToken } = await import("../src/utils/tokens.js");
  const { encryptIntegrationToken } = await import("../src/utils/integrationTokens.js");
  for (const n of ["User", "Workspace", "Contact", "Company", "Deal", "Pipeline", "PipelineStage", "Task", "Activity", "AuditLog", "ContactTag", "Invoice", "Integration"])
    M[n] = (await import(`../src/models/${n}.js`))[n];
  for (const n of ["ContactTag", "Deal"]) await M[n].createIndexes();
  const wsId = new mongoose.Types.ObjectId();
  const admin = await M.User.create({ workspaceId: wsId, name: "Felicia", email: "felicia@r26.test", passwordHash: "x", role: "admin" });
  const jojo = await M.User.create({ workspaceId: wsId, name: "Jojo Leung", email: "jojo@r26.test", passwordHash: "x", role: "operator" });
  const kim = await M.User.create({ workspaceId: wsId, name: "Kim", email: "kim@r26.test", passwordHash: "x", role: "operator" });
  const viewer = await M.User.create({ workspaceId: wsId, name: "Vee", email: "vee@r26.test", passwordHash: "x", role: "read_only" });
  await M.Workspace.create({ _id: wsId, name: "Banyan", slug: "round26-test", createdBy: admin._id });
  const company = await M.Company.create({ workspaceId: wsId, name: "Acme Ltd", ownerId: admin._id });
  const contact = await M.Contact.create({ workspaceId: wsId, firstName: "Ken", lastName: "Wong", email: "ken@acme.test", companyId: company._id, ownerId: admin._id });
  const pipeline = await M.Pipeline.create({ workspaceId: wsId, name: "Private office", key: "private-office", ownerId: admin._id });
  const pipeline2 = await M.Pipeline.create({ workspaceId: wsId, name: "Membership", key: "membership", ownerId: admin._id });
  const s1 = await M.PipelineStage.create({ workspaceId: wsId, pipelineId: pipeline._id, name: "Enquiry", key: "enquiry", sortOrder: 0 });
  const s2 = await M.PipelineStage.create({ workspaceId: wsId, pipelineId: pipeline._id, name: "Trial completed", key: "trial", sortOrder: 1 });
  await M.PipelineStage.create({ workspaceId: wsId, pipelineId: pipeline2._id, name: "New lead", key: "new", sortOrder: 0 });
  const deal = await M.Deal.create({ workspaceId: wsId, title: "Ken — office", contactId: contact._id, companyId: company._id, pipelineId: pipeline._id, stageId: s1._id, ownerId: admin._id, value: 0 });
  const other = await M.Company.create({ workspaceId: wsId, name: "Other Co", ownerId: admin._id });
  Object.assign(ids, { wsId, admin: admin._id, jojo: jojo._id, kim: kim._id, company: company._id, other: other._id, contact: contact._id, deal: deal._id, s1: s1._id, s2: s2._id, pipeline2: pipeline2._id });
  for (const [k, u] of Object.entries({ admin, jojo, kim, viewer })) tokens[k] = signAccessToken(u);
  await M.Integration.create({ workspaceId: wsId, provider: "xero", status: "connected", accessTokenEncrypted: encryptIntegrationToken("xero-token"), config: { tenantId: "tenant-1" }, connectedBy: admin._id });
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

const api = async (path, { method = "GET", body, as = "admin" } = {}) => {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokens[as]}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

test("A notes: create on a deal shows on contact and company; validation; author or admin; audit on delete", { skip }, async () => {
  const empty = await api("/notes", { method: "POST", as: "jojo", body: { body: "   ", dealId: String(ids.deal) } });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.code, "NOTE_EMPTY");
  assert.equal((await api("/notes", { method: "POST", as: "jojo", body: { body: "x".repeat(5001), dealId: String(ids.deal) } })).json.code, "NOTE_TOO_LONG");
  assert.equal((await api("/notes", { method: "POST", as: "jojo", body: { body: "hi" } })).json.code, "NOTE_TARGET_REQUIRED");
  assert.equal((await api("/notes", { method: "POST", as: "jojo", body: { body: "hi", contactId: String(new mongoose.Types.ObjectId()) } })).status, 404);
  assert.equal((await api("/notes", { method: "POST", as: "viewer", body: { body: "hi", dealId: String(ids.deal) } })).status, 403);

  const n = await api("/notes", { method: "POST", as: "jojo", body: { body: "  Called Ken, wants a 2-person office from January.\n<b>not html</b>  ", dealId: String(ids.deal) } });
  assert.equal(n.status, 201, JSON.stringify(n.json));
  const note = n.json.data;
  assert.equal(note.body, "Called Ken, wants a 2-person office from January.\n<b>not html</b>");
  assert.deepEqual(note.userId, { _id: String(ids.jojo), name: "Jojo Leung" });
  assert.equal(note.contactId, String(ids.contact), "copied from the deal");
  assert.equal(note.companyId, String(ids.company), "copied from the deal");
  assert.deepEqual(note.dealId, { _id: String(ids.deal), title: "Ken — office" });

  await api("/notes", { method: "POST", as: "kim", body: { body: "Contact-only note", contactId: String(ids.contact) } });
  const byContact = await api(`/notes?contactId=${ids.contact}`);
  assert.equal(byContact.status, 200);
  assert.deepEqual(byContact.json.data.items.map((x) => x.body.slice(0, 12)), ["Contact-only", "Called Ken, "], "newest first");
  assert.equal(byContact.json.data.items[0].companyId, String(ids.company), "contact note carries its company");
  assert.equal((await api(`/notes?companyId=${ids.company}`)).json.data.pagination.total, 2);
  assert.equal((await api(`/notes?dealId=${ids.deal}`)).json.data.items.length, 1);
  assert.equal((await api(`/notes?contactId=${ids.contact}&dealId=${ids.deal}`)).json.code, "NOTE_TARGET_REQUIRED");
  assert.equal((await api(`/notes?companyId=${new mongoose.Types.ObjectId()}`)).status, 404);

  // Author or admin only.
  const denied = await api(`/notes/${note._id}`, { method: "PATCH", as: "kim", body: { body: "hijack" } });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, "NOT_NOTE_AUTHOR");
  const edited = await api(`/notes/${note._id}`, { method: "PATCH", as: "jojo", body: { body: "Edited by Jojo" } });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.data.body, "Edited by Jojo");
  assert.ok(edited.json.data.editedAt);
  assert.equal(edited.json.data.editedBy.name, "Jojo Leung");
  assert.equal((await api(`/notes/${note._id}`, { method: "DELETE", as: "kim" })).status, 403);
  const del = await api(`/notes/${note._id}`, { method: "DELETE", as: "admin" });
  assert.deepEqual(del.json.data, { id: note._id, deleted: true });
  const audit = await M.AuditLog.findOne({ action: "note.deleted" }).lean();
  assert.equal(audit.before.body, "Edited by Jojo");
  assert.equal((await api(`/notes/${note._id}`, { method: "PATCH", as: "admin", body: { body: "x" } })).status, 404);

  const related = await api(`/related/contact/${ids.contact}`);
  assert.equal(related.status, 200, JSON.stringify(related.json));
  assert.equal(related.json.data.sections.notes.total, 1);
  const noteItem = related.json.data.sections.activities.items.find((a) => a.type === "note");
  assert.equal(noteItem.body, "Contact-only note");
  assert.deepEqual(noteItem.user, { id: String(ids.kim), name: "Kim" });
});

test("B timeline: one activity per save with readable before/after; specific titles; nothing when nothing changed", { skip }, async () => {
  const lastActivity = async (filter) => M.Activity.findOne(filter).sort({ createdAt: -1, _id: -1 }).lean();
  const count = (filter) => M.Activity.countDocuments(filter);

  // Stage only.
  let r = await api(`/deals/${ids.deal}`, { method: "PATCH", body: { stageId: String(ids.s2) } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let a = await lastActivity({ type: "deal_updated", dealId: ids.deal });
  assert.equal(a.subject, "Stage changed");
  assert.deepEqual(a.metadata.changes, [{ field: "stageId", label: "Stage", from: "Enquiry", to: "Trial completed" }]);
  assert.deepEqual(a.metadata.changed, ["stageId"]);
  assert.equal(String(a.userId), String(ids.admin));

  // Value + description: one activity with both.
  await api(`/deals/${ids.deal}`, { method: "PATCH", body: { value: 1800, description: "d".repeat(250) } });
  a = await lastActivity({ type: "deal_updated", dealId: ids.deal });
  assert.equal(a.subject, "Deal details updated");
  const value = a.metadata.changes.find((c) => c.field === "value");
  assert.deepEqual([value.label, value.from, value.to], ["Value", "HK$0", "HK$1,800"]);
  const desc = a.metadata.changes.find((c) => c.field === "description");
  assert.equal(desc.from, null);
  assert.equal(desc.to.length, 201);
  assert.ok(desc.to.endsWith("…"));

  // Same values again: no activity.
  const before = await count({ type: "deal_updated", dealId: ids.deal });
  await api(`/deals/${ids.deal}`, { method: "PATCH", body: { value: 1800 } });
  assert.equal(await count({ type: "deal_updated", dealId: ids.deal }), before, "nothing changed -> no activity");

  // Lost, reopened, moved.
  await api(`/deals/${ids.deal}`, { method: "PATCH", body: { status: "lost", lostReason: "Budget" } });
  assert.equal((await lastActivity({ type: "deal_updated", dealId: ids.deal })).subject, "Deal marked lost");
  await api(`/deals/${ids.deal}`, { method: "PATCH", body: { status: "open" } });
  assert.equal((await lastActivity({ type: "deal_updated", dealId: ids.deal })).subject, "Deal reopened");
  await api(`/deals/${ids.deal}`, { method: "PATCH", body: { pipelineId: String(ids.pipeline2) } });
  a = await lastActivity({ type: "deal_updated", dealId: ids.deal });
  assert.equal(a.subject, "Moved to Membership");
  assert.deepEqual(a.metadata.changes.find((c) => c.field === "pipelineId"), { field: "pipelineId", label: "Pipeline", from: "Private office", to: "Membership" });
  assert.deepEqual(a.metadata.changes.find((c) => c.field === "stageId").to, "New lead");

  // Contact: tags only -> "Tags changed" with labels; other edits -> "Contact updated" with birthday text.
  r = await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { tags: ["vip", "walk_in"] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  a = await lastActivity({ type: "contact_updated", contactId: ids.contact });
  assert.equal(a.subject, "Tags changed");
  assert.deepEqual(a.metadata.changes, [{ field: "tags", label: "Tags", from: null, to: "VIP, Walk-in" }]);
  await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { jobTitle: "Director", birthday: "1990-03-14", companyId: String(ids.other) } });
  a = await lastActivity({ type: "contact_updated", contactId: ids.contact });
  assert.equal(a.subject, "Contact updated");
  const ch = Object.fromEntries(a.metadata.changes.map((c) => [c.field, [c.from, c.to]]));
  assert.deepEqual(ch, { jobTitle: [null, "Director"], birthday: [null, "14 Mar 1990"], companyId: ["Acme Ltd", "Other Co"] });
  const n = await count({ type: "contact_updated", contactId: ids.contact });
  await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { jobTitle: "Director" } });
  assert.equal(await count({ type: "contact_updated", contactId: ids.contact }), n);
  await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { companyId: String(ids.company) } });

  // Company.
  await api(`/companies/${ids.company}`, { method: "PATCH", body: { industry: "Finance" } });
  a = await lastActivity({ type: "company_updated", companyId: ids.company });
  assert.equal(a.subject, "Company updated");
  assert.deepEqual(a.metadata.changes, [{ field: "industry", label: "Industry", from: null, to: "Finance" }]);

  // Task: reassign, then complete.
  const task = await M.Task.create({ workspaceId: ids.wsId, title: "Call Ken", contactId: ids.contact, dealId: ids.deal, assignedTo: ids.admin, createdBy: ids.admin, dueAt: new Date("2026-12-01T02:00:00Z") });
  await api(`/tasks/${task._id}`, { method: "PATCH", body: { assignedTo: String(ids.jojo), dueAt: "2026-12-02T01:30:00.000Z" } });
  a = await lastActivity({ type: "task_updated", "metadata.taskId": task._id });
  assert.equal(a.subject, "Task updated");
  const tc = Object.fromEntries(a.metadata.changes.map((c) => [c.field, [c.from, c.to]]));
  assert.deepEqual(tc.assignedTo, ["Felicia", "Jojo Leung"]);
  assert.deepEqual(tc.dueAt, ["1 Dec 2026, 10:00", "2 Dec 2026, 09:30"]);
  await api(`/tasks/${task._id}/complete`, { method: "PATCH", body: {} });
  a = await lastActivity({ type: "task_updated", "metadata.taskId": task._id });
  assert.equal(a.subject, "Task completed");
  assert.deepEqual(a.metadata.changes.map((c) => c.field), ["status"]);

  // /related: user, changes, newest first, true total.
  const rel = await api(`/related/deal/${ids.deal}`);
  const items = rel.json.data.sections.activities.items;
  assert.ok(items.length <= 50);
  assert.equal(rel.json.data.sections.activities.total, await M.Activity.countDocuments({ workspaceId: ids.wsId, dealId: ids.deal }));
  const moved = items.find((i) => i.title === "Moved to Membership");
  assert.deepEqual(moved.user, { id: String(ids.admin), name: "Felicia" });
  assert.ok(moved.changes.length >= 2 && moved.changed.includes("pipelineId"));
  assert.ok(new Date(items[0].date) >= new Date(items.at(-1).date));
});

test("C birthdays: stored with month-day, HK today and upcoming, archived left out, 29 Feb on 28 Feb", { skip }, async () => {
  const bad = await api("/contacts", { method: "POST", body: { firstName: "Bad", birthday: "2023-02-29" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "INVALID_BIRTHDAY");
  const created = await api("/contacts", { method: "POST", body: { firstName: "Bea", birthday: "03-14", companyId: String(ids.company) } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.data.birthday, "03-14");
  const bea = await M.Contact.findById(created.json.data._id).lean();
  assert.equal(bea.birthdayMonthDay, "03-14");
  await api(`/contacts/${bea._id}`, { method: "PATCH", body: { birthday: null } });
  assert.equal((await M.Contact.findById(bea._id).lean()).birthdayMonthDay, null);

  const { contactBirthdays } = await import("../src/services/birthdays.service.js");
  const mk = (firstName, birthday, extra = {}) => M.Contact.create({ workspaceId: ids.wsId, firstName, birthday, ownerId: ids.admin, companyId: ids.company, ...extra });
  await mk("Today", "11-27");
  await mk("Soon", "1985-11-29");
  await mk("Later", "12-10");
  await mk("Gone", "11-27", { isArchived: true });
  await mk("Leap", "02-29");
  // 27 Nov 2026 08:00 HK = 00:00 UTC.
  const r = await contactBirthdays(ids.wsId, { days: 7, now: new Date("2026-11-27T00:00:00Z") });
  assert.equal(r.date, "2026-11-27");
  assert.deepEqual(r.today.map((c) => c.firstName), ["Today"]);
  assert.equal(r.today[0].companyId.name, "Acme Ltd");
  assert.deepEqual(r.upcoming.map((c) => [c.firstName, c.nextBirthday, c.inDays]), [["Today", "2026-11-27", 0], ["Soon", "2026-11-29", 2]]);
  // 26 Nov 23:30 HK is still the 26th.
  assert.equal((await contactBirthdays(ids.wsId, { days: 0, now: new Date("2026-11-26T15:30:00Z") })).today.length, 0);
  const feb = await contactBirthdays(ids.wsId, { days: 0, now: new Date("2027-02-28T04:00:00Z") });
  assert.deepEqual(feb.today.map((c) => c.firstName), ["Leap"], "29 Feb shown on 28 Feb in a non-leap year");
  await assert.rejects(contactBirthdays(ids.wsId, { days: 40 }), (e) => e.statusCode === 400);

  const route = await api("/contacts/birthdays?days=31");
  assert.equal(route.status, 200, JSON.stringify(route.json));
  assert.ok(Array.isArray(route.json.data.today) && Array.isArray(route.json.data.upcoming));
  assert.equal((await api("/contacts/birthdays?days=99")).status, 400);
});

test("D contact tags: seeded from the catalogue, create, rename keeps key, archive, no group change for system tags", { skip }, async () => {
  const list = await api("/contact-tags");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const items = list.json.data.items;
  assert.equal(items[0].group, "segment", "segment tags first");
  assert.ok(items.find((t) => t.key === "walk_in").isSystem);
  assert.ok(!items.find((t) => t.key === "vip").isSystem);

  assert.equal((await api("/contact-tags", { method: "POST", as: "jojo", body: { label: "Partner" } })).status, 403);
  const created = await api("/contact-tags", { method: "POST", body: { label: "Corporate Partner!", description: "Partner companies", group: "segment" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.data.key, "corporate_partner");
  assert.equal((await api("/contact-tags", { method: "POST", body: { label: "corporate partner" } })).json.code, "TAG_EXISTS");
  assert.equal((await api("/contact-tags", { method: "POST", body: { label: "VIP" } })).json.code, "TAG_EXISTS");
  assert.equal((await api("/contact-tags", { method: "POST", body: { label: "!!!" } })).json.code, "INVALID_TAG");
  assert.equal((await api("/contact-tags", { method: "POST", body: { label: "x".repeat(51) } })).status, 400);

  const vip = items.find((t) => t.key === "vip");
  const renamed = await api(`/contact-tags/${vip.id}`, { method: "PATCH", body: { label: "Very important", key: "vip" } });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
  assert.equal(renamed.json.data.key, "vip", "key never changes");
  assert.equal((await api(`/contact-tags/${vip.id}`, { method: "PATCH", body: { key: "very_important" } })).json.code, "TAG_KEY_IMMUTABLE");
  assert.equal((await api(`/contact-tags/${vip.id}`, { method: "PATCH", body: { label: "Prospect" } })).json.code, "TAG_EXISTS");
  const walkIn = items.find((t) => t.key === "walk_in");
  assert.equal((await api(`/contact-tags/${walkIn.id}`, { method: "PATCH", body: { group: "segment" } })).json.code, "TAG_SYSTEM_GROUP");
  assert.equal((await api(`/contact-tags/${created.json.data.id}`, { method: "PATCH", body: { isActive: false } })).json.data.isActive, false);
  assert.ok(!(await api("/contact-tags")).json.data.items.some((t) => t.key === "corporate_partner"), "archived hidden");
  assert.ok((await api("/contact-tags?includeInactive=true")).json.data.items.some((t) => t.key === "corporate_partner"));
  assert.equal((await api("/contact-tags", { method: "POST", body: { label: "Corporate partner" } })).json.code, "TAG_EXISTS", "archived names are taken");
  assert.ok(await M.AuditLog.exists({ action: "contact_tag.updated", entityId: vip._id }));

  // The catalogue comes from the database; the renamed label shows in the timeline.
  const cat = await api("/contacts/tag-catalogue");
  assert.equal(cat.json.data.tags.find((t) => t.key === "vip").label, "Very important");
  assert.ok(cat.json.data.pattern && cat.json.data.maxPerContact);
  // Seeding again never overwrites an edited label.
  const { ensureContactTags, resetContactTagSeedCache } = await import("../src/services/contactTags.service.js");
  resetContactTagSeedCache();
  await ensureContactTags(ids.wsId);
  assert.equal((await M.ContactTag.findOne({ workspaceId: ids.wsId, key: "vip" }).lean()).label, "Very important");
  await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { tags: ["vip"] } });
  const a = await M.Activity.findOne({ type: "contact_updated", contactId: ids.contact }).sort({ createdAt: -1, _id: -1 }).lean();
  assert.deepEqual(a.metadata.changes[0], { field: "tags", label: "Tags", from: "Very important, Walk-in", to: "Very important" });
});

test("E Xero pull: upsert, status map, links by email / company name / #deal, never writes, If-Modified-Since next time", { skip }, async () => {
  const deal = await M.Deal.findById(ids.deal).lean();
  const pushed = await M.Invoice.create({ workspaceId: ids.wsId, provider: "xero", externalId: "inv-pushed", invoiceNumber: "INV-1", contactId: ids.contact, dealId: ids.deal, status: "paid", total: 100, createdBy: ids.admin });
  xero.contacts.set("xc-ken", { ContactID: "xc-ken", Name: "Ken Wong", EmailAddress: "KEN@acme.test" });
  xero.contacts.set("xc-other", { ContactID: "xc-other", Name: "other co" });
  xero.contacts.set("xc-nobody", { ContactID: "xc-nobody", Name: "Nobody Ltd", EmailAddress: "x@nowhere.test" });
  xero.invoices = [
    { InvoiceID: "inv-a", InvoiceNumber: "INV-100", Type: "ACCREC", Status: "AUTHORISED", Contact: { ContactID: "xc-ken", Name: "Ken Wong" }, Total: 1800, SubTotal: 1800, TotalTax: 0, CurrencyCode: "HKD", DueDateString: "2026-12-15T00:00:00", LineItems: [{ Description: "Private office December" }], Reference: "" },
    { InvoiceID: "inv-b", InvoiceNumber: "INV-101", Type: "ACCREC", Status: "PAID", Contact: { ContactID: "xc-other", Name: "other co" }, Total: 500, FullyPaidOnDate: "/Date(1767225600000+0000)/", LineItems: [{ Description: "Day passes" }] },
    { InvoiceID: "inv-c", InvoiceNumber: "INV-102", Type: "ACCREC", Status: "DRAFT", Contact: { ContactID: "xc-nobody", Name: "Nobody Ltd" }, Total: 50, Reference: `Office #${deal.dealNumber}` },
    { InvoiceID: "inv-d", InvoiceNumber: "INV-103", Type: "ACCREC", Status: "VOIDED", Contact: { ContactID: "xc-nobody", Name: "Nobody Ltd" }, Total: 10 },
    { InvoiceID: "inv-pushed", InvoiceNumber: "INV-1", Type: "ACCREC", Status: "AUTHORISED", Contact: { ContactID: "xc-ken" }, Total: 100, DueDateString: "2026-12-30T00:00:00" },
  ];
  assert.equal((await api("/integrations/xero/sync-invoices", { method: "POST", as: "jojo" })).status, 403);
  const r = await api("/integrations/xero/sync-invoices", { method: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(
    { fetched: r.json.data.fetched, created: r.json.data.created, updated: r.json.data.updated, linkedToContact: r.json.data.linkedToContact, linkedToCompany: r.json.data.linkedToCompany, unmatched: r.json.data.unmatched },
    { fetched: 5, created: 4, updated: 1, linkedToContact: 1, linkedToCompany: 2, unmatched: 1 },
  );
  assert.equal(xero.writes, 0, "never writes to Xero");
  const first = xero.requests.find((q) => q.path.endsWith("/Invoices"));
  assert.match(decodeURIComponent(first.search), /Date>=DateTime\(2026,01,01\)/);
  assert.equal(first.since, null);

  const byId = async (id) => M.Invoice.findOne({ workspaceId: ids.wsId, externalId: id }).lean();
  const a = await byId("inv-a");
  assert.deepEqual([a.status, a.total, a.currency, a.source, a.description, String(a.contactId), String(a.companyId)], ["awaiting", 1800, "HKD", "xero_sync", "Private office December", String(ids.contact), String(ids.company)]);
  assert.equal(a.metadata.xeroContactId, "xc-ken");
  assert.equal(a.metadata.onlineInvoiceUrl, "https://in.xero.com/inv-a");
  assert.equal(String(a.createdBy), String(ids.admin));
  const b = await byId("inv-b");
  assert.deepEqual([b.status, String(b.companyId), b.contactId ?? null], ["paid", String(ids.other), null]);
  assert.equal(b.paidAt.toISOString(), "2026-01-01T00:00:00.000Z");
  const c = await byId("inv-c");
  assert.deepEqual([c.status, String(c.dealId), String(c.contactId)], ["draft", String(ids.deal), String(ids.contact)], "linked by #dealNumber");
  const d = await byId("inv-d");
  assert.deepEqual([d.status, d.contactId ?? null, d.companyId ?? null], ["cancelled", null, null]);
  const p = await byId("inv-pushed");
  assert.equal(p.status, "paid", "a CRM payment is never undone by Xero");
  assert.equal(String(p.dealId), String(ids.deal), "the CRM's deal link is kept");
  assert.equal(p.source, undefined);

  const integ = await M.Integration.findOne({ workspaceId: ids.wsId, provider: "xero" }).lean();
  assert.equal(integ.config.invoiceSync.lastResult.created, 4);
  const status = await api("/integrations/xero/status");
  assert.equal(status.json.data.invoiceSync.lastResult.fetched, 5);

  // Next run: If-Modified-Since, no date filter, upsert (no duplicates).
  xero.requests.length = 0;
  xero.invoices = [{ ...xero.invoices[0], Status: "PAID", FullyPaidOnDate: "/Date(1767312000000+0000)/" }];
  const again = await api("/integrations/xero/sync-invoices", { method: "POST" });
  assert.deepEqual([again.json.data.created, again.json.data.updated], [0, 1]);
  const second = xero.requests.find((q) => q.path.endsWith("/Invoices"));
  assert.ok(second.since, "If-Modified-Since sent");
  assert.doesNotMatch(decodeURIComponent(second.search), /DateTime/);
  assert.equal((await byId("inv-a")).status, "paid");
  assert.equal(await M.Invoice.countDocuments({ workspaceId: ids.wsId, externalId: "inv-a" }), 1);

  // The invoices tab: any signed-in role can list a contact's invoices.
  const list = await api(`/invoices?contactId=${ids.contact}&sort=createdAt&order=desc&limit=20`, { as: "jojo" });
  assert.equal(list.status, 200, JSON.stringify(list.json));
  void pushed;
});
