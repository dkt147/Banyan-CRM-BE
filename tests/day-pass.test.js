/*
 * Website day passes (Stripe Payment Links) → CRM purchases, and room-booking cancel via WordPress.
 * Needs a throwaway MongoDB whose name contains "test":
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/banyan_daypass_test node --test tests/day-pass.test.js
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const SECRET = "whsec_test_daypass";
process.env.JWT_ACCESS_SECRET ||= "dp-test-access";
process.env.JWT_REFRESH_SECRET ||= "dp-test-refresh";
process.env.MONGODB_URI ||= process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:1/unused";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
process.env.STRIPE_PAYMENT_LINK_PRODUCTS = JSON.stringify({ plink_half: "half_day_pass", plink_day: "day_pass", plink_ten: "day_pass_10" });
process.env.PUBLIC_ENQUIRY_WORKSPACE_ID = "";
process.env.PUBLIC_ENQUIRY_WORKSPACE_SLUG = "daypass-test";
process.env.BANYAN_CRM_TOKEN = "dp-wp-token";
process.env.BANYAN_WP_API_URL = "https://wp.test/wp-json/banyan/v1/";
process.env.BANYAN_BOOKING_SYNC_MINUTES = "0";

const { productForLink } = await import("../src/services/dayPassPurchase.service.js");

test("payment link map: only configured links are day passes", () => {
  assert.deepEqual(productForLink("plink_ten"), { key: "day_pass_10", label: "10-Day Package", productType: "day_pass_package" });
  assert.equal(productForLink("plink_other"), null);
  assert.equal(productForLink(null), null);
});

/* fake WordPress without the cancel endpoint yet */
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  if (url.hostname !== "wp.test") return realFetch(input, init);
  return new Response(JSON.stringify({ code: "rest_no_route", message: "No route was found matching the URL and request method." }), { status: 404, headers: { "Content-Type": "application/json" } });
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
  for (const n of ["User", "Workspace", "Contact", "Deal", "Pipeline", "PipelineStage", "Activity", "WebhookEvent"]) M[n] = (await import(`../src/models/${n}.js`))[n];
  for (const n of ["Deal", "WebhookEvent"]) await M[n].createIndexes();
  const wsId = new mongoose.Types.ObjectId();
  const admin = await M.User.create({ workspaceId: wsId, name: "Felicia", email: "f@dp.test", passwordHash: "x", role: "admin" });
  const op = await M.User.create({ workspaceId: wsId, name: "Op", email: "op@dp.test", passwordHash: "x", role: "operator" });
  await M.Workspace.create({ _id: wsId, name: "Banyan", slug: "daypass-test", createdBy: admin._id });
  const p = await M.Pipeline.create({ workspaceId: wsId, name: "Transactional", key: "transactional", ownerId: admin._id });
  for (const [i, name] of ["Booking Received", "Confirmed", "Completed"].entries())
    await M.PipelineStage.create({ workspaceId: wsId, pipelineId: p._id, name, key: name.toLowerCase().replace(/ /g, "-"), sortOrder: i });
  Object.assign(ids, { wsId, pipeline: p._id });
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

let seq = 0;
async function stripe(type, object, { id = `evt_${++seq}`, created = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify({ id, type, created, livemode: object.livemode ?? false, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");
  const res = await realFetch(`${base}/webhooks/stripe`, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${sig}` }, body: raw });
  return { status: res.status, json: await res.json() };
}
const session = (o = {}) => ({
  id: "cs_test_half1", object: "checkout.session", payment_link: "plink_half", payment_status: "paid", livemode: false,
  amount_total: 15000, currency: "hkd", payment_intent: "pi_half1",
  customer_details: { email: "Jane.Chan@Example.com", name: "Jane Mei Chan", phone: "+852 9123 4567" }, ...o,
});
const api = async (path, { method = "GET", body, as = "admin" } = {}) => {
  const res = await realFetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${tokens[as]}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};

test("unknown payment links and unpaid checkouts create nothing", { skip }, async () => {
  const other = await stripe("checkout.session.completed", session({ id: "cs_x", payment_link: "plink_other" }));
  assert.equal(other.status, 200, JSON.stringify(other.json));
  assert.equal(other.json.data.reason, "unknown_payment_link");
  const pending = await stripe("checkout.session.completed", session({ id: "cs_pending", payment_status: "unpaid" }));
  assert.equal(pending.json.data.pending, true);
  assert.equal(await M.Deal.countDocuments(), 0);
  assert.equal((await M.WebhookEvent.findOne({ "payload.data.object.id": "cs_x" })).status, "ignored");
});

test("test-mode Half Day Pass: contact + won day_pass deal, idempotent, kept out of reports", { skip }, async () => {
  const r = await stripe("checkout.session.completed", session(), { id: "evt_half_completed" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.created, true);
  const deal = await M.Deal.findOne({ "metadata.stripeCheckoutSessionId": "cs_test_half1" }).populate("stageId");
  assert.equal(deal.title, "Half Day Pass – Jane Mei Chan");
  assert.equal(deal.productType, "day_pass");
  assert.equal(deal.status, "won");
  assert.equal(deal.value, 150);
  assert.equal(deal.stageId.key, "confirmed");
  assert.ok(deal.closedAt);
  assert.equal(deal.metadata.isTest, true);
  assert.equal(deal.metadata.stripePaymentIntentId, "pi_half1");
  const contact = await M.Contact.findById(deal.contactId);
  assert.equal(contact.email, "jane.chan@example.com");
  assert.deepEqual([contact.firstName, contact.lastName], ["Jane", "Mei Chan"]);
  assert.ok(contact.tags.includes("test_booking"));
  assert.equal(await M.Activity.countDocuments({ dealId: deal._id }), 0, "no timeline entry for test purchases");

  // Same event again, another event for the same session, and payment_intent.succeeded: still one deal.
  assert.equal((await stripe("checkout.session.completed", session(), { id: "evt_half_completed" })).json.data.duplicate, true);
  assert.equal((await stripe("checkout.session.async_payment_succeeded", session())).json.data.created, false);
  const pi = await stripe("payment_intent.succeeded", { id: "pi_half1", object: "payment_intent", livemode: false });
  assert.equal(pi.json.data.created, false);
  assert.equal(await M.Deal.countDocuments({ "metadata.stripeCheckoutSessionId": "cs_test_half1" }), 1);

  const rel = await api(`/related/contact/${contact._id}`);
  assert.ok(rel.json.data.sections.bookings.items.some((i) => i.id === `deal-${deal._id}` && i.kind === "purchase"));
});

test("live 10-Day Package: day_pass_package, timeline entry, counted in reports; full refund → lost", { skip }, async () => {
  const r = await stripe("checkout.session.completed", session({ id: "cs_live_ten", payment_link: "plink_ten", livemode: true, amount_total: 218800, payment_intent: "pi_ten", customer_details: { email: "bob@example.com", name: "Bob" } }));
  assert.equal(r.json.data.created, true);
  const deal = await M.Deal.findOne({ "metadata.stripeCheckoutSessionId": "cs_live_ten" });
  assert.equal(deal.productType, "day_pass_package");
  assert.equal(deal.value, 2188);
  assert.equal(deal.metadata.isTest, undefined);
  assert.ok((await M.Contact.findById(deal.contactId)).tags.includes("website_booking"));
  const act = await M.Activity.findOne({ dealId: deal._id });
  assert.equal(act.subject, "Bought a 10-Day Package (HK$2,188) on the website");

  const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  const rep = await api(`/reports/periodic?from=${month}&to=${month}`);
  assert.equal(rep.json.data.periods[0].dayPasses, 1, "the test-mode half day pass is excluded");
  assert.equal(rep.json.data.periods[0].dealsWonValue, 2188);

  const partial = await stripe("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_ten", amount: 218800, amount_refunded: 50000, refunded: false, livemode: true });
  assert.equal(partial.json.data.full, false);
  assert.equal((await M.Deal.findById(deal._id)).status, "won");
  const full = await stripe("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_ten", amount: 218800, amount_refunded: 218800, refunded: true, livemode: true });
  assert.equal(full.json.data.full, true);
  const lost = await M.Deal.findById(deal._id);
  assert.equal(lost.status, "lost");
  assert.equal(lost.lostReason, "Refunded in Stripe");
  assert.equal((await api(`/reports/periodic?from=${month}&to=${month}`)).json.data.periods[0].dayPasses, 0);
});

test("room booking cancel: refund needs admin; clear 501 until WordPress has the endpoint", { skip }, async () => {
  assert.equal((await api("/room-bookings/BNY-ABC123/cancel", { method: "POST", as: "op", body: { refund: true } })).status, 403);
  const r = await api("/room-bookings/BNY-ABC123/cancel", { method: "POST", body: { refund: true, reason: "Moved" } });
  assert.equal(r.status, 501, JSON.stringify(r.json));
  assert.equal(r.json.code, "WP_CANCEL_UNSUPPORTED");
  assert.equal((await api("/room-bookings/bad/cancel", { method: "POST", body: {} })).status, 400);
});
