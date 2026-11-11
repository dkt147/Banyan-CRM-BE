/*
 * WordPress room bookings.
 *  - Unit tests (always run): payload mapping and webhook signature.
 *  - Integration tests (need a throwaway MongoDB whose name contains "test"):
 *      TEST_MONGODB_URI=mongodb://127.0.0.1:27017/banyan_wp_test node --test tests/wp-room-bookings.test.js
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const TOKEN = "wp-test-token-123";
process.env.BANYAN_CRM_TOKEN = TOKEN;
process.env.BANYAN_BOOKING_SYNC_MINUTES = "0";
// Unreachable on purpose: on-read syncs must fail fast and never call the real website.
process.env.BANYAN_WP_API_URL = "http://127.0.0.1:9/wp-json/banyan/v1/";
process.env.PUBLIC_ENQUIRY_WORKSPACE_ID = "";
process.env.PUBLIC_ENQUIRY_WORKSPACE_SLUG = "wp-bookings-test";
process.env.JWT_ACCESS_SECRET ||= "wp-test-access-secret";
process.env.JWT_REFRESH_SECRET ||= "wp-test-refresh-secret";
process.env.MONGODB_URI ||= process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:1/unused";

const { mapWpPayload, verifyWpSignature, toRoomBookingRow, stripePaymentUrl } = await import("../src/services/wpRoomBooking.service.js");

const payload = (overrides = {}) => ({
  event: "booking.paid",
  sent_at: "2026-11-11T15:05:48+00:00",
  source: "https://banyanworkspace.com",
  booking: {
    ref: "BNY-LDNMJ4", status: "paid", channel: "web", room_key: "medium", room_name: "Meeting Room (14 people)",
    date: "2026-11-13", start_time: "10:00", end_time: "12:00", hours: 2,
    start_iso: "2026-11-13T10:00:00+08:00", end_iso: "2026-11-13T12:00:00+08:00",
    timezone: "Asia/Hong_Kong", created_at: "2026-11-11T15:04:53+00:00",
    ...overrides.booking,
  },
  customer: {
    first_name: "Test", last_name: "Booking", email: "Test.Booking@banyanworkspace.com", phone: "+852 5555 0000",
    notes: "TEST BOOKING - Stripe test mode, please ignore", ...overrides.customer,
  },
  payment: {
    provider: "stripe", mode: "test", amount: 1160, amount_minor: 116000, currency: "HKD", status: "paid",
    paid_at: "2026-11-11T15:05:48+00:00", stripe_session_id: "cs_test_abc", stripe_payment_intent: "pi_abc",
    ...overrides.payment,
  },
});
const sign = (raw) => crypto.createHmac("sha256", TOKEN).update(raw).digest("hex");

/* ---------- unit ---------- */
test("maps a paid web booking to a confirmed, paid cache row", () => {
  const m = mapWpPayload(payload());
  assert.equal(m.ref, "BNY-LDNMJ4");
  assert.equal(m.fields.status, "confirmed");
  assert.equal(m.fields.paymentStatus, "paid");
  assert.equal(m.fields.amountMinor, 116000);
  assert.equal(m.fields.startAt.toISOString(), "2026-11-13T02:00:00.000Z");
  assert.equal(m.fields.bookingType, "meeting_room");
  assert.equal(m.fields.holdExpiresAt, null);
  assert.equal(m.wp.payment.mode, "test");
  assert.equal(m.wp.viaCrm, false);
  assert.equal(stripePaymentUrl(m.wp.payment), "https://dashboard.stripe.com/test/payments/pi_abc");
});

test("maps pending (35-min hold), blocked, cancelled and CRM-originated bookings", () => {
  const pending = mapWpPayload(payload({ booking: { status: "pending" }, payment: { status: "pending", paid_at: null } }));
  assert.equal(pending.fields.status, "pending_payment");
  assert.equal(pending.fields.holdExpiresAt.toISOString(), "2026-11-11T15:39:53.000Z");

  const blocked = mapWpPayload({ booking: { ...payload().booking, ref: "BNY-BLOCK1", status: "blocked", channel: "admin" }, customer: { first_name: "Blocked", notes: "Maintenance" } });
  assert.equal(blocked.fields.bookingType, "blocked");
  assert.equal(blocked.fields.paymentStatus, "not_required");
  assert.equal(blocked.contactDetails, null);
  assert.equal(blocked.fields.title, "Blocked – Maintenance");

  const cancelled = mapWpPayload(payload({ booking: { status: "cancelled" } }));
  assert.equal(cancelled.fields.status, "cancelled");
  assert.equal(cancelled.fields.paymentStatus, "paid", "paid money stays recorded; refunds happen in Stripe");

  const crm = mapWpPayload(payload({ customer: { notes: "Booked via CRM by Felicia – U-shape" } }));
  assert.equal(crm.wp.viaCrm, true);
  assert.equal(toRoomBookingRow({ _id: "x", externalRef: crm.ref, ...crm.fields, metadata: { wp: crm.wp } }).viaCrm, true);
});

test("rejects payloads without a valid ref, status or time", () => {
  assert.throws(() => mapWpPayload(payload({ booking: { ref: "" } })), /ref/);
  assert.throws(() => mapWpPayload(payload({ booking: { status: "weird" } })), /status/);
  assert.throws(() => mapWpPayload(payload({ booking: { start_iso: "bad", date: null } })), /time/);
});

test("signature: raw-body HMAC + token, constant time", () => {
  const raw = Buffer.from(JSON.stringify(payload()).replace(/\//g, "\\/")); // WP escapes slashes
  assert.equal(verifyWpSignature(raw, sign(raw), TOKEN, TOKEN), true);
  assert.equal(verifyWpSignature(raw, `sha256=${sign(raw)}`, TOKEN, TOKEN), true);
  assert.equal(verifyWpSignature(raw, sign(Buffer.from("other")), TOKEN, TOKEN), false);
  assert.equal(verifyWpSignature(raw, sign(raw), "wrong-token-xyz12", TOKEN), false);
  assert.equal(verifyWpSignature(raw, "nothex", TOKEN, TOKEN), false);
  assert.equal(verifyWpSignature(raw, sign(raw), TOKEN, ""), false);
});

/* ---------- integration ---------- */
const TEST_URI = process.env.TEST_MONGODB_URI;
const skip = !TEST_URI ? "TEST_MONGODB_URI not set" : !/test/i.test(new URL(TEST_URI).pathname) ? "database name must contain 'test'" : false;
let mongoose, server, base, token, models = {};

before(async () => {
  if (skip) return;
  process.env.MONGODB_URI = TEST_URI;
  mongoose = (await import("mongoose")).default;
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  const app = (await import("../src/app.js")).default;
  const { signAccessToken } = await import("../src/utils/tokens.js");
  for (const name of ["User", "Workspace", "Booking", "Contact", "Activity", "Resource"])
    models[name] = (await import(`../src/models/${name}.js`))[name];
  await models.Booking.createIndexes();
  const wsId = new mongoose.Types.ObjectId();
  const admin = await models.User.create({ workspaceId: wsId, name: "Felicia", email: "felicia@wp.test", passwordHash: "x", role: "admin" });
  await models.Workspace.create({ _id: wsId, name: "WP", slug: "wp-bookings-test", createdBy: admin._id });
  token = signAccessToken(admin);
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

async function push(body, { event = body.event, signature, tok = TOKEN } = {}) {
  const raw = JSON.stringify(body).replace(/\//g, "\\/");
  const res = await fetch(`${base}/webhooks/banyan-bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Banyan-Event": event, "X-Banyan-Token": tok, "X-Banyan-Signature": signature ?? sign(Buffer.from(raw)) },
    body: raw,
  });
  return { status: res.status, json: await res.json() };
}
const api = async (path, init = {}) => {
  if (init.body && typeof init.body !== "string") init = { ...init, body: JSON.stringify(init.body) };
  const res = await fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
  return { status: res.status, json: await res.json() };
};

test("webhook: rejects bad signature, upserts by ref, links contact; test-mode adds no timeline entry", { skip }, async () => {
  assert.equal((await push(payload(), { signature: "0".repeat(64) })).status, 401);
  assert.equal((await push(payload(), { tok: "nope" })).status, 401);

  const first = await push(payload());
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.created, true);
  const again = await push(payload());
  assert.equal(again.json.created, false);
  assert.equal(await models.Booking.countDocuments({ externalRef: "BNY-LDNMJ4" }), 1);

  const b = await models.Booking.findOne({ externalRef: "BNY-LDNMJ4" });
  const contact = await models.Contact.findById(b.contactId);
  assert.equal(contact.email, "test.booking@banyanworkspace.com");
  assert.ok(await models.Resource.exists({ name: "Meeting Room (14 people)" }));
  assert.ok(contact.tags.includes("test-booking"), "contacts created by Stripe test bookings are tagged");
  assert.equal(await models.Activity.countDocuments({ "metadata.wpRef": "BNY-LDNMJ4" }), 0);

  // A late "pending" push must not downgrade a paid booking.
  const stale = await push(payload({ booking: { status: "pending" } }), { event: "booking.snapshot" });
  assert.equal(stale.json.skipped, "stale_event");

  const cancelled = await push({ ...payload({ booking: { status: "cancelled" } }), event: "booking.cancelled" });
  assert.equal(cancelled.status, 200);
  const after = await models.Booking.findOne({ externalRef: "BNY-LDNMJ4" });
  assert.equal(after.status, "cancelled");
  assert.equal(await models.Booking.countDocuments({ externalRef: "BNY-LDNMJ4" }), 1);
  assert.equal(await models.Activity.countDocuments({ "metadata.wpRef": "BNY-LDNMJ4" }), 0);
});

test("webhook: live-mode bookings add one timeline entry per transition; existing contacts are not tagged", { skip }, async () => {
  const real = await models.Contact.create({ workspaceId: (await models.Workspace.findOne())._id, ownerId: (await models.User.findOne())._id, firstName: "Jane", lastName: "Chan", email: "jane@example.com" });
  const live = (status) =>
    payload({
      booking: { ref: "BNY-LIVE01", status },
      customer: { first_name: "Jane", last_name: "Chan", email: "Jane@Example.com" },
      payment: { mode: "live", stripe_payment_intent: "pi_live" },
    });
  assert.equal((await push(live("paid"))).status, 200);
  await push(live("paid"));
  const b = await models.Booking.findOne({ externalRef: "BNY-LIVE01" });
  assert.equal(String(b.contactId), String(real._id));
  assert.ok(!(await models.Contact.findById(real._id)).tags.includes("test-booking"));
  assert.equal(await models.Activity.countDocuments({ "metadata.wpRef": "BNY-LIVE01" }), 1);
  await push({ ...live("cancelled"), event: "booking.cancelled" });
  assert.equal(await models.Activity.countDocuments({ "metadata.wpRef": "BNY-LIVE01" }), 2);
});

test("room-bookings API: list filters, detail, config, and WordPress rows are read-only", { skip }, async () => {
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  await push(payload({ booking: { ref: "BNY-FUT001", date: future, start_iso: `${future}T13:00:00+08:00`, end_iso: `${future}T16:00:00+08:00`, start_time: "13:00", end_time: "16:00", hours: 3 }, customer: { notes: "Booked via CRM by Felicia" }, payment: { stripe_payment_intent: "pi_fut" } }));

  const list = await api("/room-bookings?status=active&range=upcoming");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const row = list.json.data.items.find((i) => i.ref === "BNY-FUT001");
  assert.ok(row);
  assert.equal(row.status, "paid");
  assert.equal(row.viaCrm, true);
  assert.equal(row.payment.isTest, true);
  assert.equal(row.payment.amountLabel, "HK$1,160");
  assert.ok(!list.json.data.items.some((i) => i.ref === "BNY-LDNMJ4"), "cancelled is not active");

  const cancelled = await api("/room-bookings?status=cancelled&range=all&search=ldnmj4");
  assert.equal(cancelled.json.data.items.length, 1);

  const detail = await api("/room-bookings/BNY-FUT001");
  assert.equal(detail.status, 200);

  const config = await api("/room-bookings/config");
  assert.equal(config.json.data.notesPrefix, "Booked via CRM by Felicia");
  assert.equal(config.json.data.rooms.length, 3);

  const edit = await api(`/bookings/${row.id}`, { method: "PATCH", body: { notes: "x" } });
  assert.equal(edit.status, 409);
  assert.equal(edit.json.code ?? edit.json.error?.code, "WP_BOOKING_READ_ONLY");
  assert.equal((await api(`/calendar/${row.id}/cancel`, { method: "PATCH" })).status, 409);
  assert.equal((await api(`/bookings/${row.id}`, { method: "DELETE" })).status, 409);

  // Calendar week payload carries the WordPress fields the frontend styles on.
  const week = await api(`/calendar/week?from=${future}T00:00:00%2B08:00&days=1`);
  assert.equal(week.status, 200, JSON.stringify(week.json));
  const item = week.json.data.items.find((i) => i.externalRef === "BNY-FUT001");
  assert.ok(item, "WordPress booking is in /calendar/week");
  assert.equal(item.wpStatus, "paid");
  assert.equal(item.wpRoomKey, "medium");
});

test("room-bookings: config.lastSync, plain 503 when sync is not configured", { skip }, async () => {
  // The list request above started an on-read sync against the unreachable test URL.
  await new Promise((r) => setTimeout(r, 300));
  const config = await api("/room-bookings/config");
  const last = config.json.data.lastSync;
  assert.ok(last, JSON.stringify(config.json.data));
  assert.ok(last.at && last.mode && last.error, "a failed sync is reported with its error");
  for (const k of ["created", "updated", "failed"]) assert.equal(typeof last[k], "number");

  const { env } = await import("../src/config/env.js");
  const saved = env.BANYAN_CRM_TOKEN;
  env.BANYAN_CRM_TOKEN = "";
  try {
    const sync = await api("/room-bookings/sync", { method: "POST", body: {} });
    assert.equal(sync.status, 503);
    assert.equal(sync.json.message, "WordPress sync isn't configured on the server (BANYAN_CRM_TOKEN).");
    assert.equal((await api("/room-bookings/config")).json.data.syncConfigured, false);
  } finally {
    env.BANYAN_CRM_TOKEN = saved;
  }
});

test("CRM-only bookings and holds cannot use the WordPress rooms", { skip }, async () => {
  const contact = await models.Contact.findOne({ email: "jane@example.com" });
  const wpResource = await models.Resource.findOne({ name: "Meeting Room (14 people)" });
  const start = new Date(Date.now() + 5 * 86400000), end = new Date(start.getTime() + 3600000);
  const base = { contactId: String(contact._id), startAt: start, endAt: end, bookingType: "meeting_room" };

  const byName = await api("/bookings", { method: "POST", body: { ...base, resourceName: "Meeting Room (14 people)" } });
  assert.equal(byName.status, 409);
  assert.equal(byName.json.code, "WP_ROOM_BOOK_VIA_WORDPRESS");
  assert.equal((await api("/bookings", { method: "POST", body: { ...base, resourceId: String(wpResource._id) } })).status, 409);
  assert.equal((await api("/calendar/hold", { method: "POST", body: { ...base, resourceName: "the library (15 people (depending on layout))" } })).status, 409);

  // Other rooms still work, and a client cannot forge externalRef.
  const ok = await api("/bookings", { method: "POST", body: { ...base, resourceName: "Photo Studio", externalRef: "BNY-FAKE01" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.data.externalRef, undefined);
  const move = await api(`/bookings/${ok.json.data._id}`, { method: "PATCH", body: { resourceName: "Meeting Room (5 to 6 people)" } });
  assert.equal(move.status, 409);
});
