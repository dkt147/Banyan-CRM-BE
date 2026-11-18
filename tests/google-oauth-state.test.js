/*
 * Google OAuth state: signed and self-contained (no memory, no cookies), 20-minute expiry,
 * clear reasons on failure, and callback errors sent back to the CRM page instead of JSON.
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/banyan_oauth_test node --test tests/google-oauth-state.test.js
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.JWT_ACCESS_SECRET ||= "oauth-test-access";
process.env.JWT_REFRESH_SECRET ||= "oauth-test-refresh";
process.env.MONGODB_URI ||= process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:1/unused";
process.env.NODE_ENV = "development";
process.env.PUBLIC_API_URL = "";
process.env.PORT = "5000";
process.env.CLIENT_URL = "https://crm.example.test";
process.env.GOOGLE_CLIENT_ID = "cid";
process.env.GOOGLE_CLIENT_SECRET = "csecret";
process.env.INTEGRATION_OAUTH_STATE_SECRET = "state-secret-new";
process.env.INTEGRATION_OAUTH_STATE_SECRET_PREVIOUS = "state-secret-old";
process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");

const TEST_URI = process.env.TEST_MONGODB_URI;
const skip = !TEST_URI ? "TEST_MONGODB_URI not set" : !/test/i.test(new URL(TEST_URI).pathname) ? "database name must contain 'test'" : false;
let mongoose, jwt, server, base, token, user;

const realFetch = globalThis.fetch;
const google = { exchanges: 0 };
globalThis.fetch = async (input, init) => {
  const url = String(input?.url || input);
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    google.exchanges++;
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
};

before(async () => {
  if (skip) return;
  process.env.MONGODB_URI = TEST_URI;
  mongoose = (await import("mongoose")).default;
  jwt = (await import("jsonwebtoken")).default;
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  const app = (await import("../src/app.js")).default;
  const { User } = await import("../src/models/User.js");
  const { Workspace } = await import("../src/models/Workspace.js");
  const { signAccessToken } = await import("../src/utils/tokens.js");
  const ws = new mongoose.Types.ObjectId();
  user = await User.create({ workspaceId: ws, name: "Admin", email: "admin@oauth.test", passwordHash: "x", role: "admin" });
  await Workspace.create({ _id: ws, name: "W", slug: "oauth-test", createdBy: user._id });
  token = signAccessToken(user);
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

const connect = async () => {
  const r = await realFetch(`${base}/integrations/google/connect`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  return { state: new URL(j.data.authorizationUrl).searchParams.get("state"), data: j.data };
};
const callback = async (query) => {
  const r = await realFetch(`${base}/integrations/google/callback?${new URLSearchParams(query)}`, { redirect: "manual" });
  return { status: r.status, location: r.headers.get("location") ? new URL(r.headers.get("location")) : null };
};
const signState = (secret, extra = {}) =>
  jwt.sign({ type: "integration_state", provider: "google", sub: String(user._id), workspaceId: String(user.workspaceId), ...extra }, secret, {
    expiresIn: 1200, audience: "banyan-provider-integration", issuer: "banyan-crm",
  });

test("fresh state passes (reaches Google's code exchange); two Connect clicks are both valid", { skip }, async () => {
  const first = await connect();
  const second = await connect();
  assert.equal(first.data.expiresInSeconds, 1200);
  for (const { state } of [first, second]) {
    const before = google.exchanges;
    const r = await callback({ code: "dummy", state });
    assert.equal(google.exchanges, before + 1, "state accepted, code exchanged");
    assert.equal(r.status, 302);
    assert.equal(r.location.origin + r.location.pathname, "https://crm.example.test/integrations");
    assert.equal(r.location.searchParams.get("google_oauth"), "error");
    assert.equal(r.location.searchParams.get("google_oauth_code"), "GOOGLE_OAUTH_FAILED");
  }
});

test("state signed with the previous secret still works; unknown secret gives a clear reason", { skip }, async () => {
  const before = google.exchanges;
  await callback({ code: "dummy", state: signState("state-secret-old") });
  assert.equal(google.exchanges, before + 1);

  const bad = await callback({ code: "dummy", state: signState("some-other-server") });
  assert.equal(google.exchanges, before + 1, "no exchange with a bad state");
  assert.equal(bad.location.searchParams.get("google_oauth_code"), "INVALID_OAUTH_STATE");
  assert.match(bad.location.searchParams.get("google_oauth_message"), /different server/);
});

test("expired state and Google's cancel both return to the CRM with a message", { skip }, async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = jwt.sign(
    { type: "integration_state", provider: "google", sub: String(user._id), workspaceId: String(user.workspaceId), iat: now - 3000, exp: now - 1800 },
    "state-secret-new",
    { audience: "banyan-provider-integration", issuer: "banyan-crm" },
  );
  const expired = await callback({ code: "dummy", state: old });
  assert.equal(expired.location.searchParams.get("google_oauth_code"), "INVALID_OAUTH_STATE");
  assert.match(expired.location.searchParams.get("google_oauth_message"), /expired/);

  const cancelled = await callback({ error: "access_denied" });
  assert.equal(cancelled.location.searchParams.get("google_oauth"), "error");
  assert.match(cancelled.location.searchParams.get("google_oauth_message"), /cancelled or denied/);
});
