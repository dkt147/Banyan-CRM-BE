/*
 * Roles, permissions, audit log, rate limits, registration switch and Hong Kong month
 * boundaries (brief section 7 and decisions of 2026-11-10).
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27999/banyan_permissions_test npm test
 * The database name must contain "test"; it is dropped before and after the run.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

const RAW = process.env.TEST_MONGODB_URI;
const TEST_URI = RAW ? RAW.replace(/\/[^/?]*(\?|$)/, "/banyan_permissions_test$1") : null;
const skip = !TEST_URI ? "TEST_MONGODB_URI not set" : false;

let mongoose, server, base, models = {}, tokens = {}, ids = {};
async function api(path, { method = "GET", body, as = "admin", headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}

before(async () => {
  if (skip) return;
  process.env.MONGODB_URI = TEST_URI;
  process.env.JWT_ACCESS_SECRET ||= "perm-test-access";
  process.env.JWT_REFRESH_SECRET ||= "perm-test-refresh";
  process.env.NODE_ENV = "production"; // registration must be disabled
  delete process.env.ALLOW_PUBLIC_REGISTRATION;
  mongoose = (await import("mongoose")).default;
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  const app = (await import("../src/app.js")).default;
  const { signAccessToken } = await import("../src/utils/tokens.js");
  for (const name of ["User", "Workspace", "Contact", "AuditLog", "Pipeline", "PipelineStage"])
    models[name] = (await import(`../src/models/${name}.js`))[name];
  const bcrypt = (await import("bcryptjs")).default;
  const { User, Workspace, Contact } = models;
  const wsId = new mongoose.Types.ObjectId();
  const passwordHash = await bcrypt.hash("Correct-Pass-1", 4);
  for (const role of ["admin", "manager", "operator", "read_only"])
    ids[role] = await User.create({ workspaceId: wsId, name: `${role} user`, email: `${role}@perm.test`, passwordHash, role });
  await Workspace.create({ _id: wsId, name: "Perm", slug: "perm-test", createdBy: ids.admin._id });
  ids.contact = await Contact.create({ workspaceId: wsId, firstName: "Ann", lastName: "Lee", ownerId: ids.admin._id });
  ids.wsId = wsId;
  for (const role of Object.keys(tokens).length ? [] : ["admin", "manager", "operator", "read_only"]) tokens[role] = signAccessToken(ids[role]);
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

test("Read-only can view but cannot create, edit or delete", { skip }, async () => {
  assert.equal((await api("/contacts", { as: "read_only" })).status, 200);
  assert.equal((await api(`/contacts/${ids.contact._id}`, { as: "read_only" })).status, 200);
  assert.equal((await api("/tasks", { as: "read_only" })).status, 200);
  const create = await api("/contacts", { as: "read_only", method: "POST", body: { firstName: "X" } });
  assert.equal(create.status, 403);
  assert.equal(create.json.code, "READ_ONLY");
  assert.equal((await api(`/contacts/${ids.contact._id}`, { as: "read_only", method: "PATCH", body: { lastName: "Z" } })).status, 403);
  assert.equal((await api(`/contacts/${ids.contact._id}`, { as: "read_only", method: "DELETE" })).status, 403);
  assert.equal((await api("/calendar/hold", { as: "read_only", method: "POST", body: {} })).status, 403);
  // Allowed: own profile (saved views) and notifications.
  assert.equal((await api("/auth/profile", { as: "read_only", method: "PATCH", body: { preferences: { savedViews: {} } } })).status, 200);
  assert.equal((await api("/notifications/read-all", { as: "read_only", method: "PATCH" })).status, 200);
  // No access to workflows or templates.
  assert.equal((await api("/automations", { as: "read_only" })).status, 403);
  assert.equal((await api("/templates", { as: "read_only" })).status, 403);
});

test("Sales (manager and operator) edit records but not admin-only areas", { skip }, async () => {
  for (const role of ["manager", "operator"]) {
    assert.equal((await api(`/contacts/${ids.contact._id}`, { as: role, method: "PATCH", body: { jobTitle: role } })).status, 200);
    assert.equal((await api("/automations", { as: role })).status, 200, "Sales can view workflows");
    assert.equal((await api("/automations", { as: role, method: "POST", body: { name: "x", trigger: "deal_created", actions: [] } })).status, 403);
    assert.equal((await api("/templates", { as: role })).status, 200, "Sales can use templates");
    assert.equal((await api("/templates", { as: role, method: "POST", body: { name: "t" } })).status, 403);
    assert.equal((await api("/resources", { as: role, method: "POST", body: { name: `Room ${role}` } })).status, 403);
    assert.equal((await api("/members", { as: role, method: "POST", body: { name: "Evil", email: `evil-${role}@perm.test`, password: "Passw0rd!x", role: "admin" } })).status, 403, "no privilege escalation");
    assert.equal((await api(`/members/${ids.admin._id}`, { as: role, method: "PATCH", body: { role: "operator" } })).status, 403);
  }
});

test("Admin manages users and roles; changes are audited; last admin is protected", { skip }, async () => {
  const room = await api("/resources", { method: "POST", body: { name: "Harbour Room", pricePerHourMinor: 30000 } });
  assert.equal(room.status, 201);
  const created = await api("/members", { method: "POST", body: { name: "New Sales", email: "new@perm.test", password: "Passw0rd!x", role: "operator" } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const ro = await api(`/members/${created.json.data._id}`, { method: "PATCH", body: { role: "read_only" } });
  assert.equal(ro.status, 200);
  assert.equal((await api(`/members/${created.json.data._id}`, { method: "PATCH", body: { role: "superuser" } })).status, 400);
  const lastAdmin = await api(`/members/${ids.admin._id}`, { method: "PATCH", body: { role: "operator" } });
  assert.equal(lastAdmin.status, 409);
  assert.equal(lastAdmin.json.code, "LAST_ADMIN");
  assert.equal((await api(`/members/${ids.admin._id}`, { method: "DELETE" })).status, 409);
  await new Promise((r) => setTimeout(r, 100));
  const actions = (await models.AuditLog.find({ workspaceId: ids.wsId }).lean()).map((a) => a.action);
  for (const action of ["resource.created", "user.created", "user.role_changed"]) assert.ok(actions.includes(action), `${action} audited (${actions})`);
  const change = await models.AuditLog.findOne({ action: "user.role_changed" }).lean();
  assert.deepEqual([change.before.role, change.after.role], ["operator", "read_only"]);
  assert.equal(String(change.actorId), String(ids.admin._id));
});

test("Public registration is disabled in production", { skip }, async () => {
  const r = await api("/auth/register", { as: null, method: "POST", body: { name: "Anyone", email: "anyone@perm.test", password: "Passw0rd!x", workspaceName: "Mine" } });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "REGISTRATION_DISABLED");
});

test("Rate limits: per user (not per IP), failed logins limited, success not counted", { skip }, async () => {
  // 320 quick requests from one IP split across two users stay under each user's limit.
  const results = [];
  for (let batch = 0; batch < 8; batch++)
    results.push(...await Promise.all(Array.from({ length: 40 }, (_, i) => api("/notifications", { as: i % 2 ? "operator" : "manager" }))));
  assert.ok(results.every((r) => r.status === 200), "a shared office IP is not throttled");
  assert.ok(results[0].headers.get("ratelimit-policy") || results[0].headers.get("ratelimit"), "standard RateLimit headers present");
  for (let i = 0; i < 12; i++) await api("/auth/login", { as: null, method: "POST", body: { email: "manager@perm.test", password: "Correct-Pass-1" } });
  const ok = await api("/auth/login", { as: null, method: "POST", body: { email: "manager@perm.test", password: "Correct-Pass-1" } });
  assert.equal(ok.status, 200, "successful logins are not counted");
  let last;
  for (let i = 0; i < 11; i++) last = await api("/auth/login", { as: null, method: "POST", body: { email: "operator@perm.test", password: "wrong" } });
  assert.equal(last.status, 429);
  assert.equal(last.json.code, "LOGIN_RATE_LIMITED");
});

test("Hong Kong month boundaries", { skip }, async () => {
  const { hkMonthRange, allDayToHk } = await import("../src/utils/hkTime.js");
  // 2026-11-30T17:00Z is already 1 December in Hong Kong.
  const { start, end } = hkMonthRange(new Date("2026-11-30T17:00:00Z"));
  assert.equal(start.toISOString(), "2026-11-30T16:00:00.000Z");
  assert.equal(end.toISOString(), "2026-12-31T16:00:00.000Z");
  assert.equal(new Date(allDayToHk("2026-11-10")).toISOString(), "2026-11-09T16:00:00.000Z");
});
