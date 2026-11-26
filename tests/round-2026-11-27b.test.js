/*
 * Round 27 Nov (b): Eventbrite sync and webhook, WhatsApp status / templates / contact link,
 * follow-up task per pipeline stage.
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/banyan_r27b_test node --test tests/round-2026-11-27b.test.js
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_ACCESS_SECRET ||= "r27b-access";
process.env.JWT_REFRESH_SECRET ||= "r27b-refresh";
process.env.MONGODB_URI ||= process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:1/unused";
process.env.BANYAN_BOOKING_SYNC_MINUTES = "0";
process.env.PUBLIC_ENQUIRY_WORKSPACE_ID = "";
process.env.PUBLIC_ENQUIRY_WORKSPACE_SLUG = "r27b-test";
process.env.PUBLIC_API_URL = "https://api.example.test";
process.env.EVENTBRITE_PRIVATE_TOKEN = "eb-test-token";
process.env.EVENTBRITE_ORGANIZATION_ID = "";
process.env.EVENTBRITE_WEBHOOK_SECRET = "s3cret-webhook-path";
process.env.EVENTBRITE_RETRY_BASE_MS = "5";
process.env.WHATSAPP_ACCESS_TOKEN = "wa-test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "111";
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "222";
process.env.WHATSAPP_VERIFY_TOKEN = "wa-verify";

const { effectiveFollowUp, parseFollowUp, followUpDueAt } = await import("../src/utils/stageFollowUp.js");
const { attendeeStatus, mapEvent } = await import("../src/services/eventbriteSync.service.js");
const { paramCount, fillTemplate, phoneVariants, parseSendBody } = await import("../src/services/whatsapp.service.js");

test("C follow-up settings, due dates; A mapping; B helpers", () => {
  assert.deepEqual(effectiveFollowUp({ name: "Quote Sent" }), { enabled: true, dueInDays: 3, title: "Quote follow-up: {deal}" });
  assert.deepEqual(effectiveFollowUp({ name: "Enquiry" }), { enabled: false, dueInDays: 1, title: "" });
  assert.deepEqual(effectiveFollowUp({ name: "Quote sent", followUp: { enabled: false, dueInDays: 3, title: "" } }).enabled, false, "stored wins");
  assert.throws(() => parseFollowUp({ dueInDays: 61 }), (e) => e.code === "INVALID_FOLLOW_UP");
  assert.throws(() => parseFollowUp({ dueInDays: 1.5 }), (e) => e.code === "INVALID_FOLLOW_UP");
  assert.throws(() => parseFollowUp("yes"), (e) => e.code === "INVALID_FOLLOW_UP");
  assert.deepEqual(parseFollowUp({ enabled: true }, { enabled: false, dueInDays: 2, title: "x" }), { enabled: true, dueInDays: 2, title: "x" });
  // 3 days later at 10:00 HK.
  assert.equal(followUpDueAt(3, new Date("2026-11-27T15:30:00Z")).toISOString(), "2026-11-30T02:00:00.000Z", "23:30 HK on the 27th -> 30th 10:00 HK");
  // 0 days: next full hour, or 18:00 HK if that's later.
  assert.equal(followUpDueAt(0, new Date("2026-11-27T02:10:00Z")).toISOString(), "2026-11-27T10:00:00.000Z");
  assert.equal(followUpDueAt(0, new Date("2026-11-27T11:10:00Z")).toISOString(), "2026-11-27T12:00:00.000Z");

  assert.equal(attendeeStatus({ refunded: true, cancelled: true }), "refunded");
  assert.equal(attendeeStatus({ cancelled: true }), "cancelled");
  assert.equal(attendeeStatus({ checked_in: true }), "checked_in");
  assert.equal(attendeeStatus({ status: "Not Attending" }), "not_attending");
  assert.equal(attendeeStatus({ status: "Attending" }), "attending");
  const m = mapEvent({ name: { text: "Founders night" }, description: { text: "<p>Drinks</p>" }, start: { utc: "2026-12-05T10:00:00Z", timezone: "Asia/Hong_Kong" }, end: { utc: "2026-12-05T13:00:00Z" }, venue: { name: "Banyan", address: { localized_address_display: "1 Queen's Rd, Central" } }, capacity: 40 });
  assert.deepEqual([m.name, m.description, m.venue, m.capacity, m.startAt.toISOString()], ["Founders night", "Drinks", "Banyan, 1 Queen's Rd, Central", 40, "2026-12-05T10:00:00.000Z"]);

  assert.equal(paramCount("Hi {{1}}, see you on {{2}}"), 2);
  assert.equal(fillTemplate("Hi {{1}}, see you on {{2}}", ["Jane", "3 Dec"]), "Hi Jane, see you on 3 Dec");
  assert.deepEqual(phoneVariants("85291234567").sort(), ["85291234567", "91234567"]);
  assert.throws(() => parseSendBody({ to: "85291234567", template: { name: "Bad Name" } }), (e) => e.code === "INVALID_WHATSAPP_TEMPLATE");
  assert.throws(() => parseSendBody({ to: "85291234567", template: { name: "ok", params: Array(11).fill("x") } }), (e) => e.code === "INVALID_WHATSAPP_TEMPLATE");
  assert.throws(() => parseSendBody({ to: "85291234567", template: { name: "ok", params: [""] } }), (e) => e.code === "INVALID_WHATSAPP_TEMPLATE");
});

/* ---------- fakes ---------- */
const realFetch = globalThis.fetch;
const json = (status, data, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const eb = { events: [], attendees: new Map(), orders: new Map(), webhooks: [], requests: [], fail429: 0, writes: 0 };
const meta = { sent: [], nextError: null };
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  const method = (init.method || "GET").toUpperCase();
  if (url.hostname === "www.eventbriteapi.com") {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer eb-test-token");
    eb.requests.push({ method, path: url.pathname, search: url.search });
    if (eb.fail429 > 0) { eb.fail429--; return json(429, { error: "HIT_RATE_LIMIT" }); }
    const p = url.pathname.replace("/v3", "");
    if (p === "/users/me/organizations/") return json(200, { organizations: [{ id: "org1", name: "Banyan Workspace" }] });
    if (p === "/organizations/org1/events/") return json(200, { events: eb.events, pagination: { has_more_items: false } });
    if (p === "/organizations/org1/webhooks/" && method === "GET") return json(200, { webhooks: eb.webhooks, pagination: { has_more_items: false } });
    if (p === "/organizations/org1/webhooks/" && method === "POST") {
      eb.writes++;
      const body = JSON.parse(init.body);
      const hook = { id: `wh${eb.webhooks.length + 1}`, endpoint_url: body.endpoint_url, actions: body.actions };
      eb.webhooks.push(hook);
      return json(200, hook);
    }
    const att = p.match(/^\/events\/([^/]+)\/attendees\/$/);
    if (att) return json(200, { attendees: eb.attendees.get(att[1]) || [], pagination: { has_more_items: false } });
    const ev = p.match(/^\/events\/([^/]+)\/$/);
    if (ev) return json(200, eb.events.find((e) => e.id === ev[1]) || {});
    const order = p.match(/^\/orders\/([^/]+)\/$/);
    if (order) return json(200, eb.orders.get(order[1]) || {});
    const one = p.match(/^\/events\/([^/]+)\/attendees\/([^/]+)\/$/);
    if (one) return json(200, (eb.attendees.get(one[1]) || []).find((a) => a.id === one[2]) || {});
    return json(404, { error: "NOT_FOUND" });
  }
  if (url.hostname === "graph.facebook.com") {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer wa-test-token");
    const p = url.pathname.replace(/^\/v[\d.]+/, "");
    if (p === "/111" && method === "GET") return json(200, { display_phone_number: "+852 3000 0000", verified_name: "Banyan Workspace", quality_rating: "GREEN" });
    if (p === "/222/message_templates") return json(200, { data: [{ name: "booking_reminder", language: "en", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Hi {{1}}, your booking is on {{2}}." }] }] });
    if (p === "/111/messages" && method === "POST") {
      if (meta.nextError) { const e = meta.nextError; meta.nextError = null; return json(400, { error: e }); }
      meta.sent.push(JSON.parse(init.body));
      return json(200, { messages: [{ id: `wamid.${meta.sent.length}` }] });
    }
    return json(404, { error: { message: "Unknown path" } });
  }
  return realFetch(input, init);
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
  for (const n of ["User", "Workspace", "Contact", "Company", "Deal", "Pipeline", "PipelineStage", "Task", "Activity", "Notification", "Event", "EventRegistration", "Integration", "WebhookEvent", "Conversation", "Message"])
    M[n] = (await import(`../src/models/${n}.js`))[n];
  for (const n of ["Event", "EventRegistration", "Integration", "WebhookEvent"]) await M[n].createIndexes();
  const wsId = new mongoose.Types.ObjectId();
  const admin = await M.User.create({ workspaceId: wsId, name: "Felicia", email: "felicia@r27b.test", passwordHash: "x", role: "admin" });
  const op = await M.User.create({ workspaceId: wsId, name: "Op", email: "op@r27b.test", passwordHash: "x", role: "operator" });
  const viewer = await M.User.create({ workspaceId: wsId, name: "Vee", email: "vee@r27b.test", passwordHash: "x", role: "read_only" });
  await M.Workspace.create({ _id: wsId, name: "Banyan", slug: "r27b-test", createdBy: admin._id });
  const acme = await M.Company.create({ workspaceId: wsId, name: "Acme Ltd", ownerId: admin._id });
  const known = await M.Contact.create({ workspaceId: wsId, firstName: "Known", lastName: "Person", email: "known@x.test", ownerId: admin._id, tags: ["vip"] });
  const hk = await M.Contact.create({ workspaceId: wsId, firstName: "Hana", email: "hana@x.test", phone: "9123 4567", ownerId: admin._id });
  Object.assign(ids, { wsId, admin: admin._id, acme: acme._id, known: known._id, hk: hk._id });
  for (const [k, u] of Object.entries({ admin, op, viewer })) tokens[k] = signAccessToken(u);
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
    headers: { ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
};

const attendee = (id, eventId, profile, extra = {}) => ({
  id, event_id: eventId, order_id: `o-${id}`, created: "2026-11-20T03:00:00Z", changed: "2026-11-20T03:00:00Z", status: "Attending",
  ticket_class_name: "General", costs: { gross: { major_value: "150.00", currency: "HKD" } }, profile,
  answers: [{ question: "How did you hear about us?", answer: "Instagram" }], ...extra,
});

test("A Eventbrite sync: events from 2026, contacts by email only, never overwrite, counts, activities, webhook registered", { skip }, async () => {
  eb.events = [
    { id: "ev-future", name: { text: "Founders night" }, status: "live", start: { utc: "2027-01-15T10:00:00Z" }, end: { utc: "2027-01-15T13:00:00Z" }, capacity: 40, url: "https://eventbrite.test/e/1", venue: { name: "Banyan" } },
    { id: "ev-past", name: { text: "Autumn mixer" }, status: "completed", start: { utc: "2026-10-01T10:00:00Z" }, end: { utc: "2026-10-01T12:00:00Z" } },
    { id: "ev-old", name: { text: "2025 party" }, status: "completed", start: { utc: "2025-12-01T10:00:00Z" }, end: { utc: "2025-12-01T12:00:00Z" } },
  ];
  eb.attendees.set("ev-future", [
    attendee("a1", "ev-future", { first_name: "New", last_name: "Guest", email: "New.Guest@X.test", cell_phone: "+852 6000 0000", job_title: "CEO", company: "acme ltd" }),
    attendee("a2", "ev-future", { first_name: "Someone", last_name: "Else", email: "known@x.test", cell_phone: "+852 6111 1111", job_title: "CTO" }),
    attendee("a3", "ev-future", { first_name: "Hidden", last_name: "" }),
    attendee("a4", "ev-future", { first_name: "Cancel", email: "cancel@x.test" }, { cancelled: true }),
  ]);
  eb.attendees.set("ev-past", [attendee("p1", "ev-past", { first_name: "Past", email: "past@x.test" }, { checked_in: true, status: "Checked In" })]);
  eb.fail429 = 1;

  assert.equal((await api("/integrations/eventbrite/sync", { method: "POST", as: "op" })).status, 403);
  const r = await api("/integrations/eventbrite/sync", { method: "POST" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.connected, true);
  assert.equal(r.json.data.organizationName, "Banyan Workspace");
  assert.deepEqual(r.json.data.lastSync, { events: 2, registrations: 5, contactsCreated: 3, contactsUpdated: 1, errors: 0 });
  assert.equal(r.json.data.webhookActive, true, "webhook registered on the first sync");
  assert.equal(eb.webhooks[0].endpoint_url, "https://api.example.test/api/v1/webhooks/eventbrite/s3cret-webhook-path");
  assert.equal(eb.writes, 1, "the webhook is the only write");
  assert.ok(!JSON.stringify(r.json).includes("eb-test-token"));

  const newGuest = await M.Contact.findOne({ email: "new.guest@x.test" }).lean();
  assert.deepEqual([newGuest.firstName, newGuest.source, newGuest.tags, newGuest.jobTitle, String(newGuest.companyId), newGuest.marketingConsentAt], ["New", "Eventbrite", ["eventbrite"], "CEO", String(ids.acme), null]);
  const known = await M.Contact.findById(ids.known).lean();
  assert.deepEqual([known.firstName, known.phone, known.jobTitle, known.tags], ["Known", "+852 6111 1111", "CTO", ["vip", "eventbrite"]], "only empty fields filled");
  assert.equal(await M.Contact.countDocuments({ firstName: "Hidden" }), 0, "no email -> no contact");

  const evt = await M.Event.findOne({ externalId: "ev-future" }).lean();
  assert.deepEqual([evt.registrationCount, evt.checkedInCount, evt.capacity, evt.venue], [3, 0, 40, "Banyan"]);
  assert.equal(await M.Event.countDocuments({ externalId: "ev-old" }), 0, "events before 2026 are left out");
  const regs = await M.EventRegistration.find({ eventId: evt._id }).lean();
  const byId = Object.fromEntries(regs.map((x) => [x.externalId, x]));
  assert.deepEqual([byId.a1.contactCreated, byId.a2.contactCreated, byId.a3.contactId, byId.a4.status, byId.a1.amount, byId.a1.answers[0].answer], [true, false, null, "cancelled", 150, "Instagram"]);
  assert.equal(String(byId.a1.companyId), String(ids.acme));
  const act = await M.Activity.findOne({ contactId: newGuest._id, type: "event" }).lean();
  assert.equal(act.subject, "Signed up for Founders night (General)");
  assert.equal(act.metadata.registrationId, String(byId.a1._id));
  const past = await M.EventRegistration.findOne({ externalId: "p1" }).lean();
  assert.equal(past.status, "checked_in");

  // Second run: changed_since, no duplicate activities when nothing changed.
  const acts = await M.Activity.countDocuments({ type: "event" });
  eb.requests.length = 0;
  await api("/integrations/eventbrite/sync", { method: "POST" });
  assert.ok(eb.requests.some((q) => q.path.endsWith("/attendees/") && q.search.includes("changed_since=")));
  assert.equal(await M.Activity.countDocuments({ type: "event" }), acts);
  assert.equal(await M.EventRegistration.countDocuments(), 5);

  // Lists.
  const up = await api("/events?when=upcoming", { as: "viewer" });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.deepEqual(up.json.data.items.map((e) => e.name), ["Founders night"]);
  assert.deepEqual((await api("/events?when=past")).json.data.items.map((e) => e.name), ["Autumn mixer"]);
  assert.equal((await api("/events?search=mixer")).json.data.pagination.total, 1);
  assert.equal((await api(`/events/${evt._id}`)).json.data.name, "Founders night");
  const list = await api(`/event-registrations?contactId=${newGuest._id}`);
  assert.equal(list.json.data.items[0].eventId.name, "Founders night");
  assert.equal(list.json.data.items[0].contactId.email, "new.guest@x.test");
  assert.equal((await api(`/event-registrations?companyId=${ids.acme}`)).json.data.items.length, 1);
  assert.equal((await api("/event-registrations?status=cancelled")).json.data.items.length, 1);
  assert.equal((await api("/event-registrations?status=bogus")).status, 400);
  assert.equal((await api("/event-registrations?limit=500")).json.data.pagination.limit, 200);
});

test("A Eventbrite webhook: secret checked, only eventbriteapi.com fetched, order processed after the reply, idempotent", { skip }, async () => {
  const hook = (secret, body) =>
    realFetch(`${base}/webhooks/eventbrite/${secret}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => ({ status: r.status, json: await r.json() }));
  assert.equal((await hook("wrong", { api_url: "https://www.eventbriteapi.com/v3/orders/o9/" })).status, 404);
  const foreign = await hook("s3cret-webhook-path", { config: { action: "order.placed", webhook_id: "wh1" }, api_url: "https://evil.example/v3/orders/o9/" });
  assert.equal(foreign.status, 200);
  assert.equal(foreign.json.data.ignored, "ignored");

  eb.orders.set("o9", { id: "o9", attendees: [attendee("a9", "ev-future", { first_name: "Webby", last_name: "Hook", email: "webby@x.test" })] });
  const body = { config: { action: "order.placed", webhook_id: "wh1" }, api_url: "https://www.eventbriteapi.com/v3/orders/o9/" };
  const ok = await hook("s3cret-webhook-path", body);
  assert.equal(ok.status, 200);
  const reg = await waitFor(() => M.EventRegistration.findOne({ externalId: "a9" }).lean());
  assert.ok(reg, "processed after the reply");
  assert.ok(reg.contactCreated);
  assert.ok(eb.requests.some((q) => q.path === "/v3/orders/o9/" && q.search.includes("expand=attendees")));
  assert.equal((await hook("s3cret-webhook-path", body)).json.data.ignored, "duplicate");
  await waitFor(() => M.WebhookEvent.findOne({ provider: "eventbrite", status: "processed" }).lean());
  const evt = await M.Event.findOne({ externalId: "ev-future" }).lean();
  assert.equal(evt.registrationCount, 4);

  // Check-in through the webhook: status change -> one activity.
  eb.attendees.get("ev-future").push(attendee("a9", "ev-future", { first_name: "Webby", email: "webby@x.test" }, { checked_in: true }));
  await hook("s3cret-webhook-path", { config: { action: "attendee.checked_in", webhook_id: "wh1" }, api_url: "https://www.eventbriteapi.com/v3/events/ev-future/attendees/a9/" });
  const checked = await waitFor(async () => (await M.EventRegistration.findOne({ externalId: "a9", status: "checked_in" }).lean()));
  assert.ok(checked?.checkedInAt);
  const contact = await M.Contact.findOne({ email: "webby@x.test" }).lean();
  assert.ok(await waitFor(() => M.Activity.exists({ contactId: contact._id, subject: "Checked in at Founders night" })));

  const status = await api("/integrations/eventbrite");
  assert.equal(status.json.data.webhookActive, true);
  const again = await api("/integrations/eventbrite/webhook", { method: "POST" });
  assert.deepEqual(again.json.data, { webhookActive: true, webhookId: "wh1" }, "reused");
  assert.equal(eb.webhooks.length, 1);
});

test("B WhatsApp: status with templates, template send linked to the contact, 131047 / 131026 mapped", { skip }, async () => {
  assert.equal((await api("/integrations/whatsapp/status", { as: "op" })).status, 403);
  const st = await api("/integrations/whatsapp/status");
  assert.equal(st.status, 200, JSON.stringify(st.json));
  assert.deepEqual([st.json.data.configured, st.json.data.displayPhoneNumber, st.json.data.verifiedName, st.json.data.qualityRating], [true, "+852 3000 0000", "Banyan Workspace", "GREEN"]);
  assert.deepEqual(st.json.data.templates, [{ name: "booking_reminder", language: "en", category: "UTILITY", status: "APPROVED", body: "Hi {{1}}, your booking is on {{2}}.", paramCount: 2 }]);
  assert.equal(st.json.data.webhookVerified, false);
  assert.ok(!JSON.stringify(st.json).includes("wa-test-token"));

  // Template to a contact: Meta payload, stored text, thread, activity.
  const r = await api("/integrations/whatsapp/messages", {
    method: "POST", as: "op",
    body: { to: "+852 9123 4567", contactId: String(ids.hk), template: { name: "booking_reminder", language: "en", params: ["Hana", "3 Dec"] } },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(meta.sent.at(-1).template, { name: "booking_reminder", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Hana" }, { type: "text", text: "3 Dec" }] }] });
  const conv = await M.Conversation.findById(r.json.data.conversationId).lean();
  assert.deepEqual([conv.channel, String(conv.contactId), conv.participantAddress, conv.externalThreadId], ["whatsapp", String(ids.hk), "85291234567", "85291234567"]);
  const msg = await M.Message.findOne({ conversationId: conv._id }).lean();
  assert.equal(msg.body, "Hi Hana, your booking is on 3 Dec.");
  assert.ok(await M.Activity.exists({ contactId: ids.hk, type: "whatsapp_sent", subject: "WhatsApp sent: Hi Hana, your booking is on 3 Dec." }));

  // A second message reuses the same thread.
  const t = await api("/integrations/whatsapp/messages", { method: "POST", as: "op", body: { to: "85291234567", contactId: String(ids.hk), text: "See you soon" } });
  assert.equal(t.json.data.conversationId, String(conv._id));

  meta.nextError = { code: 131047, message: "Re-engagement message" };
  const closed = await api("/integrations/whatsapp/messages", { method: "POST", as: "op", body: { to: "85291234567", text: "hi" } });
  assert.deepEqual([closed.status, closed.json.code], [409, "WHATSAPP_WINDOW_CLOSED"]);
  assert.equal(closed.json.message, "This person hasn't messaged in the last 24 hours. Use an approved template.");
  meta.nextError = { code: 131026, message: "Receiver is incapable of receiving this message" };
  assert.deepEqual([(await api("/integrations/whatsapp/messages", { method: "POST", as: "op", body: { to: "85291234567", text: "hi" } })).status], [422]);
  meta.nextError = { code: 100, message: "Invalid parameter" };
  const other = await api("/integrations/whatsapp/messages", { method: "POST", as: "op", body: { to: "85291234567", text: "hi" } });
  assert.deepEqual([other.status, other.json.message], [502, "Invalid parameter"]);
  assert.equal((await api("/integrations/whatsapp/messages", { method: "POST", as: "viewer", body: { to: "85291234567", text: "hi" } })).status, 403);

  // Webhook verification is remembered for the status.
  const v = await realFetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=42`);
  assert.equal(await v.text(), "42");
  await waitFor(() => M.WebhookEvent.exists({ provider: "whatsapp", eventType: "webhook.verified" }));
  assert.equal((await api("/integrations/whatsapp/status")).json.data.webhookVerified, true);
});

test("C stage follow-ups: only stages that are on create a task, with the title and due date; notification wording", { skip }, async () => {
  const p = await M.Pipeline.create({ workspaceId: ids.wsId, name: "Sales", key: "sales", ownerId: ids.admin });
  const mk = (name, sortOrder, extra = {}) => api(`/pipelines/${p._id}/stages`, { method: "POST", body: { name, key: name.toLowerCase().replace(/\W+/g, "-"), sortOrder, ...extra } });
  const s1 = (await mk("Enquiry", 0)).json.data;
  const quote = (await mk("Quote sent", 1)).json.data;
  const trial = await mk("Trial", 2, { followUp: { enabled: true, dueInDays: 0, title: "Check trial for {deal}" } });
  assert.equal(trial.status, 201, JSON.stringify(trial.json));
  assert.equal((await mk("Bad", 3, { followUp: { enabled: true, dueInDays: 99 } })).json.code, "INVALID_FOLLOW_UP");
  assert.deepEqual(quote.followUp, { enabled: true, dueInDays: 3, title: "Quote follow-up: {deal}" }, "default for Quote sent");
  const stages = (await api(`/pipelines/${p._id}/stages`)).json.data;
  assert.deepEqual(stages.map((s) => s.followUp.enabled), [false, true, true]);
  const patched = await api(`/pipelines/stages/${s1._id}`, { method: "PATCH", body: { followUp: { dueInDays: 61 } } });
  assert.equal(patched.json.code, "INVALID_FOLLOW_UP");

  const contact = await M.Contact.create({ workspaceId: ids.wsId, firstName: "Deal", lastName: "Person", ownerId: ids.admin });
  const deal = await M.Deal.create({ workspaceId: ids.wsId, title: "Office for Deal", contactId: contact._id, pipelineId: p._id, stageId: s1._id, ownerId: ids.admin });
  const move = (stageId) => api(`/deals/${deal._id}`, { method: "PATCH", body: { stageId: String(stageId) } });
  const tasks = () => M.Task.find({ dealId: deal._id }).sort({ createdAt: 1 }).lean();

  await move(trial.json.data._id);
  let t = await tasks();
  assert.deepEqual(t.map((x) => x.title), ["Check trial for Office for Deal"]);
  assert.ok(t[0].dueAt > new Date());
  let note = await M.Notification.findOne({ entityId: deal._id }).sort({ createdAt: -1 }).lean();
  assert.match(note.body, /A follow-up task was created\.$/);

  await move(s1._id); // off: no task, notification without the sentence
  assert.equal((await tasks()).length, 1);
  note = await M.Notification.findOne({ entityId: deal._id }).sort({ createdAt: -1, _id: -1 }).lean();
  assert.equal(note.body, "Office for Deal moved to Enquiry.");

  await move(quote._id);
  t = await tasks();
  assert.deepEqual(t.map((x) => x.title), ["Check trial for Office for Deal", "Quote follow-up: Office for Deal"], "one task, no separate hard-coded quote task");
  const { followUpDueAt: due } = await import("../src/utils/stageFollowUp.js");
  assert.equal(t[1].dueAt.toISOString(), due(3).toISOString());

  // Migration: only stages without followUp; Quote sent on.
  await M.PipelineStage.collection.updateMany({ pipelineId: p._id }, { $unset: { followUp: "" } });
  await M.PipelineStage.collection.updateOne({ _id: new mongoose.Types.ObjectId(trial.json.data._id) }, { $set: { followUp: { enabled: true, dueInDays: 5, title: "Kept" } } });
  const mig = await import("../src/migrations/20261127b-stage-followups.js");
  const logs = [];
  await mig.up({ apply: true, log: (m) => logs.push(m) });
  const after = await M.PipelineStage.find({ pipelineId: p._id }).sort({ sortOrder: 1 }).lean();
  assert.deepEqual(after.map((s) => [s.name, s.followUp.enabled, s.followUp.dueInDays, s.followUp.title]), [
    ["Enquiry", false, 1, ""], ["Quote sent", true, 3, "Quote follow-up: {deal}"], ["Trial", true, 5, "Kept"],
  ]);
  await mig.up({ apply: true, log: () => {} });
  assert.equal((await M.PipelineStage.findById(trial.json.data._id).lean()).followUp.title, "Kept", "idempotent");
});
