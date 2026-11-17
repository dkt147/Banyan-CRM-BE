/*
 * CRM feedback round (17 Nov 2026): purchases, tags, reports, forms, templates, room calendars.
 *  - Unit tests always run.
 *  - Integration tests need a throwaway MongoDB whose name contains "test":
 *      TEST_MONGODB_URI=mongodb://127.0.0.1:27017/banyan_feedback_test node --test tests/crm-feedback.test.js
 * Google Calendar and Gmail are replaced by an in-memory fake; nothing leaves the machine.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.JWT_ACCESS_SECRET ||= "feedback-test-access-secret";
process.env.JWT_REFRESH_SECRET ||= "feedback-test-refresh-secret";
process.env.MONGODB_URI ||= process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:1/unused";
process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
process.env.BANYAN_CRM_TOKEN = "fb-wp-token";
// Fake WordPress (see the fetch interceptor below); nothing reaches banyanworkspace.com.
process.env.BANYAN_WP_API_URL = "https://wp.test/wp-json/banyan/v1/";
process.env.BANYAN_BOOKING_SYNC_MINUTES = "0";
process.env.PUBLIC_ENQUIRY_WORKSPACE_ID = "";
process.env.PUBLIC_ENQUIRY_WORKSPACE_SLUG = "crm-feedback-test";
process.env.PUBLIC_WEBSITE_URL = "https://banyanworkspace.com";
process.env.CLIENT_URL = "https://banyan-crm-admin.vercel.app";

const { renderTemplate, renderString } = await import("../src/services/template.service.js");
const { buildMime, htmlToText } = await import("../src/utils/mail.js");
const { normalizeTag } = await import("../src/utils/contactTags.js");
const { eventToSlots } = await import("../src/services/partnerBlocks.service.js");
const { eventIdFor, isOwnedEvent, desiredCalendarState, DEFAULT_LIBRARY_CALENDAR } = await import("../src/services/roomCalendar.service.js");
const { validateSubmission } = await import("../src/services/formSubmission.service.js");

/* ---------- unit ---------- */
test("templates: variables filled, unknown kept, HTML values escaped", () => {
  const out = renderTemplate(
    { subject: "Hi {{firstName}}", body: "<p>Dear {{ fullName }}, room {{roomName}} {{unknownKey}}</p>" },
    { contact: { firstName: "Jane", lastName: "<Chan>" }, booking: { startAt: "2026-11-13T02:00:00Z", endAt: "2026-11-13T04:00:00Z", resourceName: "Library" } },
  );
  assert.equal(out.subject, "Hi Jane");
  assert.equal(out.isHtml, true);
  assert.match(out.body, /Dear Jane &lt;Chan&gt;, room Library \{\{unknownKey\}\}/);
  assert.equal(renderString("{{bookingDate}}", { bookingDate: "Fri, 13 Nov 2026" }), "Fri, 13 Nov 2026");
});

test("mail: HTML goes out as multipart/alternative with a text part", () => {
  const mime = buildMime({ to: "a@b.com", subject: "Hello – ünicode", html: "<p>Hello <b>Jane</b></p><p><a href=\"https://x.y\">Book</a></p>" });
  assert.match(mime, /multipart\/alternative; boundary="banyan_/);
  assert.match(mime, /Content-Type: text\/plain/);
  assert.match(mime, /Content-Type: text\/html/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.equal(htmlToText("<p>Hello <b>Jane</b></p><p><a href=\"https://x.y\">Book</a></p>"), "Hello Jane\n\nBook (https://x.y)");
  assert.match(buildMime({ to: "a@b.com", subject: "x", text: "plain" }), /Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\ncGxhaW4=/);
  assert.throws(() => buildMime({ to: "a@b.com\r\nBcc: x@y.z", subject: "x", text: "y" }), /line breaks/);
});

test("tags: normalised to snake_case", () => {
  assert.equal(normalizeTag(" Active Member "), "active_member");
  assert.equal(normalizeTag("test-booking"), "test_booking");
  assert.equal(normalizeTag("VIP!!"), "vip");
});

test("partner blocks: events become whole-hour weekday slots inside opening hours", () => {
  // Mon 16 Nov 2026 10:30–11:15 HK → 10:00, 2 hours
  assert.deepEqual(eventToSlots({ start: { dateTime: "2026-11-16T10:30:00+08:00" }, end: { dateTime: "2026-11-16T11:15:00+08:00" } }), [{ date: "2026-11-16", start: 10, hours: 2 }]);
  // 07:00–20:00 clipped to 09–18
  assert.deepEqual(eventToSlots({ start: { dateTime: "2026-11-17T07:00:00+08:00" }, end: { dateTime: "2026-11-17T20:00:00+08:00" } }), [{ date: "2026-11-17", start: 9, hours: 9 }]);
  // All-day Fri–Mon skips the weekend
  assert.deepEqual(eventToSlots({ start: { date: "2026-11-20" }, end: { date: "2026-11-24" } }).map((s) => s.date), ["2026-11-20", "2026-11-23"]);
  assert.deepEqual(eventToSlots({ start: { dateTime: "2026-11-21T10:00:00+08:00" }, end: { dateTime: "2026-11-21T12:00:00+08:00" } }), []);
});

test("room calendar: deterministic Google-safe ids, ownership check, no backfill", () => {
  const id = eventIdFor("BNY-7K3Q9P");
  assert.match(id, /^[a-v0-9]{5,1024}$/);
  assert.equal(id, eventIdFor("BNY-7K3Q9P"));
  assert.equal(isOwnedEvent({ extendedProperties: { private: { banyanSource: "crm-room-booking", banyanRef: "BNY-1" } } }, "BNY-1"), true);
  assert.equal(isOwnedEvent({ extendedProperties: { private: { banyanSource: "crm-room-booking", banyanRef: "BNY-2" } } }, "BNY-1"), false);
  assert.equal(isOwnedEvent({ summary: "partner meeting" }, "BNY-1"), false);

  const settings = { saved: true, includePending: false, calendars: { library: DEFAULT_LIBRARY_CALENDAR }, pushFrom: { library: "2026-11-17T00:00:00Z" } };
  const b = (status, paidAt) => ({ endAt: new Date(Date.now() + 86400000), createdAt: new Date(), metadata: { wp: { status, roomKey: "library", payment: { paidAt } } } });
  assert.equal(desiredCalendarState(b("paid", "2026-11-18T00:00:00Z"), settings).present, true);
  assert.equal(desiredCalendarState(b("paid", "2026-11-10T00:00:00Z"), settings).reason, "before_push_start");
  assert.equal(desiredCalendarState(b("pending", "2026-11-18T00:00:00Z"), settings).present, false);
  assert.equal(desiredCalendarState(b("paid", "2026-11-18T00:00:00Z"), { ...settings, saved: false }).present, false);
});

test("forms: submission validation", () => {
  const form = { fields: [
    { key: "email", label: "Email", type: "email", mapTo: "email", required: true, options: [] },
    { key: "interests", label: "Interested in", type: "checkboxes", mapTo: "interests", required: true, options: ["Meeting Rooms", "Virtual Office"] },
  ] };
  assert.deepEqual(validateSubmission(form, { email: "a@b.co", interests: ["Meeting Rooms"] }).mapped, { email: "a@b.co", interests: ["Meeting Rooms"] });
  assert.throws(() => validateSubmission(form, { email: "nope", interests: ["Meeting Rooms"] }), /valid email/);
  assert.throws(() => validateSubmission(form, { email: "a@b.co", interests: ["Hack"] }), /not an option/);
  assert.throws(() => validateSubmission(form, { email: "a@b.co" }), /at least one option/);
});

/* ---------- fake Google (Calendar + Gmail) ---------- */
const google = { calendars: new Map(), requests: [], sentMail: [], writable: new Set() };
const realFetch = globalThis.fetch;

/* ---------- fake WordPress plugin 1.1.1: /checkout, /bookings?ref=, /blocks ---------- */
const wpFake = { bookings: new Map(), blocks: new Map(), checkouts: [], requests: [], clashRoomDates: new Set(), seq: 0 };
async function fakeWordPress(url, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const token = new Headers(init.headers).get("x-banyan-token");
  wpFake.requests.push({ method, path: url.pathname, body, token });
  const p = url.pathname.replace("/wp-json/banyan/v1/", "");
  const out = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (token !== "fb-wp-token") return out(401, { code: "rest_forbidden", message: "Sorry, you are not allowed to do that." });
  if (p === "checkout" && method === "POST") {
    const ref = `BNY-CK${String(++wpFake.seq).padStart(4, "0")}`;
    const hh = (h) => String(h).padStart(2, "0");
    wpFake.checkouts.push(body);
    wpFake.bookings.set(ref, {
      booking: { ref, status: "pending", channel: "web", room_key: body.room, room_name: "The Library", date: body.date, start_time: `${hh(body.start)}:00`, end_time: `${hh(body.start + body.hours)}:00`, hours: body.hours, start_iso: `${body.date}T${hh(body.start)}:00:00+08:00`, end_iso: `${body.date}T${hh(body.start + body.hours)}:00:00+08:00`, created_at: new Date().toISOString() },
      customer: { first_name: body.first_name, last_name: body.last_name, email: body.email, phone: body.phone, notes: body.notes },
      payment: { mode: "test", status: "pending" },
    });
    return out(200, { url: `https://checkout.stripe.com/c/pay/cs_test_${ref}#fid`, ref, session_id: `cs_test_${ref}` });
  }
  if (p === "bookings" && method === "GET") return out(200, { bookings: [wpFake.bookings.get(url.searchParams.get("ref"))].filter(Boolean) });
  if (p === "blocks" && method === "POST") {
    if (wpFake.clashRoomDates.has(`${body.room}|${body.date}`))
      return out(409, { message: "Requested hours overlap customer booking BNY-PAID01. No block was created.", conflicts: ["BNY-PAID01"] });
    const ref = `BNY-BL${String(++wpFake.seq).padStart(4, "0")}`;
    wpFake.blocks.set(ref, body);
    return out(201, { ref, status: "blocked", existing: false, ...body });
  }
  const del = p.match(/^blocks\/(.+)$/);
  if (del && method === "DELETE") {
    if (!wpFake.blocks.has(del[1])) return out(404, { message: `Booking ${del[1]} not found.` });
    wpFake.blocks.delete(del[1]);
    return out(200, { ok: true, ref: del[1] });
  }
  return out(404, { code: "rest_no_route", message: "No route was found matching the URL and request method." });
}
function cal(id) { if (!google.calendars.has(id)) google.calendars.set(id, new Map()); return google.calendars.get(id); }
const json = (status, data) => new Response(status === 204 ? null : JSON.stringify(data ?? {}), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  if (url.hostname === "wp.test") return fakeWordPress(url, init);
  if (url.hostname !== "www.googleapis.com" && url.hostname !== "gmail.googleapis.com") return realFetch(input, init);
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  google.requests.push({ method, url: url.toString(), body });
  if (url.hostname === "gmail.googleapis.com") { google.sentMail.push(Buffer.from(body.raw, "base64url").toString("utf8")); return json(200, { id: "m1", threadId: "t1" }); }
  const listMatch = url.pathname.match(/^\/calendar\/v3\/users\/me\/calendarList\/(.+)$/);
  if (listMatch) { const id = decodeURIComponent(listMatch[1]); return google.writable.has(id) ? json(200, { id, accessRole: "writer" }) : json(404, { error: { message: "Not Found" } }); }
  const m = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
  if (!m) return json(404, {});
  const events = cal(decodeURIComponent(m[1]));
  const eventId = m[2] ? decodeURIComponent(m[2]) : null;
  if (!eventId && method === "POST") { if (events.has(body.id)) return json(409, { error: { message: "duplicate" } }); events.set(body.id, { ...body, status: "confirmed" }); return json(200, events.get(body.id)); }
  if (!eventId && method === "GET") return json(200, { items: [...events.values()] });
  if (!events.has(eventId)) return json(404, { error: { message: "Not Found" } });
  if (method === "GET") return json(200, events.get(eventId));
  if (method === "PATCH") { events.set(eventId, { ...events.get(eventId), ...body }); return json(200, events.get(eventId)); }
  if (method === "DELETE") { events.delete(eventId); return json(204); }
  return json(400, {});
};

/* ---------- integration ---------- */
const TEST_URI = process.env.TEST_MONGODB_URI;
const skip = !TEST_URI ? "TEST_MONGODB_URI not set" : !/test/i.test(new URL(TEST_URI).pathname) ? "database name must contain 'test'" : false;
let mongoose, server, base, M = {}, tokens = {}, ids = {};

async function api(path, { method = "GET", body, as = "admin", headers = {}, raw } = {}) {
  const res = await realFetch(`${base}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}), ...(body && !raw ? { "Content-Type": "application/json" } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch { j = null; }
  return { status: res.status, json: j, headers: res.headers };
}
const hkMonth = (d = new Date()) => new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 7);

before(async () => {
  if (skip) return;
  process.env.MONGODB_URI = TEST_URI;
  mongoose = (await import("mongoose")).default;
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  const app = (await import("../src/app.js")).default;
  const { signAccessToken } = await import("../src/utils/tokens.js");
  for (const n of ["User", "Workspace", "Contact", "Deal", "Pipeline", "PipelineStage", "Invoice", "Booking", "Integration", "CalendarEvent", "Form", "FormSubmission", "Task", "Template", "Activity"])
    M[n] = (await import(`../src/models/${n}.js`))[n];
  for (const n of ["Booking", "Form", "Contact"]) await M[n].createIndexes();
  const wsId = new mongoose.Types.ObjectId();
  const admin = await M.User.create({ workspaceId: wsId, name: "Felicia", email: "felicia@fb.test", passwordHash: "x", role: "admin" });
  const operator = await M.User.create({ workspaceId: wsId, name: "Op", email: "op@fb.test", passwordHash: "x", role: "operator" });
  await M.Workspace.create({ _id: wsId, name: "Banyan", slug: "crm-feedback-test", createdBy: admin._id });
  const pipeline = await M.Pipeline.create({ workspaceId: wsId, name: "Transactional", key: "transactional", ownerId: admin._id });
  const stage = await M.PipelineStage.create({ workspaceId: wsId, pipelineId: pipeline._id, name: "Enquiry", key: "enquiry" });
  const { encryptIntegrationToken } = await import("../src/utils/integrationTokens.js");
  for (const provider of ["google_calendar", "gmail"])
    await M.Integration.create({ workspaceId: wsId, provider, status: "connected", accessTokenEncrypted: encryptIntegrationToken("fake-token"), config: { email: "team@banyan.test" } });
  Object.assign(ids, { wsId, admin: admin._id, pipeline: pipeline._id, stage: stage._id });
  tokens.admin = signAccessToken(admin);
  tokens.operator = signAccessToken(operator);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  if (skip) return;
  await new Promise((r) => setTimeout(r, 200)); // let queued calendar pushes finish
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("#1 purchases: a won day pass shows under the contact's bookings", { skip }, async () => {
  const c = await api("/contacts", { method: "POST", body: { firstName: "Daisy", lastName: "Pass", email: "daisy@example.com", tags: ["Active Member", "vip"] } });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  ids.contact = c.json.data._id;
  assert.deepEqual(c.json.data.tags, ["active_member", "vip"]);
  const deal = await M.Deal.create({ workspaceId: ids.wsId, title: "Day pass – Daisy", contactId: ids.contact, pipelineId: ids.pipeline, stageId: ids.stage, ownerId: ids.admin, value: 150, productType: "day_pass_package", status: "won" });
  ids.dayPassDeal = deal._id;
  const rel = await api(`/related/contact/${ids.contact}`);
  assert.equal(rel.status, 200, JSON.stringify(rel.json));
  const item = rel.json.data.sections.bookings.items.find((i) => i.id === `deal-${deal._id}`);
  assert.ok(item, JSON.stringify(rel.json.data.sections.bookings));
  assert.equal(item.kind, "purchase");
  assert.equal(item.status, "purchased");
  assert.equal(item.subtitle, "Day pass package · HK$150 · Won");
  // day_pass_package is now a valid product type.
  const created = await api("/deals", { method: "POST", body: { title: "Pkg", contactId: ids.contact, pipelineId: String(ids.pipeline), stageId: String(ids.stage), productType: "day_pass_package" } });
  assert.notEqual(created.status, 400, JSON.stringify(created.json));
});

test("#4 Deal.closedAt: set on won/lost, kept on repeat, cleared on reopen", { skip }, async () => {
  const d = await M.Deal.findById(ids.dayPassDeal);
  assert.ok(d.closedAt, "won on create gets closedAt");
  const open = await M.Deal.create({ workspaceId: ids.wsId, title: "Open", contactId: ids.contact, pipelineId: ids.pipeline, stageId: ids.stage, ownerId: ids.admin });
  assert.equal(open.closedAt, null);
  await M.Deal.updateOne({ _id: open._id }, { $set: { status: "won" } });
  const won = await M.Deal.findById(open._id);
  assert.ok(won.closedAt);
  await new Promise((r) => setTimeout(r, 20));
  await M.Deal.updateOne({ _id: open._id }, { $set: { status: "won" } });
  assert.equal((await M.Deal.findById(open._id)).closedAt.getTime(), won.closedAt.getTime(), "repeating won keeps the date");
  won.status = "open"; await won.save();
  assert.equal((await M.Deal.findById(open._id)).closedAt, null);
  await M.Deal.updateOne({ _id: open._id }, { $set: { status: "lost", lostReason: "x" } });
  assert.ok((await M.Deal.findById(open._id)).closedAt);
});

test("#3 tags: list with counts, catalogue, multi-tag filter, validation", { skip }, async () => {
  await api("/contacts", { method: "POST", body: { firstName: "Vic", email: "vic@example.com", tags: ["vip", "website_enquiry"] } });
  const tags = await api("/contacts/tags");
  assert.equal(tags.status, 200);
  assert.deepEqual(tags.json.data.tags.find((t) => t.key === "vip"), { key: "vip", count: 2 });
  const cat = await api("/contacts/tag-catalogue");
  assert.ok(cat.json.data.tags.some((t) => t.key === "room_booking" && t.automatic));
  const both = await api("/contacts?tag=vip,active_member");
  assert.equal(both.status, 200, JSON.stringify(both.json));
  assert.deepEqual(both.json.data.map((c) => c.firstName), ["Daisy"]);
  const tooMany = await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { tags: Array.from({ length: 31 }, (_, i) => `t${i}`) } });
  assert.equal(tooMany.status, 400);
  const custom = await api(`/contacts/${ids.contact}`, { method: "PATCH", body: { tags: ["vip", "Coffee Lover"] } });
  assert.equal(custom.status, 200, JSON.stringify(custom.json));
});

test("#4 reports: monthly figures in HK months, zero-filled, yearly sums", { skip }, async () => {
  const month = hkMonth();
  await M.Invoice.create({ workspaceId: ids.wsId, contactId: ids.contact, total: 1000, status: "paid", paidAt: new Date(), createdBy: ids.admin }).catch(async (e) => {
    // Invoice may need more fields in this schema; fall back to a raw insert.
    await M.Invoice.collection.insertOne({ workspaceId: ids.wsId, contactId: ids.contact, total: 1000, status: "paid", paidAt: new Date(), createdAt: new Date() });
    return e;
  });
  const r = await api(`/reports/periodic?period=month&from=2025-12&to=${month}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const periods = r.json.data.periods;
  assert.equal(periods[0].key, "2025-12");
  assert.equal(periods[0].newContacts, 0);
  const now = periods.at(-1);
  assert.equal(now.key, month);
  assert.equal(now.revenue, 1000);
  assert.equal(now.dayPasses, 1);
  assert.ok(now.newContacts >= 2);
  assert.ok(now.dealsWon >= 1 && now.dealsLost >= 1);
  const y = await api(`/reports/periodic?period=year&from=2025-12&to=${month}`);
  assert.equal(y.json.data.periods.at(-1).revenue, 1000);
  assert.equal((await api("/reports/periodic?from=2026-13&to=2026-12")).status, 400);
  assert.equal((await api(`/reports/periodic?period=month&from=2025-12&to=${month}`, { as: "operator" })).status, 200);
});

const enquiryForm = (overrides = {}) => ({
  name: "Website enquiry (copy)", slug: "website-enquiry", type: "enquiry",
  fields: [
    { key: "interests", label: "Interested in", type: "checkboxes", mapTo: "interests", required: true, options: ["Flexible Day Pass", "Meeting Rooms"] },
    { key: "first_name", label: "First name", type: "text", mapTo: "firstName", required: true },
    { key: "last_name", label: "Last name", type: "text", mapTo: "lastName", required: true },
    { key: "email", label: "Email", type: "email", mapTo: "email", required: true },
    { key: "phone", label: "Phone", type: "tel", mapTo: "phone" },
    { key: "notes", label: "Additional notes", type: "textarea", mapTo: "notes" },
  ],
  consentText: "I agree to be contacted.",
  tagsToApply: ["Website Enquiry"],
  allowedOrigins: ["https://banyanworkspace.com/contact-us/"],
  ...overrides,
});

test("#5 forms: admin-only CRUD with validation and a generated public key", { skip }, async () => {
  assert.equal((await api("/forms", { method: "POST", body: enquiryForm(), as: "operator" })).status, 403);
  const noEmail = await api("/forms", { method: "POST", body: enquiryForm({ slug: "x", fields: [{ key: "n", label: "Name", type: "text", mapTo: "firstName" }] }) });
  assert.equal(noEmail.status, 400);
  const noOptions = await api("/forms", { method: "POST", body: enquiryForm({ slug: "y", fields: [{ key: "e", label: "E", type: "email", mapTo: "email" }, { key: "s", label: "S", type: "select" }] }) });
  assert.equal(noOptions.status, 400);
  const created = await api("/forms", { method: "POST", body: { ...enquiryForm(), publicKey: "client-chosen" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  ids.form = created.json.data;
  assert.ok(ids.form.publicKey.length >= 24 && ids.form.publicKey !== "client-chosen");
  assert.deepEqual(ids.form.tagsToApply, ["website_enquiry"]);
  assert.deepEqual(ids.form.allowedOrigins, ["https://banyanworkspace.com"]);
  assert.equal((await api("/forms", { method: "POST", body: enquiryForm() })).status, 409, "slug must be unique");
  const patched = await api(`/forms/${ids.form._id}`, { method: "PATCH", body: { name: "Website enquiry", publicKey: "nope" } });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.data.publicKey, ids.form.publicKey);
  const got = await api(`/forms/${ids.form._id}`);
  assert.equal(got.json.data.publicKey, ids.form.publicKey);
});

test("#5 public form: origin check, enquiry routing, consent, tags, honeypot, HTML redirect", { skip }, async () => {
  const url = `/public/forms/website-enquiry`;
  const body = { publicKey: ids.form.publicKey, interests: ["Flexible Day Pass"], first_name: "Wendy", last_name: "Web", email: "wendy@example.com", phone: "+852 9111 2222", notes: "Two people", consent: "yes" };
  const wrong = await api(url, { method: "POST", as: null, body, headers: { Origin: "https://evil.example" } });
  assert.equal(wrong.status, 403);
  assert.equal((await api(url, { method: "POST", as: null, body: { ...body, publicKey: "bad" }, headers: { Origin: "https://banyanworkspace.com" } })).status, 404);

  const ok = await api(url, { method: "POST", as: null, body, headers: { Origin: "https://banyanworkspace.com" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://banyanworkspace.com");
  const contact = await M.Contact.findOne({ email: "wendy@example.com" });
  assert.ok(contact.tags.includes("website_enquiry") && contact.tags.includes("form_submission"));
  assert.ok(contact.marketingConsentAt);
  assert.equal(contact.consentSource, "website-enquiry");
  const deal = await M.Deal.findOne({ contactId: contact._id });
  assert.equal(String(deal.pipelineId), String(ids.pipeline), "routed like the website enquiry form");
  assert.equal(deal.productType, "day_pass");
  assert.ok(await M.Task.exists({ contactId: contact._id }));
  const sub = await M.FormSubmission.findOne({ contactId: contact._id });
  assert.equal(sub.status, "processed");

  // Plain HTML post (urlencoded, interests[]) → 303 back to the page with ?submitted=1
  const form = new URLSearchParams({ publicKey: ids.form.publicKey, first_name: "Hana", last_name: "Html", email: "hana@example.com" });
  form.append("interests[]", "Flexible Day Pass");
  const html = await api(url, { method: "POST", as: null, raw: form.toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://banyanworkspace.com", Referer: "https://banyanworkspace.com/contact-us/?a=1" } });
  assert.equal(html.status, 303);
  assert.equal(html.headers.get("location"), "https://banyanworkspace.com/contact-us/?a=1&submitted=1");
  assert.ok(await M.Contact.exists({ email: "hana@example.com" }));

  const before = await M.Contact.countDocuments();
  const spam = await api(url, { method: "POST", as: null, body: { ...body, email: "bot@example.com", website: "http://spam" }, headers: { Origin: "https://banyanworkspace.com" } });
  assert.equal(spam.status, 201);
  assert.equal(await M.Contact.countDocuments(), before);
  assert.ok(await M.FormSubmission.exists({ status: "spam" }));

  const del = await api(`/forms/${ids.form._id}`, { method: "DELETE" });
  assert.equal(del.json.data.deactivated, true, "forms with submissions are soft-deleted");
});

test("#5 public form with its own pipeline: deal, task and staff notification email", { skip }, async () => {
  const f = await api("/forms", { method: "POST", body: {
    name: "Walk-in", slug: "walk-in", type: "walk_in", pipelineId: String(ids.pipeline), stageId: String(ids.stage), createTask: true, notifyEmails: ["team@banyan.test"],
    fields: [{ key: "name", label: "Name", type: "text", mapTo: "firstName", required: true }, { key: "email", label: "Email", type: "email", mapTo: "email", required: true }],
  } });
  assert.equal(f.status, 201, JSON.stringify(f.json));
  google.sentMail.length = 0;
  const r = await api("/public/forms/walk-in", { method: "POST", as: null, body: { publicKey: f.json.data.publicKey, name: "Walt", email: "walt@example.com" }, headers: { Origin: "https://banyan-crm-admin.vercel.app" } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const c = await M.Contact.findOne({ email: "walt@example.com" });
  const deal = await M.Deal.findOne({ contactId: c._id });
  assert.equal(deal.title, "Walk-in — Walt");
  assert.ok(await M.Task.exists({ contactId: c._id, "metadata.origin": "form_submission" }));
  assert.equal(google.sentMail.length, 1);
  assert.match(google.sentMail[0], /To: team@banyan.test/);
});

test("#6 templates: Gmail send fills variables and sends HTML as multipart", { skip }, async () => {
  const t = await M.Template.create({ workspaceId: ids.wsId, name: "Welcome", subject: "Welcome {{firstName}}", body: "<html><body><p>Hi {{fullName}} from {{staffName}}</p></body></html>", createdBy: ids.admin });
  google.sentMail.length = 0;
  const r = await api("/integrations/google/gmail/send", { method: "POST", body: { to: "daisy@example.com", templateId: String(t._id), contactId: ids.contact } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const mime = google.sentMail[0];
  assert.match(mime, /Subject: Welcome Daisy/);
  assert.match(mime, /multipart\/alternative/);
  const parts = [...mime.matchAll(/\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--banyan_/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"));
  assert.ok(parts.some((p) => p === "Hi Daisy Pass from Felicia"), JSON.stringify(parts));
  assert.ok(parts.some((p) => p.includes("<p>Hi Daisy Pass from Felicia</p>")));
});

test("#7 room calendars: settings, push without guests or emails, idempotent, cancel removes only ours", { skip }, async () => {
  const { upsertWpBooking } = await import("../src/services/wpRoomBooking.service.js");
  const { syncBookingToRoomCalendar, ownedEventWrite } = await import("../src/services/roomCalendar.service.js");
  const LIB = DEFAULT_LIBRARY_CALENDAR;
  // Partner's own event and a test event already in the calendar.
  cal(LIB).set("partnerevent1", { id: "partnerevent1", summary: "Partner meeting", status: "confirmed", start: { dateTime: "2026-12-01T10:00:00+08:00" }, end: { dateTime: "2026-12-01T11:00:00+08:00" } });
  cal(LIB).set("testevent1", { id: "testevent1", summary: "TEST", status: "confirmed" });

  const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const wp = (ref, status, paidAt) => ({
    event: "booking.snapshot",
    booking: { ref, status, channel: "web", room_key: "library", room_name: "The Library (15 people (depending on layout))", date: day, start_time: "10:00", end_time: "12:00", hours: 2, start_iso: `${day}T10:00:00+08:00`, end_iso: `${day}T12:00:00+08:00`, created_at: new Date().toISOString() },
    customer: { first_name: "Jane", last_name: "Chan", email: "jane@example.com", phone: "+852 5555 0000", notes: "U-shape" },
    payment: { mode: "test", amount: 1776, amount_minor: 177600, currency: "HKD", status: status === "paid" ? "paid" : "pending", paid_at: paidAt },
  });

  // Booked before the setting is saved → never pushed (no backfill).
  const old = await upsertWpBooking(wp("BNY-OLD001", "paid", new Date().toISOString()));
  assert.deepEqual(await syncBookingToRoomCalendar(old.booking._id), { skipped: "settings_not_saved" });

  // Settings: operator can't; unshared calendar → 400; shared → saved.
  assert.equal((await api("/room-bookings/google-calendars", { method: "PUT", as: "operator", body: { calendars: { library: LIB } } })).status, 403);
  const unshared = await api("/room-bookings/google-calendars", { method: "PUT", body: { calendars: { library: LIB } } });
  assert.equal(unshared.status, 400);
  assert.equal(unshared.json.code, "ROOM_CALENDAR_NOT_ACCESSIBLE");
  assert.equal((await api("/room-bookings/google-calendars", { method: "PUT", body: { calendars: { small: "not a calendar" } } })).status, 400);
  google.writable.add(LIB);
  await new Promise((r) => setTimeout(r, 5));
  const saved = await api("/room-bookings/google-calendars", { method: "PUT", body: { calendars: { library: LIB, small: null, medium: null } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.data.connected, true);
  assert.equal((await api("/room-bookings/config")).json.data.googleCalendars.library, LIB);

  const preview = await api("/room-bookings/google-calendars/backfill-preview");
  assert.equal(preview.json.data.dryRun, true);
  assert.ok(preview.json.data.items.some((i) => i.ref === "BNY-OLD001"));
  assert.ok(!cal(LIB).has(eventIdFor("BNY-OLD001")), "preview writes nothing");

  // Paid after saving → pushed.
  google.requests.length = 0;
  const paid = await upsertWpBooking(wp("BNY-NEW001", "paid", new Date(Date.now() + 1000).toISOString()));
  const state = await syncBookingToRoomCalendar(paid.booking._id);
  assert.equal(state.error, null, state.error);
  const ev = cal(LIB).get(eventIdFor("BNY-NEW001"));
  assert.ok(ev, "event created with the deterministic id");
  assert.equal(ev.summary, "The Library (15 people (depending on layout)) – Jane Chan (BNY-NEW001)");
  assert.equal(ev.attendees, undefined, "no guests");
  assert.equal(ev.start.timeZone, "Asia/Hong_Kong");
  assert.deepEqual(ev.extendedProperties.private, { banyanRef: "BNY-NEW001", banyanSource: "crm-room-booking" });
  const writes = google.requests.filter((r) => r.method !== "GET");
  assert.ok(writes.length && writes.every((r) => new URL(r.url).searchParams.get("sendUpdates") === "none"), "nobody is emailed");

  // Resend → still one event.
  await upsertWpBooking(wp("BNY-NEW001", "paid", new Date().toISOString()), { origin: "webhook" });
  await syncBookingToRoomCalendar(paid.booking._id);
  assert.equal([...cal(LIB).keys()].filter((k) => k === eventIdFor("BNY-NEW001")).length, 1);
  assert.equal(cal(LIB).size, 3);

  // Never touch an event we didn't create.
  await assert.rejects(() => ownedEventWrite(ids.wsId, LIB, "partnerevent1", "BNY-NEW001", "delete"), /not created by Banyan CRM/);
  await assert.rejects(() => ownedEventWrite(ids.wsId, LIB, "partnerevent1", "BNY-NEW001", "patch", { summary: "x" }), /not created by Banyan CRM/);
  assert.equal(cal(LIB).get("partnerevent1").summary, "Partner meeting");

  // Cancelled in WP → only our event is removed.
  await upsertWpBooking({ ...wp("BNY-NEW001", "cancelled", new Date().toISOString()), event: "booking.cancelled" }, { origin: "webhook" });
  await syncBookingToRoomCalendar(paid.booking._id);
  assert.ok(!cal(LIB).has(eventIdFor("BNY-NEW001")));
  assert.ok(cal(LIB).has("partnerevent1") && cal(LIB).has("testevent1"));
  const row = await api("/room-bookings/BNY-NEW001");
  assert.equal(row.json.data.googleCalendar.action, "removed");
});

test("#7 shared room calendar events are read-only in the CRM", { skip }, async () => {
  const ev = await M.CalendarEvent.create({
    workspaceId: ids.wsId, title: "Partner meeting", type: "meeting", startAt: new Date(), endAt: new Date(Date.now() + 3600000),
    externalProvider: "google_calendar", externalEventId: "partnerevent1", metadata: { googleCalendarId: DEFAULT_LIBRARY_CALENDAR, readOnly: true },
    createdBy: ids.admin,
  }).catch(async () => M.CalendarEvent.collection.insertOne({ workspaceId: ids.wsId, title: "Partner meeting", startAt: new Date(), endAt: new Date(), metadata: { googleCalendarId: DEFAULT_LIBRARY_CALENDAR } }).then((r) => ({ _id: r.insertedId })));
  for (const path of [`/calendar-events/${ev._id}`, `/calendar/${ev._id}`]) {
    const patch = await api(path, { method: "PATCH", body: { title: "x" } });
    assert.equal(patch.status, 409, `${path} ${JSON.stringify(patch.json)}`);
    assert.equal(patch.json.message, "This event is in a shared room calendar and is read-only in the CRM");
    assert.equal((await api(path, { method: "DELETE" })).status, 409);
  }
  assert.equal((await api(`/integrations/google/calendar/events/${ev._id}/sync`, { method: "POST" })).status, 409);
  assert.equal(cal(DEFAULT_LIBRARY_CALENDAR).get("partnerevent1").summary, "Partner meeting");
});

test("#7 partner blocks: dry-run lists blocks and clashes; applying needs the setting and the WP endpoint", { skip }, async () => {
  const { upsertWpBooking } = await import("../src/services/wpRoomBooking.service.js");
  const LIB = DEFAULT_LIBRARY_CALENDAR;
  // A weekday ~10 days ahead, 14:00–15:30 partner meeting; a paid website booking 15:00–16:00.
  let d = new Date(Date.now() + 10 * 86400000);
  while ([0, 6].includes(new Date(d.getTime() + 8 * 3600000).getUTCDay())) d = new Date(d.getTime() + 86400000);
  const day = new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  cal(LIB).clear();
  cal(LIB).set("partner2", { id: "partner2", summary: "Board meeting", status: "confirmed", start: { dateTime: `${day}T14:00:00+08:00` }, end: { dateTime: `${day}T15:30:00+08:00` } });
  cal(LIB).set("free1", { id: "free1", summary: "Optional", status: "confirmed", transparency: "transparent", start: { dateTime: `${day}T09:00:00+08:00` }, end: { dateTime: `${day}T10:00:00+08:00` } });
  await upsertWpBooking({
    booking: { ref: "BNY-CLASH1", status: "paid", room_key: "library", room_name: "The Library", date: day, start_time: "15:00", end_time: "16:00", hours: 1, start_iso: `${day}T15:00:00+08:00`, end_iso: `${day}T16:00:00+08:00` },
    customer: { first_name: "Cara", email: "cara@example.com" }, payment: { mode: "live", status: "paid" },
  });
  const preview = await api("/room-bookings/partner-blocks/preview");
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.deepEqual(preview.json.data.create.map((c) => [c.room, c.date, c.start, c.hours]), [["library", day, 14, 2]]);
  assert.deepEqual(preview.json.data.clashes.map((c) => c.ref), ["BNY-CLASH1"]);
  const off = await api("/room-bookings/partner-blocks/sync", { method: "POST" });
  assert.equal(off.status, 409);
  assert.equal(off.json.code, "PARTNER_BLOCKS_DISABLED");
  assert.ok(cal(LIB).has("partner2"), "partner events are only read");
});

/* ---------- plugin 1.1.1 follow-up ---------- */
test("room calendar: blocks made from a partner's own event are never copied back", () => {
  const settings = { saved: true, includePending: false, calendars: { library: DEFAULT_LIBRARY_CALENDAR }, pushFrom: { library: "2026-01-01T00:00:00Z" } };
  const b = (externalId) => ({ endAt: new Date(Date.now() + 86400000), createdAt: new Date(), metadata: { wp: { status: "blocked", roomKey: "library", externalId, createdAt: new Date().toISOString() } } });
  assert.equal(desiredCalendarState(b("gcal:abc:2026-12-01"), settings).reason, "partner_block");
  assert.equal(desiredCalendarState(b(null), settings).present, true, "manual WP Admin blocks are still shown");
});

test("staff checkout via the CRM: token sent server-side, notes prefixed, pending row synced by ref", { skip }, async () => {
  const day = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const r = await api("/room-bookings/checkout", { method: "POST", body: { room: "library", date: day, start: 10, hours: 2, first_name: "Pat", last_name: "Phone", email: "pat@example.com", phone: "+852 5555 1111", notes: "U-shape" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.data.ref, /^BNY-CK/);
  assert.equal(r.json.data.session_id, `cs_test_${r.json.data.ref}`);
  const sent = wpFake.checkouts.at(-1);
  assert.equal(sent.notes, "Booked via CRM by Felicia – U-shape");
  assert.equal(sent.website, "");
  assert.equal(sent.return_url, "https://banyanworkspace.com/meeting-rooms-hong-kong/");
  assert.equal(wpFake.requests.find((q) => q.path.endsWith("/checkout")).token, "fb-wp-token");
  assert.equal((await api("/room-bookings/checkout", { method: "POST", as: "operator", body: {} })).status !== 403, true, "sales staff may book");

  const synced = await api("/room-bookings/sync", { method: "POST", body: { ref: r.json.data.ref } });
  assert.equal(synced.status, 200, JSON.stringify(synced.json));
  assert.equal(synced.json.data.mode, "ref");
  const row = await api(`/room-bookings/${r.json.data.ref}`);
  assert.equal(row.json.data.status, "pending");
  assert.equal(row.json.data.viaCrm, true);
  assert.equal((await api("/room-bookings/sync", { method: "POST", body: { ref: "BNY-NOPE00" } })).status, 404);
  assert.equal((await api("/room-bookings/sync", { method: "POST", body: { ref: "bad ref" } })).status, 400);
});

test("partner blocks applied: create, no loop back to Google, move, removed-by-hand, clash", { skip }, async () => {
  const { upsertWpBooking } = await import("../src/services/wpRoomBooking.service.js");
  const { syncBookingToRoomCalendar } = await import("../src/services/roomCalendar.service.js");
  const LIB = DEFAULT_LIBRARY_CALENDAR;
  const on = await api("/room-bookings/google-calendars", { method: "PUT", body: { partnerBlocks: { enabled: true } } });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal(on.json.data.partnerBlocks.enabled, true);

  const event = cal(LIB).get("partner2");
  const day = event.start.dateTime.slice(0, 10);
  wpFake.blocks.clear();
  const first = await api("/room-bookings/partner-blocks/sync", { method: "POST" });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(wpFake.blocks.size, 1);
  const [[blockRef, block]] = [...wpFake.blocks];
  assert.deepEqual([block.room, block.date, block.start, block.hours, block.external_id], ["library", day, 14, 2, `gcal:partner2:${day}`]);

  // The block comes back into the CRM (manual sync / webhook) — it must not be pushed to Google.
  const before = cal(LIB).size;
  const cached = await upsertWpBooking({
    booking: { ref: blockRef, status: "blocked", channel: "admin", room_key: "library", room_name: "The Library", date: day, start_time: "14:00", end_time: "16:00", hours: 2, start_iso: `${day}T14:00:00+08:00`, end_iso: `${day}T16:00:00+08:00`, created_at: new Date().toISOString(), external_id: block.external_id },
    customer: { first_name: "Blocked", notes: block.reason },
  });
  assert.deepEqual(await syncBookingToRoomCalendar(cached.booking._id), { skipped: "partner_block" });
  assert.equal(cal(LIB).size, before);

  // Unchanged → nothing sent again.
  const posts = wpFake.requests.filter((q) => q.method === "POST" && q.path.endsWith("/blocks")).length;
  await api("/room-bookings/partner-blocks/sync", { method: "POST" });
  assert.equal(wpFake.requests.filter((q) => q.method === "POST" && q.path.endsWith("/blocks")).length, posts);

  // Partner moves the meeting → old block deleted, new one created.
  cal(LIB).set("partner2", { ...event, start: { dateTime: `${day}T16:00:00+08:00` }, end: { dateTime: `${day}T17:00:00+08:00` } });
  await api("/room-bookings/partner-blocks/sync", { method: "POST" });
  assert.ok(!wpFake.blocks.has(blockRef));
  assert.deepEqual([...wpFake.blocks.values()].map((b) => [b.start, b.hours]), [[16, 1]]);

  // Staff removed the block by hand in WP, then the partner deletes the meeting: plain 404 is fine.
  wpFake.blocks.clear();
  cal(LIB).delete("partner2");
  const gone = await api("/room-bookings/partner-blocks/sync", { method: "POST" });
  assert.equal(gone.status, 200, JSON.stringify(gone.json));
  assert.equal((await api("/room-bookings/partner-blocks")).json.data.blocks, 0);

  // WordPress refuses a block that overlaps a paid booking → listed for staff, no error.
  cal(LIB).set("partner3", { id: "partner3", summary: "Offsite", status: "confirmed", start: { dateTime: `${day}T09:00:00+08:00` }, end: { dateTime: `${day}T10:00:00+08:00` } });
  wpFake.clashRoomDates.add(`library|${day}`);
  const clash = await api("/room-bookings/partner-blocks/sync", { method: "POST" });
  assert.equal(clash.status, 200, JSON.stringify(clash.json));
  assert.deepEqual(clash.json.data.blockConflicts.map((c) => c.conflicts), [["BNY-PAID01"]]);
  assert.deepEqual((await api("/room-bookings/partner-blocks")).json.data.blockConflicts.map((c) => c.date), [day]);
  assert.equal((await api("/room-bookings/partner-blocks")).json.data.supported, true);
});
