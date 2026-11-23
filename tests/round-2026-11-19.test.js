/*
 * Client meeting round (19 Nov 2026): login refresh token, forms (design, mappings, public definition,
 * website pages), Flodesk, report breakdowns, meeting room credits, company loyalty tiers.
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017/banyan_round19_test node --test tests/round-2026-11-19.test.js
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_ACCESS_SECRET ||= "r19-access";
process.env.JWT_REFRESH_SECRET ||= "r19-refresh";
process.env.MONGODB_URI ||= process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:1/unused";
process.env.PUBLIC_ENQUIRY_WORKSPACE_ID = "";
process.env.PUBLIC_ENQUIRY_WORKSPACE_SLUG = "round19-test";
process.env.BANYAN_CRM_TOKEN = "r19-wp-token";
process.env.BANYAN_WP_API_URL = "https://wp.test/wp-json/banyan/v1/";
process.env.BANYAN_BOOKING_SYNC_MINUTES = "0";
process.env.FLODESK_API_KEY = "fd-test-key";
process.env.FLODESK_RETRY_BASE_MS = "5";
process.env.PUBLIC_API_URL = "https://api.example.test";
process.env.PUBLIC_WEBSITE_URL = "https://banyanworkspace.com";

const { segmentNamesFor, flodeskConsent } = await import("../src/services/flodesk.service.js");
const { leadSourceKey, enquiryKey, buildPeriods } = await import("../src/services/reportsBreakdown.service.js");

/* ---------- unit ---------- */
test("flodesk: interests map to segments, consent rules", () => {
  assert.deepEqual(segmentNamesFor(["Coworking Desks", "Flexible Day Pass"]), ["Coworking [Automated]"]);
  assert.deepEqual(segmentNamesFor(["Virtual Office", "Meeting Rooms"]), ["Misc Products (Virtual Office) [Automated]", "No Product [Automated]"]);
  assert.deepEqual(segmentNamesFor([]), ["No Product [Automated]"]);
  const optForm = { fields: [{ key: "news", label: "Newsletter?", mapTo: "newsletterOptIn" }], consentText: "I agree" };
  assert.equal(flodeskConsent(optForm, { values: { news: "YES" } }).ok, true);
  assert.equal(flodeskConsent(optForm, { values: { news: "No" }, consent: true }).ok, false, "the newsletter question decides");
  assert.equal(flodeskConsent({ fields: [], consentText: "x" }, { consent: true }).ok, true);
  assert.equal(flodeskConsent({ fields: [] }, { consent: true }).ok, false);
});

test("room calendar: Stripe test-mode bookings are labelled TEST", async () => {
  const { eventBodyFor } = await import("../src/services/roomCalendar.service.js");
  const b = (mode, status = "paid") => ({
    startAt: new Date("2026-12-03T02:00:00Z"), endAt: new Date("2026-12-03T04:00:00Z"),
    metadata: { wp: { ref: "BNY-T1", status, roomName: "The Library", customer: { firstName: "QA Test", lastName: "Alice", email: "qa@example.com" }, payment: { mode } } },
  });
  const test = eventBodyFor(b("test"));
  assert.equal(test.summary, "TEST – The Library – QA Test Alice (BNY-T1)");
  assert.equal(test.description.split(/\n/)[0], "Stripe TEST mode – not a real booking.");
  assert.equal(eventBodyFor(b("test", "pending")).summary, "TEST – Awaiting payment – The Library – QA Test Alice (BNY-T1)");
  const live = eventBodyFor(b("live"));
  assert.equal(live.summary, "The Library – QA Test Alice (BNY-T1)");
  assert.ok(!live.description.includes("TEST"));
});

test("reports: lead source and enquiry keys, week periods start Monday", () => {
  assert.equal(leadSourceKey("Instagram"), "social");
  assert.equal(leadSourceKey("website"), "website");
  assert.equal(leadSourceKey("form"), "website");
  assert.equal(leadSourceKey("A friend told me"), "referral");
  assert.equal(leadSourceKey("Walk-in"), "walk_in");
  assert.equal(leadSourceKey(""), "unknown");
  assert.equal(leadSourceKey("Carrier pigeon"), "other");
  assert.equal(enquiryKey("Serviced Offices"), "serviced_offices");
  assert.equal(enquiryKey("Something new"), "other");
  const w = buildPeriods("week", "2026-11-19", "2026-11-30");
  assert.deepEqual(w.periods.map((p) => p.key), ["2026-11-16", "2026-11-23", "2026-11-30"]);
  assert.equal(w.periods[0].to, "2026-11-22");
  assert.equal(w.range.$gte.toISOString(), "2026-11-15T16:00:00.000Z", "Monday 00:00 Hong Kong");
  assert.equal(w.keyOf(new Date("2026-11-22T15:59:00Z")), "2026-11-16", "Sunday 23:59 HK is still that week");
  assert.equal(w.keyOf(new Date("2026-11-22T16:00:00Z")), "2026-11-23");
  assert.throws(() => buildPeriods("week", "2026-01-01", "2027-06-01"), /At most 53 weeks/);
  assert.throws(() => buildPeriods("month", "2026-01-01", "2029-02-01"), /At most 36 months/);
});

/* ---------- fakes: WordPress + Flodesk ---------- */
const realFetch = globalThis.fetch;
const wp = { pages: new Map(), takenPaths: new Set(["about"]), pageSeq: 100, bookings: new Map(), creditRequests: [], creditClash: false, noPages: false };
const fd = { subscribers: new Map(), segmentAdds: [], fail429: 0, requests: 0 };
const SEGMENTS = ["Coworking [Automated]", "Serviced Office [Automated]", "Event Space / Venue Hire [Automated]", "No Product [Automated]"].map((name, i) => ({ id: `seg${i}`, name }));
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const hh = (n) => `${String(n).padStart(2, "0")}:00`;

function wpBooking(ref, b, status = "paid", extra = {}) {
  const start = Number(String(b.start).split(":")[0]);
  return {
    booking: {
      ref, status, channel: "admin", room_key: b.room, room_name: "Meeting Room (5 to 6 people)", date: b.date,
      start_time: hh(start), end_time: hh(start + b.hours), hours: b.hours,
      start_iso: `${b.date}T${hh(start)}:00+08:00`, end_iso: `${b.date}T${hh(start + b.hours)}:00+08:00`,
      created_at: new Date().toISOString(), ...extra.booking,
    },
    customer: { first_name: b.first_name, last_name: b.last_name, email: b.email, phone: b.phone, notes: b.notes },
    payment: { method: "credits", amount: 0, currency: "HKD", mode: "test", status: "paid", credit_ref: b.credit_ref, paid_at: new Date().toISOString() },
  };
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url || String(input));
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  if (url.hostname === "api.flodesk.com") {
    fd.requests++;
    assert.equal(new Headers(init.headers).get("authorization"), `Basic ${Buffer.from("fd-test-key:").toString("base64")}`);
    if (fd.fail429 > 0) { fd.fail429--; return json(429, { message: "Too many requests" }); }
    const p = url.pathname.replace("/v1/", "");
    if (p === "segments") return json(200, { meta: { page: 1, total_pages: 1 }, data: SEGMENTS });
    if (p === "subscribers" && method === "POST") { fd.subscribers.set(body.email, body); return json(200, { id: "sub1", email: body.email }); }
    const seg = p.match(/^subscribers\/(.+)\/segments$/);
    if (seg && method === "POST") { fd.segmentAdds.push({ email: decodeURIComponent(seg[1]), ids: body.segment_ids }); return json(200, {}); }
    return json(404, { message: "not found" });
  }
  if (url.hostname !== "wp.test") return realFetch(input, init);
  assert.equal(new Headers(init.headers).get("x-banyan-token"), "r19-wp-token");
  const p = url.pathname.replace("/wp-json/banyan/v1/", "");
  if (p === "crm-pages" && method === "POST") {
    if (wp.noPages) return json(404, { code: "rest_no_route", message: "No route" });
    if (wp.takenPaths.has(body.path)) return json(409, { message: `The address /${body.path}/ is used by another page.` });
    const id = body.wp_page_id ?? ++wp.pageSeq;
    wp.pages.set(id, body);
    return json(200, { id, url: `https://banyanworkspace.com/${body.path}/`, status: "publish" });
  }
  const del = p.match(/^crm-pages\/(\d+)$/);
  if (del && method === "DELETE") return wp.pages.delete(Number(del[1])) ? json(200, { id: Number(del[1]), status: "trash" }) : json(404, { message: "Not found" });
  if (p === "bookings/credit" && method === "POST") {
    wp.creditRequests.push(body);
    if (wp.creditClash) return json(409, { message: "Sorry, that time is already booked." });
    const ref = `BNY-CR${String(wp.creditRequests.length).padStart(4, "0")}`;
    const row = wpBooking(ref, body);
    wp.bookings.set(ref, row);
    return json(201, row);
  }
  const cancel = p.match(/^bookings\/(BNY-[A-Z0-9]+)\/cancel$/);
  if (cancel && method === "POST") {
    const row = wp.bookings.get(cancel[1]);
    if (!row) return json(404, { message: "Not found" });
    row.booking.status = "cancelled";
    row.booking.cancelled_by = body.by;
    row.booking.cancelled_at = new Date().toISOString();
    return json(200, { ref: cancel[1], status: "cancelled", refund: null });
  }
  if (p === "bookings" && method === "GET") return json(200, { bookings: [wp.bookings.get(url.searchParams.get("ref"))].filter(Boolean) });
  return json(404, { code: "rest_no_route", message: "No route" });
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
  const bcrypt = (await import("bcryptjs")).default;
  const { signAccessToken } = await import("../src/utils/tokens.js");
  for (const n of ["User", "Workspace", "Contact", "Company", "Deal", "Pipeline", "PipelineStage", "Invoice", "Booking", "Form", "FormSubmission", "CreditLedger", "LoyaltyTier", "RefreshToken"])
    M[n] = (await import(`../src/models/${n}.js`))[n];
  for (const n of ["Form", "CreditLedger", "LoyaltyTier", "RefreshToken", "Booking"]) await M[n].createIndexes();
  const wsId = new mongoose.Types.ObjectId();
  const admin = await M.User.create({ workspaceId: wsId, name: "Felicia", email: "felicia@r19.test", passwordHash: await bcrypt.hash("Secret123!", 4), role: "admin" });
  const op = await M.User.create({ workspaceId: wsId, name: "Op", email: "op@r19.test", passwordHash: "x", role: "operator" });
  await M.Workspace.create({ _id: wsId, name: "Banyan", slug: "round19-test", createdBy: admin._id });
  const company = await M.Company.create({ workspaceId: wsId, name: "Acme Ltd", ownerId: admin._id, meetingRoomCreditHours: 4 });
  const other = await M.Company.create({ workspaceId: wsId, name: "Beta Co", ownerId: admin._id });
  const contact = await M.Contact.create({ workspaceId: wsId, firstName: "Ann", lastName: "Acme", email: "ann@acme.test", companyId: company._id, ownerId: admin._id });
  const loner = await M.Contact.create({ workspaceId: wsId, firstName: "Lone", email: "lone@x.test", ownerId: admin._id });
  // Pipelines the website enquiry routing needs (walk-in form with a services field).
  for (const [key, name] of [["membership", "Membership"], ["private-office", "Private office"]]) {
    const p = await M.Pipeline.create({ workspaceId: wsId, name, key, ownerId: admin._id });
    await M.PipelineStage.create({ workspaceId: wsId, pipelineId: p._id, name: "New enquiry", key: "new-enquiry", sortOrder: 0 });
    ids[key] = p._id;
  }
  Object.assign(ids, { wsId, admin: admin._id, company: company._id, other: other._id, contact: contact._id, loner: loner._id });
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

const api = async (path, { method = "GET", body, as = "admin", headers = {} } = {}) => {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: { ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})), headers: res.headers };
};

test("§1 login and refresh return refreshToken; body token works; 30 s rotation grace", { skip }, async () => {
  const login = await api("/auth/login", { method: "POST", as: null, body: { email: "felicia@r19.test", password: "Secret123!" } });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const t1 = login.json.data.refreshToken;
  assert.ok(t1 && login.json.data.accessToken);

  const r1 = await api("/auth/refresh", { method: "POST", as: null, body: { refreshToken: t1 } });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  const t2 = r1.json.data.refreshToken;
  assert.notEqual(t2, t1);
  // Second tab, same old token, within 30 s: still gets a valid pair.
  const r2 = await api("/auth/refresh", { method: "POST", as: null, body: { refreshToken: t1 } });
  assert.equal(r2.status, 200, "grace");
  assert.equal((await api("/auth/refresh", { method: "POST", as: null, body: { refreshToken: r2.json.data.refreshToken } })).status, 200);
  // After the grace window the old token is refused.
  const { hashToken } = await import("../src/utils/tokens.js");
  await M.RefreshToken.updateOne({ tokenHash: hashToken(t1) }, { $set: { revokedAt: new Date(Date.now() - 60000) } });
  assert.equal((await api("/auth/refresh", { method: "POST", as: null, body: { refreshToken: t1 } })).status, 401);
  // A logged-out token gets no grace.
  await api("/auth/logout", { method: "POST", as: null, body: { refreshToken: t2 } });
  assert.equal((await api("/auth/refresh", { method: "POST", as: null, body: { refreshToken: t2 } })).status, 401);
});

const walkInForm = {
  name: "Walk-in visitor", slug: "walk-in", type: "walk_in",
  fields: [
    { key: "first_name", label: "First name", type: "text", mapTo: "firstName", required: true },
    { key: "email", label: "Email", type: "email", mapTo: "email", required: true },
    { key: "services", label: "Interested in", type: "checkboxes", mapTo: "interests", options: ["Coworking Desks", "Serviced Offices", "Meeting Rooms"] },
    { key: "heard", label: "How did you hear about us?", type: "select", mapTo: "source", options: ["Instagram", "Google", "Friend"] },
    { key: "news", label: "Join our newsletter?", type: "select", mapTo: "newsletterOptIn", options: ["Yes", "No"] },
  ],
  design: { title: "Welcome to Banyan Workspace", layout: "image-left", imageUrl: "https://banyanworkspace.com/a.jpg", colors: { button: "#2D5F4C" } },
  flodesk: { enabled: true },
  // A services field and no pipeline: walk-in enquiries are routed by service (several allowed, or none).
};

test("§2 forms: design + flodesk stored, validation, public definition", { skip }, async () => {
  const bad = await api("/forms", { method: "POST", body: { ...walkInForm, design: { colors: { button: "green" } } } });
  assert.equal(bad.status, 400);
  const badImg = await api("/forms", { method: "POST", body: { ...walkInForm, design: { imageUrl: "http://x.test/a.jpg" } } });
  assert.equal(badImg.status, 400);
  const r = await api("/forms", { method: "POST", body: walkInForm });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  ids.form = r.json.data._id;
  assert.equal(r.json.data.design.title, "Welcome to Banyan Workspace");
  assert.equal(r.json.data.flodesk.enabled, true);
  assert.equal(r.json.data.page, null);

  const def = await api("/public/forms/walk-in", { as: null });
  assert.equal(def.status, 200, JSON.stringify(def.json));
  assert.match(def.headers.get("cache-control"), /max-age=60/);
  const d = def.json.data;
  assert.equal(d.slug, "walk-in");
  assert.equal(d.submitUrl, "https://api.example.test/api/v1/public/forms/walk-in");
  assert.equal(d.publicKey, r.json.data.publicKey);
  assert.deepEqual(Object.keys(d.fields[0]).sort(), ["key", "label", "options", "required", "type"]);
  assert.equal(d.design.layout, "image-left");
  assert.equal((await api("/public/forms/nope", { as: null })).status, 404);
  const cat = await api("/contacts/tag-catalogue");
  assert.ok(["newsletter", "walk_in"].every((k) => cat.json.data.tags.some((t) => t.key === k)));
});

const submit = (body) =>
  realFetch(`${base}/public/forms/walk-in`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://banyanworkspace.com" }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, json: await r.json() }));
const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
};

test("§2/§3 walk-in submission: source, tags, newsletter consent, Flodesk segments (with 429 retry)", { skip }, async () => {
  const form = await M.Form.findById(ids.form);
  fd.fail429 = 2;
  const r = await submit({ publicKey: form.publicKey, first_name: "Wendy", email: "Wendy@Walk.test", services: ["Coworking Desks", "Serviced Offices"], heard: "Instagram", news: "Yes" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const c = await M.Contact.findOne({ email: "wendy@walk.test" });
  assert.equal(c.source, "Instagram", "new contact gets the answer");
  assert.ok(c.tags.includes("newsletter") && c.tags.includes("walk_in") && c.tags.includes("form_submission"));
  assert.ok(c.marketingConsentAt);
  const sub = await waitFor(() => M.FormSubmission.findOne({ formId: form._id, "flodesk.status": "added" }).lean());
  assert.ok(sub, "flodesk added");
  assert.deepEqual(sub.flodesk.segments.sort(), ["Coworking [Automated]", "Serviced Office [Automated]"]);
  assert.equal(sub.payload.source, "Instagram");
  assert.deepEqual(sub.payload.interests, ["Coworking Desks", "Serviced Offices"]);
  // Walk-in with two services: one enquiry, a deal in each service pipeline, no task (createTask off).
  const deals = await M.Deal.find({ contactId: c._id }).lean();
  assert.deepEqual(deals.map((d) => String(d.pipelineId)).sort(), [String(ids.membership), String(ids["private-office"])].sort());
  assert.ok(deals.every((d) => d.title.startsWith("Walk-in enquiry — Wendy")), deals.map((d) => d.title).join());
  const { Task } = await import("../src/models/Task.js");
  assert.equal(await Task.countDocuments({ contactId: c._id }), 0);
  assert.ok(!c.tags.includes("website_enquiry"));
  assert.equal(fd.subscribers.get("wendy@walk.test").first_name, "Wendy");
  assert.deepEqual(fd.segmentAdds.at(-1).ids.sort(), ["seg0", "seg1"]);

  // Existing contact keeps its first known source; "No" means no Flodesk.
  await M.Contact.updateOne({ _id: ids.loner }, { $set: { source: "website" } });
  // Walk-in with no service ticked: contact only, no deal.
  const lone = await submit({ publicKey: form.publicKey, first_name: "Lone", email: "lone@x.test", heard: "Google", news: "No" });
  assert.equal(lone.status, 201, JSON.stringify(lone.json));
  assert.equal(await M.Deal.countDocuments({ contactId: ids.loner }), 0);
  assert.equal((await M.FormSubmission.findOne({ formId: form._id, "payload.values.email": "lone@x.test" })).status, "processed");
  assert.equal((await M.Contact.findById(ids.loner)).source, "website");
  const skipped = await waitFor(() => M.FormSubmission.findOne({ formId: form._id, "flodesk.status": "skipped" }).lean());
  assert.match(skipped.flodesk.reason, /Answered "No"/);
  assert.ok(!(await M.Contact.findById(ids.loner)).tags.includes("newsletter"));

  const list = await api(`/forms/${ids.form}/submissions`);
  assert.ok(list.json.data.items.every((i) => i.flodesk && i.flodesk.status));

  const status = await api("/integrations/flodesk");
  assert.equal(status.status, 200, JSON.stringify(status.json));
  assert.equal(status.json.data.connected, true);
  assert.equal(status.json.data.mapping.find((m) => m.interest === "Virtual Office").found, false, "missing segment reported");
  assert.equal(status.json.data.mapping.find((m) => m.interest === "Coworking Desks").found, true);
  assert.ok(status.json.data.lastSuccessAt);
  assert.ok(!JSON.stringify(status.json).includes("fd-test-key"));
  assert.equal((await api("/integrations/flodesk", { as: "op" })).status, 403);
});

test("§2.3 website page: create, idempotent update, taken path, unsupported plugin, remove", { skip }, async () => {
  assert.equal((await api(`/forms/${ids.form}/page`, { method: "POST", as: "op", body: { path: "forms/walk-in" } })).status, 403);
  assert.equal((await api(`/forms/${ids.form}/page`, { method: "POST", body: { path: "Forms/Walk In" } })).status, 400);
  const r = await api(`/forms/${ids.form}/page`, { method: "POST", body: { path: "forms/walk-in" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.page.url, "https://banyanworkspace.com/forms/walk-in/");
  const id = r.json.data.page.wpPageId;
  assert.equal(wp.pages.get(id).title, "Welcome to Banyan Workspace");
  const again = await api(`/forms/${ids.form}/page`, { method: "POST", body: { path: "forms/reception" } });
  assert.equal(again.json.data.page.wpPageId, id, "updates the same page");
  assert.equal(wp.pages.get(id).wp_page_id, id);
  const taken = await api(`/forms/${ids.form}/page`, { method: "POST", body: { path: "about" } });
  assert.equal(taken.status, 409);
  assert.equal(taken.json.code, "PAGE_PATH_TAKEN");
  wp.noPages = true;
  assert.equal((await api(`/forms/${ids.form}/page`, { method: "POST", body: { path: "forms/x" } })).json.code, "WP_PAGES_UNSUPPORTED");
  wp.noPages = false;
  const del = await api(`/forms/${ids.form}/page`, { method: "DELETE" });
  assert.deepEqual(del.json.data, { removed: true });
  assert.equal((await M.Form.findById(ids.form)).page, null);
  await M.Form.updateOne({ _id: ids.form }, { $set: { isActive: false } });
  assert.equal((await api(`/forms/${ids.form}/page`, { method: "POST", body: { path: "forms/walk-in" } })).json.code, "FORM_INACTIVE");
  assert.equal((await api("/public/forms/walk-in", { as: null })).status, 404, "inactive form has no public definition");
  await M.Form.updateOne({ _id: ids.form }, { $set: { isActive: true } });
});

const day = (() => {
  // A weekday about two weeks ahead (Hong Kong date).
  const d = new Date(Date.now() + 14 * 86400000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const month = day.slice(0, 7);

test("§5 credits: allowance, credit booking, insufficient credits, clash, cancel refunds, adjust, overview", { skip }, async () => {
  assert.equal((await api(`/companies/${ids.company}`, { method: "PATCH", body: { meetingRoomCreditHours: 250 } })).status, 400);
  assert.equal((await api(`/companies/${ids.company}`, { method: "PATCH", body: { meetingRoomCreditHours: 4 } })).status, 200);

  const book = (body, as = "admin") => api("/room-bookings/credit-booking", { method: "POST", as, body: { room: "small", date: day, start: "10:00", hours: 3, contactId: String(ids.contact), notes: "TEST credit", ...body } });
  assert.equal((await book({ contactId: String(ids.loner) })).json.code, "CONTACT_HAS_NO_COMPANY");
  assert.equal((await book({ start: "17:00" })).status, 400, "past closing time");

  const r = await book({}, "op");
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const ref = r.json.data.booking.ref;
  assert.match(ref, /^BNY-CR/);
  assert.equal(r.json.data.booking.payment.method, "credits");
  assert.equal(r.json.data.booking.contact.id, String(ids.contact));
  assert.equal(r.json.data.credits.used, 3);
  assert.equal(r.json.data.credits.remaining, 1);
  const sent = wp.creditRequests.at(-1);
  assert.equal(sent.start, "10:00");
  assert.equal(sent.company, "Acme Ltd");
  assert.equal(sent.booked_by, "Op (CRM)");
  assert.match(sent.credit_ref, /^CR-/);
  assert.match(sent.notes, /^Booked via CRM by Op – TEST credit$/);

  const short = await book({ start: 14, hours: 2 });
  assert.equal(short.status, 409);
  assert.equal(short.json.code, "INSUFFICIENT_CREDITS");
  assert.equal(short.json.details.remaining, 1);

  wp.creditClash = true;
  const clash = await book({ hours: 1 });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.message, "Sorry, that time is already booked.");
  wp.creditClash = false;
  assert.equal(await M.CreditLedger.countDocuments({ type: "use" }), 1, "nothing used on a clash");

  const detail = await api(`/room-bookings/${ref}`);
  assert.ok(detail.json.data.timeline.some((t) => t.text === "Paid with 3 meeting room credits (test mode)"), JSON.stringify(detail.json.data.timeline));

  // Cancel in the CRM: WordPress frees the slot, the CRM gives the hours back (once).
  const cancel = await api(`/room-bookings/${ref}/cancel`, { method: "POST", body: { reason: "TEST" } });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  await api(`/room-bookings/${ref}/cancel`, { method: "POST", body: { reason: "TEST again" } });
  const credits = await api(`/companies/${ids.company}/credits?month=${month}`);
  assert.equal(credits.json.data.used, 0);
  assert.equal(credits.json.data.remaining, 4);
  assert.deepEqual(credits.json.data.entries.map((e) => e.type), ["use", "refund"]);
  assert.equal(credits.json.data.entries[0].bookingRef, ref);
  const after = await api(`/room-bookings/${ref}`);
  assert.ok(after.json.data.timeline.some((t) => t.text === "Meeting room credits returned (3 h)"));

  assert.equal((await api(`/companies/${ids.company}/credits/adjust`, { method: "POST", as: "op", body: { hours: 2, note: "x" } })).status, 403);
  assert.equal((await api(`/companies/${ids.company}/credits/adjust`, { method: "POST", body: { hours: 2 } })).json.code, "NOTE_REQUIRED");
  const adj = await api(`/companies/${ids.company}/credits/adjust`, { method: "POST", body: { hours: 2, note: "Goodwill", month } });
  assert.equal(adj.status, 201, JSON.stringify(adj.json));
  assert.equal(adj.json.data.remaining, 6);
  assert.equal(adj.json.data.adjustments, 2);

  const overview = await api(`/credits?month=${month}`);
  assert.deepEqual(overview.json.data.items.map((i) => [i.company.name, i.allowance, i.used, i.remaining]), [["Acme Ltd", 4, 0, 6]]);
  assert.equal((await api("/credits?month=2026-13")).status, 400);
});

test("§4 breakdowns: revenue (live only), lead sources, enquiry types; every period and category present", { skip }, async () => {
  const paidAt = new Date("2026-10-07T03:00:00Z");
  const B = (ref, mode, amount, method = "stripe") => ({
    workspaceId: ids.wsId, createdBy: ids.admin, externalRef: ref, title: ref, startAt: paidAt, endAt: paidAt, bookingType: "meeting_room", status: "confirmed",
    metadata: { wp: { status: "paid", hours: 1, payment: { mode, amount, method, paidAt: paidAt.toISOString() } } },
  });
  await M.Booking.create([B("BNY-LIVE01", "live", 580), B("BNY-TEST01", "test", 250), B("BNY-CRED01", "live", 0, "credits")]);
  const pipeline = await M.Pipeline.findById(ids["private-office"]);
  const stage = await M.PipelineStage.findOne({ pipelineId: pipeline._id });
  const dealBase = { workspaceId: ids.wsId, pipelineId: pipeline._id, stageId: stage._id, ownerId: ids.admin };
  const office = await M.Deal.create({ ...dealBase, title: "Office", productType: "private_office", contactId: ids.contact });
  await M.Invoice.create({ workspaceId: ids.wsId, dealId: office._id, companyId: ids.company, total: 12000, status: "paid", paidAt: new Date("2026-10-20T04:00:00Z"), createdBy: ids.admin });
  await M.Invoice.create({ workspaceId: ids.wsId, total: 300, status: "paid", paidAt: new Date("2026-11-02T04:00:00Z"), createdBy: ids.admin });
  await M.Deal.create({ ...dealBase, title: "Day pass", productType: "day_pass", status: "won", value: 150, closedAt: new Date("2026-11-03T04:00:00Z"), contactId: ids.contact });
  await M.Deal.create({ ...dealBase, title: "Test pass", productType: "day_pass", status: "won", value: 150, closedAt: new Date("2026-11-03T04:00:00Z"), contactId: ids.loner, metadata: { isTest: true } });

  const rev = await api("/reports/breakdown?by=revenue&period=month&from=2026-10-01&to=2026-11-30");
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  const d = rev.json.data;
  assert.deepEqual(d.periods.map((p) => [p.key, p.label, p.from, p.to]), [["2026-10", "Oct 2026", "2026-10-01", "2026-10-31"], ["2026-11", "Nov 2026", "2026-11-01", "2026-11-30"]]);
  assert.equal(d.rows["2026-10"].meeting_rooms, 580, "test and credit bookings excluded");
  assert.equal(d.rows["2026-10"].private_office, 12000);
  assert.equal(d.rows["2026-11"].other, 300);
  assert.equal(d.rows["2026-11"].day_passes, 150);
  assert.equal(d.rows["2026-11"].podcast, 0);
  assert.equal(d.totals.meeting_rooms, 580);
  assert.equal(d.unit, "HKD");
  assert.ok(d.definitions.meeting_rooms.includes("payment date"));
  assert.ok(d.categories.length === Object.keys(d.rows["2026-10"]).length);

  const now = new Date();
  const ymd = (x) => new Date(x.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const lead = await api(`/reports/breakdown?by=leadSource&period=week&from=${ymd(now)}&to=${ymd(now)}`);
  assert.equal(lead.status, 200, JSON.stringify(lead.json));
  const wk = lead.json.data.periods[0].key;
  assert.equal(lead.json.data.rows[wk].social, 1, "Wendy from Instagram");
  assert.ok(lead.json.data.rows[wk].website >= 1, "Lone: website");
  assert.equal(lead.json.data.mapping.Instagram, "social");
  assert.match(lead.json.data.definitions.social, /Instagram/);

  // Website enquiry deals (one per pipeline) count once; the walk-in submissions count too.
  const receivedAt = new Date();
  await M.Deal.create([
    { ...dealBase, title: "Enq A", contactId: ids.contact, metadata: { receivedAt, allInterests: ["Serviced Offices", "Virtual Office"] } },
    { ...dealBase, title: "Enq B", contactId: ids.contact, metadata: { receivedAt, allInterests: ["Serviced Offices", "Virtual Office"] } },
  ]);
  const enq = await api(`/reports/breakdown?by=enquiryType&period=month&from=${ymd(now)}&to=${ymd(now)}`);
  const row = enq.json.data.rows[enq.json.data.periods[0].key];
  assert.equal(row.serviced_offices, 2, "the two-deal enquiry once, plus Wendy's walk-in");
  assert.equal(row.virtual_office, 1);
  assert.equal(row.coworking_desks, 1, "Wendy's walk-in, counted once per service (two deals and a submission)");
  assert.equal(row.meeting_rooms, 0);
  assert.equal(row.other, 0);

  assert.equal((await api("/reports/breakdown?by=nope&from=2026-10-01&to=2026-10-02")).status, 400);
  assert.equal((await api("/reports/breakdown?by=revenue&period=week&from=2026-10-01&to=2027-12-01")).status, 400);
  assert.equal((await api("/reports/breakdown?by=revenue&from=2026-02-30&to=2026-03-01")).status, 400);
});

test("§6 company loyalty: placeholder tiers, 12-month spend, sorted list, tier filter, monthly", { skip }, async () => {
  // Acme: the October invoice (HK$12,000) and the day pass via its contact (HK$150); the room booking has no contact.
  await M.Booking.updateOne({ externalRef: "BNY-LIVE01" }, { $set: { contactId: ids.contact } });
  const list = await api("/loyalty/companies");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.deepEqual(list.json.data.tiers.map((t) => [t.name, t.minSpend]), [["Member", 0], ["Silver", 10000], ["Gold", 30000]]);
  const [acme, beta] = list.json.data.items;
  assert.equal(acme.company.name, "Acme Ltd");
  assert.equal(acme.spend12m, 12730);
  assert.equal(acme.tier.name, "Silver");
  assert.deepEqual(acme.nextTier, { id: acme.nextTier.id, name: "Gold", minSpend: 30000 });
  assert.equal(acme.toNextTier, 17270);
  assert.equal(beta.spend12m, 0);
  assert.equal(beta.tier.name, "Member");
  assert.deepEqual((await api("/loyalty/companies?tier=silver")).json.data.items.map((i) => i.company.name), ["Acme Ltd"]);
  assert.deepEqual((await api("/loyalty/companies?search=bet")).json.data.items.map((i) => i.company.name), ["Beta Co"]);
  assert.equal(await M.LoyaltyTier.countDocuments(), 3, "seeded once");

  const one = await api(`/companies/${ids.company}/loyalty`);
  assert.equal(one.json.data.monthly.length, 12);
  assert.equal(one.json.data.monthly.find((m) => m.month === "2026-10").spend, 12580);
  assert.equal(one.json.data.monthly.reduce((s, m) => s + m.spend, 0), one.json.data.spend12m);
});

/* ---------- E2E report fixes (23 Nov) ---------- */
test("E2E F1/F4/F9: row labels for credits, channel and calendar state", async () => {
  const { toRoomBookingRow } = await import("../src/services/wpRoomBooking.service.js");
  const row = (wp, roomCalendar) => toRoomBookingRow({ _id: "x", externalRef: wp.ref, startAt: new Date(), endAt: new Date(), metadata: { wp, roomCalendar } });
  const base = { ref: "BNY-L1", status: "cancelled", roomName: "Meeting Room (5 to 6 people)", hours: 1, viaCrm: true, channel: "admin" };
  const credits = row({ ...base, payment: { method: "credits", amount: 0, mode: "test" } }, { eventId: null, action: "removed", reason: "status_cancelled", error: null });
  assert.equal(credits.payment.amountLabel, "Meeting room credits (1 h)");
  assert.equal(credits.payment.stripeUrl, null);
  assert.equal(credits.channelLabel, "Meeting room credits · booked via CRM");
  assert.deepEqual(
    [credits.googleCalendar.status, credits.googleCalendar.label, credits.googleCalendar.retry],
    ["removed", "Removed from Meeting Room calendar (cancelled)", false],
  );
  const web = row({ ...base, status: "paid", channel: "web", payment: { method: "stripe", amount: 250, mode: "live" } }, { eventId: "b123", calendarId: "c", action: "inserted" });
  assert.equal(web.payment.amountLabel, "HK$250");
  assert.equal(web.channelLabel, "Website checkout · booked via CRM");
  assert.equal(web.googleCalendar.label, "In Meeting Room calendar");
  const failed = row({ ...base, status: "paid", payment: { method: "stripe", amount: 250 } }, { eventId: null, error: "403 Forbidden" });
  assert.deepEqual([failed.googleCalendar.status, failed.googleCalendar.retry], ["error", true]);
  assert.match(row({ ...base, status: "paid" }, { reason: "no_calendar_for_room" }).googleCalendar.label, /^Not in Meeting Room calendar: no calendar set/);
});

test("E2E F3: a different email is a different person, even with the same phone", { skip }, async () => {
  const { findOrCreateContact } = await import("../src/services/contactMatching.service.js");
  await M.Contact.create({ workspaceId: ids.wsId, firstName: "Shared", email: "first@phone.test", phone: "+852 5555 0000", ownerId: ids.admin });
  const other = await findOrCreateContact(ids.wsId, ids.admin, { email: "second@phone.test", phone: "+852 5555 0000", firstName: "Second" });
  assert.equal(other.created, true);
  assert.equal(other.contact.email, "second@phone.test");
  // No email given: the phone still finds the existing contact.
  const byPhone = await findOrCreateContact(ids.wsId, ids.admin, { phone: "+852 5555 0000", firstName: "Phone only" });
  assert.equal(byPhone.matchedBy, "phone");
  // A contact without an email can still be matched by phone.
  const noEmail = await M.Contact.create({ workspaceId: ids.wsId, firstName: "NoMail", phone: "+852 6666 1111", ownerId: ids.admin });
  const r = await findOrCreateContact(ids.wsId, ids.admin, { email: "nomail@phone.test", phone: "+852 6666 1111" });
  assert.equal(String(r.contact._id), String(noEmail._id));
});

test("E2E F6/F7: walk-in deals are source walk_in with all deal ids; newsletter interests never make deals", { skip }, async () => {
  const wendy = await M.Contact.findOne({ email: "wendy@walk.test" });
  const deals = await M.Deal.find({ contactId: wendy._id }).lean();
  assert.ok(deals.length === 2 && deals.every((d) => d.source === "walk_in"), deals.map((d) => d.source).join());
  const sub = await M.FormSubmission.findOne({ contactId: wendy._id }).lean();
  assert.equal(sub.dealIds.length, 2);
  const list = await api(`/forms/${ids.form}/submissions`);
  const item = list.json.data.items.find((i) => String(i._id) === String(sub._id));
  assert.equal(item.dealIds.length, 2);
  assert.ok(item.dealIds.every((d) => d.title.startsWith("Walk-in enquiry")));

  const news = await api("/forms", {
    method: "POST",
    body: {
      name: "Newsletter", slug: "newsletter-qa", type: "newsletter", consentText: "Send me news",
      fields: [
        { key: "first_name", label: "First name", type: "text", mapTo: "firstName" },
        { key: "email", label: "Email", type: "email", mapTo: "email", required: true },
        { key: "interest", label: "Interested in", type: "checkboxes", mapTo: "interests", options: ["Coworking", "Virtual Office"] },
      ],
      flodesk: { enabled: true },
    },
  });
  assert.equal(news.status, 201, JSON.stringify(news.json));
  const r = await realFetch(`${base}/public/forms/newsletter-qa`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://banyanworkspace.com" },
    body: JSON.stringify({ publicKey: news.json.data.publicKey, first_name: "Nia", email: "nia@news.test", interest: ["Coworking"], consent: "yes" }),
  });
  assert.equal(r.status, 201, await r.text());
  const nia = await M.Contact.findOne({ email: "nia@news.test" });
  assert.equal(await M.Deal.countDocuments({ contactId: nia._id }), 0, "no deal from a newsletter form");
  const s = await waitFor(() => M.FormSubmission.findOne({ contactId: nia._id, "flodesk.status": "added" }).lean());
  assert.ok(s, "processed and added to Flodesk");
  assert.deepEqual(s.flodesk.segments, ["Coworking [Automated]"]);
});
