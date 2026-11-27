/*
 * Focused test report 27 Nov: F3 /memberships validation; F1 read-only Gmail delivery check.
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/banyan_f27_test node --test tests/focused-2026-11-27.test.js
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_ACCESS_SECRET ||= "f27-access";
process.env.JWT_REFRESH_SECRET ||= "f27-refresh";
process.env.MONGODB_URI ||= process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:1/unused";
process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "c".repeat(64);
process.env.BANYAN_BOOKING_SYNC_MINUTES = "0";

const { validateMembership } = await import("../src/utils/membershipValidation.js");

test("F3 validateMembership rules", () => {
  const bad = (p, ex, rx) => assert.throws(() => validateMembership(p, ex), (e) => e.statusCode === 422 && e.code === "INVALID_MEMBERSHIP" && rx.test(e.message), JSON.stringify(p));
  for (const seats of [0, 501, 1.5, -1, "abc", null, ""]) bad({ seats }, null, /whole number from 1 to 500/);
  for (const seats of [1, 500, "12"]) validateMembership({ seats });
  for (const monthlyValue of [-0.01, "x", null, Infinity]) bad({ monthlyValue }, null, /0 or more/);
  validateMembership({ monthlyValue: 0 });
  validateMembership({ monthlyValue: "1200.5" });
  bad({ startAt: "2026-12-01", renewalAt: "2026-11-30" }, null, /renewal date can't be before the start date/);
  bad({ startAt: "2026-12-01", endAt: "2026-11-01" }, null, /end date can't be before the start date/);
  bad({ startAt: "not a date" }, null, /start date isn't a valid date/);
  validateMembership({ startAt: "2026-12-01", renewalAt: "2026-12-01", endAt: "2027-12-01" });
  validateMembership({ renewalAt: "2026-01-01" }); // no start date: nothing to compare
  // Update: stored start date counts; unrelated updates never blocked by old data.
  const stored = { startAt: new Date("2026-12-01"), endAt: new Date("2026-06-01") };
  bad({ renewalAt: "2026-11-01" }, stored, /renewal/);
  validateMembership({ status: "paused" }, stored);
  validateMembership({ endAt: null }, stored);
});

/* ---------- integration ---------- */
const realFetch = globalThis.fetch;
const gmailCalls = [];
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  if (url.hostname !== "gmail.googleapis.com") return realFetch(input, init);
  const method = (init.method || "GET").toUpperCase();
  gmailCalls.push(`${method} ${url.pathname}`);
  const p = url.pathname.replace("/gmail/v1/users/me", "");
  const hdrs = (o) => ({ payload: { headers: Object.entries(o).map(([name, value]) => ({ name, value })) } });
  if (p === "/profile") return json(200, { emailAddress: "info@banyan.test" });
  if (p === "/settings/sendAs") return json(200, { sendAs: [{ sendAsEmail: "info@banyan.test", isPrimary: true, isDefault: true }, { sendAsEmail: "hello@banyan.test", verificationStatus: "pending" }] });
  if (p === "/messages/abc123def") return json(200, { id: "abc123def", threadId: "abc123def", labelIds: ["SENT"], ...hdrs({ From: "info@banyan.test", To: "qa+focus@example.com", Subject: "TEST QA email focus", Date: "Fri, 27 Nov 2026 08:23:48 +0800" }) });
  if (p === "/messages/missing99") return json(404, { error: { code: 404, message: "Requested entity was not found." } });
  if (p === "/messages") {
    assert.match(url.searchParams.get("q"), /from:\(mailer-daemon OR postmaster\) newer_than:7d/);
    return json(200, { messages: [{ id: "bounce1" }] });
  }
  if (p === "/messages/bounce1") return json(200, { id: "bounce1", snippet: "Address not found", ...hdrs({ From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", Subject: "Delivery Status Notification (Failure)", Date: "Fri, 27 Nov 2026 08:24:00 +0800" }) });
  return json(404, { error: { message: "unexpected " + p } });
};

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
  for (const n of ["User", "Workspace", "Contact", "Membership", "Integration", "Message"]) M[n] = (await import(`../src/models/${n}.js`))[n];
  const wsId = new mongoose.Types.ObjectId();
  const admin = await M.User.create({ workspaceId: wsId, name: "Felicia", email: "felicia@f27.test", passwordHash: "x", role: "admin" });
  const op = await M.User.create({ workspaceId: wsId, name: "Jojo", email: "jojo@f27.test", passwordHash: "x", role: "operator" });
  await M.Workspace.create({ _id: wsId, name: "Banyan", slug: "f27-test", createdBy: admin._id });
  const contact = await M.Contact.create({ workspaceId: wsId, firstName: "Mia", lastName: "Member", email: "mia@f27.test", ownerId: admin._id });
  await M.Integration.create({ workspaceId: wsId, provider: "gmail", status: "connected", accessTokenEncrypted: encryptIntegrationToken("fake"), config: { email: "info@banyan.test" } });
  await M.Message.collection.insertOne({ workspaceId: wsId, direction: "outbound", status: "sent", sentAt: new Date(), metadata: { provider: "gmail", gmailMessageId: "abc123def" } });
  Object.assign(ids, { wsId, contact: contact._id });
  tokens.admin = signAccessToken(admin);
  tokens.op = signAccessToken(op);
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

test("F3 POST / PATCH /memberships return 422 with a plain message", { skip }, async () => {
  const contactId = String(ids.contact);
  for (const [body, rx] of [
    [{ contactId, seats: 0 }, /Seats must be a whole number from 1 to 500/],
    [{ contactId, seats: 2.5 }, /Seats/],
    [{ contactId, monthlyValue: -5 }, /Monthly value must be 0 or more/],
    [{ contactId, startAt: "2026-12-01", renewalAt: "2026-11-01" }, /renewal date/],
    [{ contactId, startAt: "2026-12-01", endAt: "2026-11-01" }, /end date/],
  ]) {
    const r = await api("/memberships", { method: "POST", body });
    assert.equal(r.status, 422, JSON.stringify(r.json));
    assert.equal(r.json.code, "INVALID_MEMBERSHIP");
    assert.match(r.json.message, rx);
  }
  assert.equal(await M.Membership.countDocuments(), 0, "nothing saved");
  const ok = await api("/memberships", { method: "POST", body: { contactId, seats: 3, monthlyValue: 0, startAt: "2026-12-01", renewalAt: "2027-01-01" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const id = ok.json.data._id;
  const late = await api(`/memberships/${id}`, { method: "PATCH", body: { endAt: "2026-11-15" } });
  assert.equal(late.status, 422, "stored start date is used on update");
  assert.match(late.json.message, /end date can't be before the start date/);
  assert.equal((await api(`/memberships/${id}`, { method: "PATCH", body: { seats: 501 } })).status, 422);
  const good = await api(`/memberships/${id}`, { method: "PATCH", body: { seats: 500, status: "paused" } });
  assert.equal(good.status, 200, JSON.stringify(good.json));
  assert.equal(good.json.data.seats, 500);
  assert.equal((await api("/memberships/000000000000000000000000", { method: "PATCH", body: { seats: 2 } })).status, 404);
});

test("F1 GET /integrations/google/gmail/diagnostics is read-only and admin-only", { skip }, async () => {
  assert.equal((await api("/integrations/google/gmail/diagnostics?ids=abc123def", { as: "op" })).status, 403);
  assert.equal((await api("/integrations/google/gmail/diagnostics?ids=bad%20id")).status, 400);
  gmailCalls.length = 0;
  const r = await api("/integrations/google/gmail/diagnostics?ids=abc123def,missing99");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const d = r.json.data;
  assert.deepEqual(d.account, { signedIn: "info@banyan.test", configuredFrom: "info@banyan.test" });
  assert.equal(d.fromIsSignedInAccount, true);
  assert.equal(d.fromIsVerifiedAlias, true);
  assert.equal(d.sendAs.find((s) => s.email === "hello@banyan.test").verificationStatus, "pending");
  const [sent, missing] = d.messages;
  assert.deepEqual([sent.found, sent.hasSentLabel, sent.savedInCrm, sent.from, sent.subject], [true, true, true, "info@banyan.test", "TEST QA email focus"]);
  assert.deepEqual([missing.found, missing.savedInCrm], [false, false]);
  assert.equal(d.bounces.items.length, 1);
  assert.match(d.bounces.items[0].subject, /Delivery Status Notification/);
  assert.ok(gmailCalls.length > 0 && gmailCalls.every((c) => c.startsWith("GET ")), "only GET calls");
  assert.ok(!JSON.stringify(d).includes("fake"), "no token in the reply");
});
