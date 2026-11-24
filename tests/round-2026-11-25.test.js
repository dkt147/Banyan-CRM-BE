/*
 * Client meeting round (25 Nov 2026): created-date filters on contacts and deals, passwords (admin set,
 * change own), day pass credits (packages, half days, balance and low-balance emails).
 * Partner blocks per room are tested in crm-feedback.test.js.
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/banyan_round25_test node --test tests/round-2026-11-25.test.js
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_ACCESS_SECRET ||= "r25-access";
process.env.JWT_REFRESH_SECRET ||= "r25-refresh";
process.env.MONGODB_URI ||= process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:1/unused";
process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = "b".repeat(64);
process.env.BANYAN_BOOKING_SYNC_MINUTES = "0";

const { createdRangeFilter } = await import("../src/utils/createdRange.js");

test("§1 created range: HK midnight edges, inclusive, either end alone, bad input is 400", () => {
  assert.deepEqual(createdRangeFilter({ createdFrom: "2026-11-18", createdTo: "2026-11-25" }), {
    createdAt: { $gte: new Date("2026-11-17T16:00:00.000Z"), $lt: new Date("2026-11-25T16:00:00.000Z") },
  });
  assert.deepEqual(createdRangeFilter({ createdTo: "2026-12-31" }), { createdAt: { $lt: new Date("2026-12-31T16:00:00.000Z") } });
  assert.deepEqual(createdRangeFilter({ createdFrom: "2026-11-25", createdTo: "2026-11-25" }).createdAt.$gte, new Date("2026-11-24T16:00:00.000Z"));
  assert.equal(createdRangeFilter({}), null);
  for (const bad of [{ createdFrom: "2026-13-01" }, { createdTo: "2026-02-30" }, { createdFrom: "25/11/2026" }, { createdFrom: "2026-11-26", createdTo: "2026-11-25" }]) {
    assert.throws(() => createdRangeFilter(bad), (e) => e.code === "INVALID_DATE_RANGE" && e.statusCode === 400, JSON.stringify(bad));
  }
});

/* ---------- integration ---------- */
const realFetch = globalThis.fetch;
const sentMail = [];
// Plain-text part of a sent MIME message (base64 encoded).
const textOf = (mime) => {
  const part = mime.split("Content-Type: text/plain")[1] || "";
  const b64 = part.split(/\r?\n\r?\n/)[1]?.split("--")[0] || "";
  return Buffer.from(b64.replace(/\s+/g, ""), "base64").toString("utf8");
};
let gmailFails = false;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  if (url.hostname === "gmail.googleapis.com") {
    if (gmailFails) return new Response(JSON.stringify({ error: { message: "Backend Error" } }), { status: 500, headers: { "Content-Type": "application/json" } });
    sentMail.push(Buffer.from(JSON.parse(init.body).raw, "base64url").toString("utf8"));
    return new Response(JSON.stringify({ id: "m1" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
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
  const bcrypt = (await import("bcryptjs")).default;
  const { signAccessToken } = await import("../src/utils/tokens.js");
  const { encryptIntegrationToken } = await import("../src/utils/integrationTokens.js");
  for (const n of ["User", "Workspace", "Contact", "Deal", "Pipeline", "PipelineStage", "RefreshToken", "AuditLog", "Activity", "Integration", "DayPassEntry", "DayPassAccount"])
    M[n] = (await import(`../src/models/${n}.js`))[n];
  for (const n of ["DayPassAccount", "RefreshToken"]) await M[n].createIndexes();
  const wsId = new mongoose.Types.ObjectId();
  const hash = await bcrypt.hash("Secret123!", 4);
  const admin = await M.User.create({ workspaceId: wsId, name: "Felicia", email: "felicia@r25.test", passwordHash: hash, role: "admin" });
  const jojo = await M.User.create({ workspaceId: wsId, name: "Jojo", email: "jojo@r25.test", passwordHash: hash, role: "operator" });
  const gone = await M.User.create({ workspaceId: wsId, name: "Gone", email: "gone@r25.test", passwordHash: hash, role: "operator", isActive: false });
  const limited = await M.User.create({ workspaceId: wsId, name: "Lim", email: "lim@r25.test", passwordHash: hash, role: "operator" });
  const viewer = await M.User.create({ workspaceId: wsId, name: "Vee", email: "vee@r25.test", passwordHash: hash, role: "read_only" });
  await M.Workspace.create({ _id: wsId, name: "Banyan", slug: "round25-test", createdBy: admin._id });
  await M.Integration.create({ workspaceId: wsId, provider: "gmail", status: "connected", accessTokenEncrypted: encryptIntegrationToken("fake"), config: { email: "info@banyan.test" } });
  Object.assign(ids, { wsId, admin: admin._id, jojo: jojo._id, gone: gone._id, limited: limited._id });
  for (const [k, u] of Object.entries({ admin, jojo, limited, viewer })) tokens[k] = signAccessToken(u);
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

const api = async (path, { method = "GET", body, as = "admin", token } = {}) => {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: { ...(as || token ? { Authorization: `Bearer ${token || tokens[as]}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

test("§1 GET /contacts and /deals with createdFrom / createdTo", { skip }, async () => {
  const at = (iso) => new Date(iso);
  const mk = (first, createdAt, extra = {}) =>
    M.Contact.collection.insertOne({ workspaceId: ids.wsId, firstName: first, lastName: "Range", email: `${first.toLowerCase()}@range.test`, ownerId: ids.admin, isArchived: false, tags: [], createdAt, updatedAt: createdAt, ...extra });
  await mk("Before", at("2026-11-17T15:59:59.999Z")); // 17 Nov 23:59:59 HK
  await mk("First", at("2026-11-17T16:00:00.000Z")); // 18 Nov 00:00 HK
  await mk("Last", at("2026-11-25T15:59:59.999Z")); // 25 Nov 23:59:59 HK
  await mk("After", at("2026-11-25T16:00:00.000Z")); // 26 Nov 00:00 HK
  await mk("Archived", at("2026-11-20T04:00:00.000Z"), { isArchived: true });

  const names = (r) => r.json.data.map((c) => c.firstName).sort();
  const both = await api("/contacts?createdFrom=2026-11-18&createdTo=2026-11-25&search=range");
  assert.equal(both.status, 200, JSON.stringify(both.json));
  assert.deepEqual(names(both), ["First", "Last"]);
  assert.equal(both.json.pagination.total, 2);
  assert.deepEqual(names(await api("/contacts?createdFrom=2026-11-26&search=range")), ["After"]);
  assert.deepEqual(names(await api("/contacts?createdTo=2026-11-17&search=range")), ["Before"]);
  assert.deepEqual(names(await api("/contacts?createdFrom=2026-11-18&createdTo=2026-11-25&isArchived=all&search=range")), ["Archived", "First", "Last"]);
  const bad = await api("/contacts?createdFrom=2026-11-26&createdTo=2026-11-25");
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "INVALID_DATE_RANGE");
  assert.match(bad.json.message, /on or before/);
  assert.equal((await api("/contacts?createdFrom=2026-13-01")).json.code, "INVALID_DATE_RANGE");

  const pipeline = await M.Pipeline.create({ workspaceId: ids.wsId, name: "P", key: "p", ownerId: ids.admin });
  const stage = await M.PipelineStage.create({ workspaceId: ids.wsId, pipelineId: pipeline._id, name: "S", key: "s", sortOrder: 0 });
  const contact = await M.Contact.findOne({ firstName: "First" });
  for (const [title, iso, dealNumber] of [["D-in", "2026-11-18T01:00:00Z", 9001], ["D-out", "2026-11-26T01:00:00Z", 9002]])
    await M.Deal.collection.insertOne({ workspaceId: ids.wsId, title, dealNumber, contactId: contact._id, pipelineId: pipeline._id, stageId: stage._id, ownerId: ids.admin, status: "open", value: 0, createdAt: new Date(iso), updatedAt: new Date(iso) });
  const deals = await api(`/deals?createdFrom=2026-11-18&createdTo=2026-11-25&pipelineId=${pipeline._id}`);
  assert.equal(deals.status, 200, JSON.stringify(deals.json));
  assert.deepEqual(deals.json.data.items.map((d) => d.title), ["D-in"]);
  assert.equal(deals.json.data.pagination.total, 1);
  assert.equal((await api("/deals?createdTo=nope")).status, 400);
});

test("§2a admin sets a member's password: rules, not on self, not inactive, signs the member out", { skip }, async () => {
  const login = await api("/auth/login", { method: "POST", as: null, body: { email: "jojo@r25.test", password: "Secret123!" } });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const oldRefresh = login.json.data.refreshToken;

  assert.equal((await api(`/members/${ids.jojo}/password`, { method: "POST", as: "jojo", body: { password: "Newpass123" } })).status, 403);
  assert.equal((await api(`/members/${ids.jojo}/password`, { method: "POST", body: { password: "short1" } })).json.code, "WEAK_PASSWORD");
  assert.equal((await api(`/members/${ids.jojo}/password`, { method: "POST", body: { password: "lettersonly" } })).json.code, "WEAK_PASSWORD");
  assert.equal((await api(`/members/${ids.admin}/password`, { method: "POST", body: { password: "Newpass123" } })).json.code, "USE_CHANGE_PASSWORD");
  const inactive = await api(`/members/${ids.gone}/password`, { method: "POST", body: { password: "Newpass123" } });
  assert.equal(inactive.status, 409);
  assert.equal(inactive.json.code, "USER_INACTIVE");

  const set = await api(`/members/${ids.jojo}/password`, { method: "POST", body: { password: "Newpass123" } });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.equal(set.json.data.id, String(ids.jojo));
  assert.ok(set.json.data.passwordChangedAt);
  assert.equal((await api("/auth/refresh", { method: "POST", as: null, body: { refreshToken: oldRefresh } })).status, 401, "other devices signed out");
  assert.equal((await api("/auth/login", { method: "POST", as: null, body: { email: "jojo@r25.test", password: "Secret123!" } })).status, 401);
  const relogin = await api("/auth/login", { method: "POST", as: null, body: { email: "jojo@r25.test", password: "Newpass123" } });
  assert.equal(relogin.status, 200);
  tokens.jojo = relogin.json.data.accessToken;

  // Access tokens issued before the change are refused.
  const jwt = (await import("jsonwebtoken")).default;
  const stale = jwt.sign({ sub: String(ids.jojo), type: "access", workspaceId: String(ids.wsId), iat: Math.floor(Date.now() / 1000) - 120 }, process.env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
  const ended = await api("/auth/me", { token: stale, as: null });
  assert.equal(ended.status, 401);
  assert.equal(ended.json.code, "SESSION_ENDED");

  const audit = await M.AuditLog.findOne({ action: "user.password_set" }).lean();
  assert.equal(String(audit.entityId), String(ids.jojo));
  assert.equal(String(audit.actorId), String(ids.admin));
  assert.ok(!JSON.stringify(audit).includes("Newpass123"), "never logs the password");
});

test("§2b change own password: 400 (not 401) on a wrong current password, same-password rule, signs out, rate limit", { skip }, async () => {
  const login = await api("/auth/login", { method: "POST", as: null, body: { email: "felicia@r25.test", password: "Secret123!" } });
  const refresh = login.json.data.refreshToken;
  const token = login.json.data.accessToken;
  const change = (body, t = token) => api("/auth/change-password", { method: "POST", token: t, as: null, body });

  const wrong = await change({ currentPassword: "nope", newPassword: "Another123" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.code, "INVALID_CURRENT_PASSWORD");
  assert.equal((await change({ currentPassword: "Secret123!", newPassword: "weak" })).json.code, "WEAK_PASSWORD");
  assert.equal((await change({ currentPassword: "Secret123!", newPassword: "Secret123!" })).json.code, "SAME_PASSWORD");
  const ok = await change({ currentPassword: "Secret123!", newPassword: "Another123" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(ok.json.data.passwordChangedAt);
  assert.equal((await api("/auth/refresh", { method: "POST", as: null, body: { refreshToken: refresh } })).status, 401, "current session revoked too");
  assert.ok(await M.AuditLog.exists({ action: "user.password_changed", entityId: ids.admin }));
  const user = await M.User.findById(ids.admin).lean();
  assert.ok(user.passwordChangedAt);
  // Sign the admin in again for the later tests.
  tokens.admin = (await api("/auth/login", { method: "POST", as: null, body: { email: "felicia@r25.test", password: "Another123" } })).json.data.accessToken;

  // Rate limit: 5 attempts per user per 15 minutes.
  for (let i = 0; i < 5; i++) assert.equal((await change({ currentPassword: "bad", newPassword: "Another123" }, tokens.limited)).status, 400);
  const limited = await change({ currentPassword: "Secret123!", newPassword: "Another123" }, tokens.limited);
  assert.equal(limited.status, 429);
  assert.match(limited.json.message, /15 minutes/);
});

test("§3 day passes: purchase, half and full days, 409 when short, adjust, balance email, low email once a day, no email for TEST", { skip }, async () => {
  const mia = await M.Contact.create({ workspaceId: ids.wsId, firstName: "Mia", lastName: "Desk", email: "mia@desk.test", ownerId: ids.admin });
  const test = await M.Contact.create({ workspaceId: ids.wsId, firstName: "TEST", lastName: "Pass", email: "test@desk.test", ownerId: ids.admin });
  const noMail = await M.Contact.create({ workspaceId: ids.wsId, firstName: "Ned", ownerId: ids.admin });
  const dp = (c, path = "", opts = {}) => api(`/contacts/${c._id}/day-passes${path}`, opts);

  const empty = await dp(mia);
  assert.equal(empty.status, 200, JSON.stringify(empty.json));
  assert.deepEqual([empty.json.data.balance, empty.json.data.lowThreshold, empty.json.data.autoEmail, empty.json.data.entries], [0, 5, true, []]);
  assert.equal((await dp({ _id: new mongoose.Types.ObjectId() })).status, 404);

  assert.equal((await dp(mia, "/purchase", { method: "POST", body: { days: 0.3 } })).json.code, "INVALID_DAYS");
  assert.equal((await dp(mia, "/purchase", { method: "POST", as: "viewer", body: { days: 10 } })).status, 403);
  const bought = await dp(mia, "/purchase", { method: "POST", body: { days: 10, amount: 1800, note: "10-day package" } });
  assert.equal(bought.status, 201, JSON.stringify(bought.json));
  assert.equal(bought.json.data.balance, 10);
  assert.deepEqual([bought.json.data.entry.type, bought.json.data.entry.days, bought.json.data.entry.amount, bought.json.data.entry.by], ["purchase", 10, 1800, "Felicia"]);

  assert.equal((await dp(mia, "/redeem", { method: "POST", body: { days: 2 } })).json.code, "INVALID_DAYS");
  const half = await dp(mia, "/redeem", { method: "POST", body: { days: 0.5, date: "2026-11-24" } });
  assert.equal(half.status, 201, JSON.stringify(half.json));
  assert.deepEqual([half.json.data.balance, half.json.data.entry.days, half.json.data.entry.date, half.json.data.lowBalanceEmailSent], [9.5, -0.5, "2026-11-24", false]);
  for (let i = 0; i < 4; i++) await dp(mia, "/redeem", { method: "POST", body: { days: 1, date: "2026-11-24" } }); // 5.5
  sentMail.length = 0;

  // Down to 4.5: the low-balance email goes out (once that day).
  const low = await dp(mia, "/redeem", { method: "POST", body: { days: 1 } });
  assert.equal(low.json.data.balance, 4.5);
  assert.equal(low.json.data.lowBalanceEmailSent, true, JSON.stringify(low.json.data));
  assert.equal(sentMail.length, 1);
  assert.match(sentMail[0], /Subject: Your Banyan day pass is running low/);
  assert.match(textOf(sentMail[0]), /Hi Mia,\n\nYou have 4\.5 days left on your day pass\. To top up/);
  const again = await dp(mia, "/redeem", { method: "POST", body: { days: 0.5 } });
  assert.equal(again.json.data.lowBalanceEmailSent, false);
  assert.equal(again.json.data.lowBalanceEmail.reason, "Already sent today.");
  assert.equal(sentMail.length, 1);

  // Adjust (admin, note required, never below 0).
  assert.equal((await dp(mia, "/adjust", { method: "POST", as: "jojo", body: { days: 1, note: "x" } })).status, 403);
  assert.equal((await dp(mia, "/adjust", { method: "POST", body: { days: 1 } })).json.code, "NOTE_REQUIRED");
  assert.equal((await dp(mia, "/adjust", { method: "POST", body: { days: -5, note: "too much" } })).json.code, "INSUFFICIENT_DAY_PASSES");
  const adj = await dp(mia, "/adjust", { method: "POST", body: { days: -3.5, note: "Excel carry-over" } });
  assert.equal(adj.status, 201, JSON.stringify(adj.json));
  assert.equal(adj.json.data.balance, 0.5);
  const short = await dp(mia, "/redeem", { method: "POST", body: { days: 1 } });
  assert.equal(short.status, 409);
  assert.equal(short.json.code, "INSUFFICIENT_DAY_PASSES");
  assert.equal(short.json.message, "Only 0.5 days left.");

  // Next day at 0: "no days left" wording.
  await M.DayPassAccount.updateOne({ contactId: mia._id }, { $set: { lastLowBalanceEmailAt: new Date(Date.now() - 86400000) } });
  const zero = await dp(mia, "/redeem", { method: "POST", body: { days: 0.5 } });
  assert.equal(zero.json.data.balance, 0);
  assert.equal(zero.json.data.lowBalanceEmailSent, true);
  assert.match(sentMail.at(-1), /Subject: Your Banyan day pass has no days left/);

  // Balance email button.
  const mail = await dp(mia, "/email-balance", { method: "POST", body: {} });
  assert.equal(mail.status, 200, JSON.stringify(mail.json));
  assert.ok(mail.json.data.sentAt);
  assert.match(sentMail.at(-1), /Subject: Your Banyan day pass balance/);
  assert.match(textOf(sentMail.at(-1)), /You have 0 days left on your Banyan Workspace day pass\. Your last visit was on \d{1,2} Nov\. See you soon!/);
  assert.equal((await dp(noMail, "/email-balance", { method: "POST", body: {} })).json.code, "NO_EMAIL");
  assert.ok(await M.Activity.exists({ contactId: mia._id, type: "email", subject: "Your Banyan day pass balance" }));
  assert.ok(await M.Activity.exists({ contactId: mia._id, type: "email", subject: "Your Banyan day pass is running low" }));

  const detail = await dp(mia);
  assert.equal(detail.json.data.balance, 0);
  assert.equal(detail.json.data.entries[0].type, "redeem", "newest first");
  assert.equal(detail.json.data.entries.length, 10);
  assert.ok(detail.json.data.lastBalanceEmailAt && detail.json.data.lastLowBalanceEmailAt);

  // TEST contacts never get the automatic email; a Gmail failure never fails the redeem.
  await dp(test, "/purchase", { method: "POST", body: { days: 3 } });
  const t = await dp(test, "/redeem", { method: "POST", body: { days: 1 } });
  assert.equal(t.status, 201);
  assert.deepEqual([t.json.data.lowBalanceEmailSent, t.json.data.lowBalanceEmail.status], [false, "skipped"]);
  await dp(noMail, "/purchase", { method: "POST", body: { days: 6 } });
  const ned = await M.Contact.findByIdAndUpdate(noMail._id, { $set: { email: "ned@desk.test" } }, { new: true });
  gmailFails = true;
  try {
    const f = await dp(ned, "/redeem", { method: "POST", body: { days: 1 } });
    assert.equal(f.status, 201, JSON.stringify(f.json));
    assert.deepEqual([f.json.data.balance, f.json.data.lowBalanceEmailSent, f.json.data.lowBalanceEmail.status], [5, false, "failed"]);
  } finally {
    gmailFails = false;
  }

  // Front desk list: lowest balance first; low=true; search; archived left out.
  const archived = await M.Contact.create({ workspaceId: ids.wsId, firstName: "Old", email: "old@desk.test", ownerId: ids.admin, isArchived: true });
  await dp(archived, "/purchase", { method: "POST", body: { days: 1 } });
  const list = await api("/day-passes");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.deepEqual(list.json.data.items.map((i) => [i.contact.firstName, i.balance]), [["Mia", 0], ["TEST", 2], ["Ned", 5]]);
  assert.equal(list.json.data.pagination.total, 3);
  assert.ok(list.json.data.items[0].lastUsedAt && list.json.data.items[0].lastBalanceEmailAt);
  assert.deepEqual((await api("/day-passes?search=ned")).json.data.items.map((i) => i.contact.firstName), ["Ned"]);
  await dp(test, "/purchase", { method: "POST", body: { days: 10 } });
  assert.deepEqual((await api("/day-passes?low=true")).json.data.items.map((i) => i.contact.firstName), ["Mia", "Ned"]);
});

test("§3 day passes: two redeems at once can't overdraw", { skip }, async () => {
  const c = await M.Contact.create({ workspaceId: ids.wsId, firstName: "TEST", lastName: "Race", ownerId: ids.admin });
  await api(`/contacts/${c._id}/day-passes/purchase`, { method: "POST", body: { days: 1 } });
  const results = await Promise.all([0, 1, 2].map(() => api(`/contacts/${c._id}/day-passes/redeem`, { method: "POST", body: { days: 0.5 } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 201, 409]);
  assert.equal((await api(`/contacts/${c._id}/day-passes`)).json.data.balance, 0);
});
