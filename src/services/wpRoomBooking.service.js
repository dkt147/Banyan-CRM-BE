/*
 * WordPress room bookings ("Banyan Room Booking" plugin on banyanworkspace.com).
 *
 * WordPress is the single source of truth for meeting-room bookings. The CRM:
 *   - receives booking.paid / booking.cancelled pushes (controllers/wpRoomBookingWebhook.controller.js),
 *   - pulls GET /bookings (token, server-side only) for backfill and reconciliation,
 *   - mirrors every WordPress booking into the Booking collection as a read-only cache row
 *     keyed by Booking.externalRef = booking.ref (e.g. "BNY-LDNMJ4").
 *
 * New bookings are never created here: the staff browser calls WordPress POST /checkout directly
 * (public endpoint, so the 12-per-10-min rate limit is per staff IP, and the CRM never sees card data).
 */
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { Activity } from "../models/Activity.js";
import { Booking } from "../models/Booking.js";
import { Integration } from "../models/Integration.js";
import { Resource } from "../models/Resource.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { AppError } from "../utils/AppError.js";
import { HK_TZ } from "../utils/hkTime.js";
import { findOrCreateContact } from "./contactMatching.service.js";

/* ---------- business rules (spec §3; no config endpoint exists in WordPress) ---------- */
export const WP_ROOMS = [
  { key: "small", name: "Meeting Room", capacity: "5 to 6 people", capacityCount: 6, price: 250 },
  { key: "medium", name: "Meeting Room", capacity: "14 people", capacityCount: 14, price: 580 },
  { key: "library", name: "The Library", capacity: "15 people (depending on layout)", capacityCount: 15, price: 888 },
];
export const WP_BOOKING_RULES = { open: 9, close: 18, days: [1, 2, 3, 4, 5], maxDays: 90, holdMinutes: 35, checkoutExpiresMinutes: 31 };
export const roomLabel = (room) => `${room.name} (${room.capacity})`;

const HOLD_MS = WP_BOOKING_RULES.holdMinutes * 60 * 1000;
const WP_STATUSES = ["paid", "pending", "cancelled", "expired", "blocked", "error"];
// Pushed events can arrive late or be retried; they never move a booking "backwards".
// Pull snapshots are WordPress's current state and always apply.
const STATUS_RANK = { pending: 1, expired: 1, error: 1, paid: 2, blocked: 2, cancelled: 3 };
export const CRM_NOTES_PREFIX = "Booked via CRM";

/* ---------- signature ---------- */
/** Constant-time check of X-Banyan-Token and X-Banyan-Signature (hex HMAC-SHA256 of the raw body). */
export function verifyWpSignature(rawBody, signatureHeader, tokenHeader, secret = env.BANYAN_CRM_TOKEN) {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  const tokenA = Buffer.from(String(tokenHeader || ""));
  const tokenB = Buffer.from(secret);
  if (tokenA.length !== tokenB.length || !crypto.timingSafeEqual(tokenA, tokenB)) return false;
  const sig = String(signatureHeader || "").trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sig)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  return crypto.timingSafeEqual(Buffer.from(sig, "hex"), expected);
}

/* ---------- payload mapping (pure) ---------- */
const hkDateLabel = (date) =>
  date.toLocaleDateString("en-GB", { timeZone: HK_TZ, weekday: "short", day: "numeric", month: "short", year: "numeric" });
const money = (amount) => `HK$${Number(amount || 0).toLocaleString("en-HK", { maximumFractionDigits: 2 })}`;

function toDate(iso, date, time) {
  const value = iso || (date && time ? `${date}T${time}:00+08:00` : null);
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.valueOf()) ? d : null;
}

/**
 * Turn a WordPress payload (webhook or snapshot) into the Booking fields the CRM stores.
 * Throws AppError(400) for payloads that cannot be stored.
 */
export function mapWpPayload(payload) {
  const b = payload?.booking || {};
  const customer = payload?.customer || {};
  const payment = payload?.payment || {};
  const ref = String(b.ref || "").trim();
  if (!/^[A-Z0-9][A-Z0-9-]{2,40}$/i.test(ref)) throw new AppError("booking.ref is missing or invalid.", 400, "WP_BOOKING_INVALID");
  const wpStatus = String(b.status || "").toLowerCase();
  if (!WP_STATUSES.includes(wpStatus)) throw new AppError(`Unknown booking status "${b.status}".`, 400, "WP_BOOKING_INVALID");
  const startAt = toDate(b.start_iso, b.date, b.start_time);
  const endAt = toDate(b.end_iso, b.date, b.end_time);
  if (!startAt || !endAt || endAt <= startAt) throw new AppError("Booking start/end time is invalid.", 400, "WP_BOOKING_INVALID");

  const room = WP_ROOMS.find((r) => r.key === b.room_key);
  const roomName = b.room_name || (room ? roomLabel(room) : b.room_key || "Meeting room");
  const createdAt = toDate(b.created_at);
  const isPaid = payment.status === "paid" || Boolean(payment.paid_at);
  const amountMinor = Number.isFinite(Number(payment.amount_minor))
    ? Math.round(Number(payment.amount_minor))
    : Number.isFinite(Number(payment.amount)) ? Math.round(Number(payment.amount) * 100) : null;
  const notes = String(customer.notes || "");
  const blocked = wpStatus === "blocked";

  const lifecycle = {
    paid: { status: "confirmed", paymentStatus: "paid" },
    pending: { status: "pending_payment", paymentStatus: "unpaid" },
    cancelled: { status: "cancelled", paymentStatus: isPaid ? "paid" : "unpaid" },
    expired: { status: "expired", paymentStatus: "unpaid" },
    error: { status: "expired", paymentStatus: "failed" },
    blocked: { status: "confirmed", paymentStatus: "not_required" },
  }[wpStatus];

  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
  return {
    ref,
    wpStatus,
    blocked,
    contactDetails: blocked
      ? null
      : { firstName: customer.first_name, lastName: customer.last_name, email: customer.email, phone: customer.phone },
    fields: {
      externalRef: ref,
      source: "website",
      bookingType: blocked ? "blocked" : "meeting_room",
      resourceName: roomName,
      title: blocked ? `Blocked${notes ? ` – ${notes}` : ""}`.slice(0, 160) : (fullName || customer.email || ref).slice(0, 160),
      subtitle: roomName.slice(0, 160),
      startAt,
      endAt,
      status: lifecycle.status,
      paymentStatus: lifecycle.paymentStatus,
      // A pending checkout holds the slot for 35 minutes, then WordPress frees it.
      holdExpiresAt: wpStatus === "pending" ? new Date((createdAt || new Date()).getTime() + HOLD_MS) : null,
      amountMinor: blocked ? null : amountMinor,
      price: blocked || amountMinor == null ? 0 : amountMinor / 100,
      currency: String(payment.currency || "HKD").toUpperCase(),
      stripeCheckoutSessionId: payment.stripe_session_id || null,
      stripePaymentIntentId: payment.stripe_payment_intent || null,
      notes,
    },
    wp: {
      ref,
      status: wpStatus,
      channel: b.channel || (blocked ? "admin" : "web"),
      viaCrm: notes.startsWith(CRM_NOTES_PREFIX),
      roomKey: b.room_key || null,
      roomName,
      date: b.date || null,
      startTime: b.start_time || null,
      endTime: b.end_time || null,
      hours: Number(b.hours) || Math.round((endAt - startAt) / 3600000),
      createdAt: createdAt ? createdAt.toISOString() : null,
      customer: {
        firstName: customer.first_name || "",
        lastName: customer.last_name || "",
        email: customer.email || "",
        phone: customer.phone || "",
        notes,
      },
      payment: blocked
        ? null
        : {
            provider: payment.provider || "stripe",
            mode: payment.mode === "live" ? "live" : payment.mode === "test" ? "test" : payment.mode || null,
            amount: payment.amount ?? (amountMinor != null ? amountMinor / 100 : null),
            amountMinor,
            currency: String(payment.currency || "HKD").toUpperCase(),
            status: payment.status || null,
            paidAt: payment.paid_at || null,
            stripeSessionId: payment.stripe_session_id || null,
            stripePaymentIntent: payment.stripe_payment_intent || null,
          },
    },
  };
}

/** Dashboard link for the payment (spec §4.5). */
export function stripePaymentUrl(payment) {
  if (!payment?.stripePaymentIntent) return null;
  return `https://dashboard.stripe.com/${payment.mode === "test" ? "test/" : ""}payments/${payment.stripePaymentIntent}`;
}

/* ---------- workspace / owner / rooms ---------- */
let contextCache = null;
/** The workspace WordPress bookings belong to: same env vars as website enquiries. */
export async function getWpBookingContext() {
  if (contextCache && contextCache.expires > Date.now()) return contextCache.value;
  const id = env.PUBLIC_ENQUIRY_WORKSPACE_ID;
  const workspace = id
    ? /^[0-9a-f]{24}$/i.test(id) ? await Workspace.findOne({ _id: id, isActive: true }) : null
    : await Workspace.findOne({ slug: env.PUBLIC_ENQUIRY_WORKSPACE_SLUG, isActive: true });
  if (!workspace)
    throw new AppError("The website booking workspace is not configured or is inactive.", 503, "WP_BOOKING_WORKSPACE_NOT_CONFIGURED");
  const owner =
    (await User.findOne({ _id: workspace.createdBy, workspaceId: workspace._id, isActive: true }).select("_id name")) ||
    (await User.findOne({ workspaceId: workspace._id, role: "admin", isActive: true }).sort({ createdAt: 1 }).select("_id name"));
  if (!owner) throw new AppError("No active CRM user is available to own website bookings.", 503, "BOOKING_OWNER_NOT_CONFIGURED");
  const value = { workspaceId: workspace._id, ownerId: owner._id };
  contextCache = { value, expires: Date.now() + 5 * 60 * 1000 };
  return value;
}

/** Find or create the Resource for a WordPress room so the availability grid has a lane for it. */
async function ensureRoomResource(workspaceId, mapped) {
  const room = WP_ROOMS.find((r) => r.key === mapped.wp.roomKey);
  const hours = [{ open: "09:00", close: "18:00" }];
  const resource = await Resource.findOneAndUpdate(
    { workspaceId, name: mapped.fields.resourceName },
    {
      $setOnInsert: {
        workspaceId,
        name: mapped.fields.resourceName,
        type: "meeting_room",
        capacity: room?.capacityCount,
        pricePerHourMinor: room ? room.price * 100 : 0,
        currency: "HKD",
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours },
        slotMinutes: 60,
        metadata: { wpRoomKey: mapped.wp.roomKey, managedBy: "wordpress" },
      },
    },
    { upsert: true, new: true },
  ).select("_id");
  return resource._id;
}

/* ---------- upsert ---------- */
function activityFor(previousStatus, mapped) {
  const { wp } = mapped;
  // Stripe test-mode bookings never add to a contact's timeline (they may use a real client's email).
  if (mapped.blocked || previousStatus === wp.status || wp.payment?.mode === "test") return null;
  const when = `${hkDateLabel(mapped.fields.startAt).replace(",", "")} ${wp.startTime || ""}–${wp.endTime || ""}`.trim();
  if (wp.status === "paid")
    return {
      subject: `Room booking paid ${wp.ref}`,
      body: `Booked ${wp.roomName}, ${when}, paid ${money(wp.payment?.amount)}${wp.viaCrm ? " (booked via CRM)" : ""}.`,
    };
  if (wp.status === "cancelled" && previousStatus === "paid")
    return {
      subject: `Room booking cancelled ${wp.ref}`,
      body: `${wp.roomName}, ${when}. Booking cancelled – refund handled in Stripe.`,
    };
  return null;
}

/**
 * Create or update the cache row for one WordPress booking. Idempotent by ref.
 * origin: "webhook" (may be stale, never downgrades status) | "snapshot" (current state, always applies).
 * Returns { booking, created, changed, skipped }.
 */
export async function upsertWpBooking(payload, { origin = "snapshot", event = null, context = null } = {}) {
  const mapped = mapWpPayload(payload);
  const { workspaceId, ownerId } = context || (await getWpBookingContext());

  let booking = await Booking.findOne({ workspaceId, externalRef: mapped.ref });
  // A row created before refs were stored may already carry the payment intent.
  if (!booking && mapped.fields.stripePaymentIntentId)
    booking = await Booking.findOne({ workspaceId, stripePaymentIntentId: mapped.fields.stripePaymentIntentId, externalRef: { $exists: false } });
  const previousStatus = booking?.metadata?.wp?.status || null;

  if (booking && origin === "webhook" && previousStatus && (STATUS_RANK[mapped.wpStatus] || 0) < (STATUS_RANK[previousStatus] || 0))
    return { booking, created: false, changed: false, skipped: "stale_event" };

  const created = !booking;
  if (!booking) booking = new Booking({ workspaceId, createdBy: ownerId, metadata: {} });
  booking.set(mapped.fields);
  if (!booking.resourceId) booking.resourceId = await ensureRoomResource(workspaceId, mapped);

  // Link a contact on first sight (or if still unlinked); never overwrite a staff re-link.
  let contactMatch = booking.metadata?.contactMatch;
  if (!booking.contactId && mapped.contactDetails) {
    try {
      const { contact, created: contactCreated, matchedBy } = await findOrCreateContact(workspaceId, ownerId, mapped.contactDetails, {
        source: "website",
        tags: ["website_booking", "room_booking"],
      });
      booking.contactId = contact._id;
      if (!booking.companyId && contact.companyId) booking.companyId = contact.companyId;
      contactMatch = contactCreated ? "created" : matchedBy;
      // Contacts that exist only because of a Stripe test-mode booking are tagged so they can be
      // filtered out or cleaned up. Existing (real) contacts are never tagged.
      if (contactCreated && mapped.wp.payment?.mode === "test") {
        contact.tags = [...new Set([...(contact.tags || []), "test-booking"])];
        await contact.save();
      }
    } catch (error) {
      if (error.code !== "CONTACT_IDENTIFIER_REQUIRED") throw error;
    }
  }

  const { lastEvent: _e, lastSyncedAt: _s, ...previousWp } = booking.metadata?.wp || {};
  const changed = created || booking.isModified() || JSON.stringify(previousWp) !== JSON.stringify(mapped.wp);
  booking.metadata = {
    ...(booking.metadata || {}),
    ...(contactMatch ? { contactMatch } : {}),
    wp: { ...mapped.wp, lastEvent: event || `booking.${origin}`, lastSyncedAt: new Date().toISOString() },
    wpRawPayload: payload,
  };
  booking.markModified("metadata");

  try {
    await booking.save();
  } catch (error) {
    // Webhook and sync raced on the same new ref: retry once as an update.
    if (error?.code === 11000 && created) return upsertWpBooking(payload, { origin, event, context: { workspaceId, ownerId } });
    throw error;
  }

  const activity = booking.contactId ? activityFor(previousStatus, mapped) : null;
  if (activity)
    await Activity.create({
      workspaceId,
      type: "booking",
      contactId: booking.contactId,
      companyId: booking.companyId,
      userId: ownerId,
      subject: activity.subject,
      body: activity.body,
      occurredAt: new Date(),
      metadata: { bookingId: String(booking._id), wpRef: mapped.ref, wpStatus: mapped.wpStatus, paymentMode: mapped.wp.payment?.mode || null },
    });

  return { booking, created, changed, skipped: null };
}

/* ---------- WordPress API client (token endpoints: server-side only) ---------- */
export const WP_SYNC_NOT_CONFIGURED_MESSAGE = "WordPress sync isn't configured on the server (BANYAN_CRM_TOKEN).";

export async function fetchWpBookings(params = {}) {
  if (!env.BANYAN_CRM_TOKEN) throw new AppError(WP_SYNC_NOT_CONFIGURED_MESSAGE, 503, "WP_BOOKING_NOT_CONFIGURED");
  const url = new URL("bookings", env.BANYAN_WP_API_URL);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, String(value));
  url.searchParams.set("_", String(Date.now())); // the site sits behind Varnish/Breeze
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json", "X-Banyan-Token": env.BANYAN_CRM_TOKEN },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new AppError(`WordPress bookings API is unreachable: ${error.message}`, 502, "WP_BOOKING_UNREACHABLE");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new AppError(
      res.status === 401 || res.status === 403
        ? "WordPress rejected the API token. Check BANYAN_CRM_TOKEN."
        : json?.message || `WordPress bookings API returned ${res.status}.`,
      502,
      "WP_BOOKING_API_ERROR",
      { status: res.status },
    );
  return Array.isArray(json?.bookings) ? json.bookings : [];
}

async function upsertMany(rows, context) {
  const counts = { received: rows.length, created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
  for (const row of rows) {
    try {
      const r = await upsertWpBooking(row, { origin: "snapshot", event: row?.event || "booking.snapshot", context });
      counts[r.created ? "created" : r.changed ? "updated" : "unchanged"] += 1;
    } catch (error) {
      counts.failed += 1;
      if (counts.errors.length < 10) counts.errors.push({ ref: row?.booking?.ref || null, message: error.message });
    }
  }
  return counts;
}

const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/** Pull every booking whose date is in [from, to] (YYYY-MM-DD), one month per request (500-row cap). */
export async function syncWpRange(from, to) {
  const context = await getWpBookingContext();
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start)
    throw new AppError("from/to must be YYYY-MM-DD with from <= to.", 400, "INVALID_DATES");
  const totals = { received: 0, created: 0, updated: 0, unchanged: 0, failed: 0, errors: [], truncatedMonths: [] };
  for (let cursor = start; cursor <= end; ) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const chunkEnd = monthEnd < end ? monthEnd : end;
    const rows = await fetchWpBookings({ from: ymd(cursor), to: ymd(chunkEnd) });
    if (rows.length >= 500) totals.truncatedMonths.push(ymd(cursor).slice(0, 7));
    const c = await upsertMany(rows, context);
    for (const k of ["received", "created", "updated", "unchanged", "failed"]) totals[k] += c[k];
    totals.errors.push(...c.errors);
    cursor = addDays(chunkEnd, 1);
  }
  totals.errors = totals.errors.slice(0, 10);
  return totals;
}

/* ---------- incremental reconciliation (spec §6.4) ---------- */
async function syncState(workspaceId) {
  return Integration.findOneAndUpdate(
    { workspaceId, provider: "wordpress" },
    { $setOnInsert: { workspaceId, provider: "wordpress", status: "pending", accountName: "banyanworkspace.com", config: {} } },
    { upsert: true, new: true },
  );
}

let running = null;
/**
 * Pull GET /bookings?updated_since=<last run> and upsert by ref. The first run backfills
 * 60 days back to 90 days ahead. Safe to call concurrently (calls share one run).
 */
export function syncWpIncremental() {
  if (running) return running;
  running = (async () => {
    const context = await getWpBookingContext();
    const state = await syncState(context.workspaceId);
    const cursor = state.config?.roomBookings?.updatedSince;
    const startedAt = new Date();
    try {
      let result;
      if (cursor) {
        result = await upsertMany(await fetchWpBookings({ updated_since: cursor }), context);
      } else {
        result = await syncWpRange(ymd(addDays(startedAt, -60)), ymd(addDays(startedAt, WP_BOOKING_RULES.maxDays + 1)));
      }
      // Overlap by a minute so records written during the request are never missed.
      const next = new Date(startedAt.getTime() - 60 * 1000).toISOString();
      const mode = cursor ? "incremental" : "backfill";
      await Integration.updateOne(
        { _id: state._id },
        { $set: { status: "connected", error: null, lastSyncedAt: startedAt, "config.roomBookings": { updatedSince: next, lastResult: { ...result, mode, at: startedAt.toISOString(), error: null } } } },
      );
      return { mode, ...result };
    } catch (error) {
      // Keep the cursor so the next run retries the same window.
      await Integration.updateOne(
        { _id: state._id },
        {
          $set: {
            status: "error",
            error: error.message,
            "config.roomBookings.lastResult": { mode: cursor ? "incremental" : "backfill", at: startedAt.toISOString(), created: 0, updated: 0, failed: 0, error: error.message },
          },
        },
      );
      throw error;
    }
  })().finally(() => {
    lastAttemptAt = Date.now();
    running = null;
  });
  return running;
}

let lastAttemptAt = 0;
/**
 * Called on reads (GET /room-bookings): start an incremental sync in the background when the
 * last attempt is older than maxAgeMs. Never awaited, never throws; single-flight via syncWpIncremental.
 * Webhooks only cover paid/cancelled, so this is what makes pending holds, expiries and blocks show quickly.
 */
export function syncWpIfStale(maxAgeMs = 60 * 1000) {
  if (!env.BANYAN_CRM_TOKEN || running || Date.now() - lastAttemptAt < maxAgeMs) return false;
  lastAttemptAt = Date.now();
  syncWpIncremental().catch((error) => console.error("[wp-bookings] on-read sync failed:", error.message));
  return true;
}

/** { at, mode, created, updated, failed, error } of the last sync run, or null. */
export async function getWpLastSync(workspaceId) {
  const state = await Integration.findOne({ workspaceId, provider: "wordpress" }).select("config.roomBookings.lastResult").lean();
  const r = state?.config?.roomBookings?.lastResult;
  if (!r) return null;
  return { at: r.at || null, mode: r.mode || null, created: r.created ?? 0, updated: r.updated ?? 0, failed: r.failed ?? 0, error: r.error || null };
}

/* ---------- CRM-only bookings must not use the WordPress rooms (double-booking risk) ---------- */
const WP_ROOM_LABELS = new Set(WP_ROOMS.map((r) => roomLabel(r).toLowerCase()));
/**
 * Express middleware for CRM create/update paths: strips a client-supplied externalRef and
 * rejects bookings placed in a WordPress room (by label or by a WordPress-managed resourceId).
 */
export async function rejectWpRoomForCrmBooking(req, _res, next) {
  try {
    if (req.body && typeof req.body === "object") delete req.body.externalRef;
    const { resourceName, resourceId } = req.body || {};
    let wpRoom = typeof resourceName === "string" && WP_ROOM_LABELS.has(resourceName.trim().toLowerCase());
    if (!wpRoom && resourceId && /^[0-9a-f]{24}$/i.test(String(resourceId)))
      wpRoom = Boolean(await Resource.exists({ _id: resourceId, workspaceId: req.workspaceId, "metadata.managedBy": "wordpress" }));
    if (wpRoom)
      throw new AppError(
        "Book meeting rooms through WordPress. Use the room booking window so the website sees the booking.",
        409,
        "WP_ROOM_BOOK_VIA_WORDPRESS",
      );
    next();
  } catch (error) {
    next(error);
  }
}

/** Background job wrapper: never throws. */
export async function runWpBookingSyncJob() {
  if (!env.BANYAN_CRM_TOKEN) return;
  try {
    const r = await syncWpIncremental();
    if (r.created || r.updated || r.failed)
      console.log(`[wp-bookings] ${r.mode}: ${r.created} created, ${r.updated} updated, ${r.failed} failed`);
  } catch (error) {
    console.error("[wp-bookings] sync failed:", error.message);
  }
}

/* ---------- API row shape for the CRM frontend ---------- */
export function toRoomBookingRow(b, now = new Date()) {
  const wp = b.metadata?.wp || {};
  const holdLapsed = wp.status === "pending" && b.holdExpiresAt && new Date(b.holdExpiresAt) <= now;
  const status = holdLapsed ? "expired" : wp.status || b.status;
  const contact = b.contactId && typeof b.contactId === "object" ? b.contactId : null;
  return {
    id: String(b._id),
    ref: b.externalRef,
    status, // paid | pending | blocked | cancelled | expired | error
    statusLabel: { paid: "Paid", pending: "Awaiting payment", blocked: "Blocked", cancelled: "Cancelled", expired: "Expired", error: "Error" }[status] || status,
    channel: wp.channel || null, // web | admin
    viaCrm: Boolean(wp.viaCrm),
    roomKey: wp.roomKey || null,
    roomName: wp.roomName || b.resourceName,
    resourceId: b.resourceId ? String(b.resourceId) : null,
    date: wp.date,
    dateLabel: hkDateLabel(new Date(b.startAt)),
    startTime: wp.startTime,
    endTime: wp.endTime,
    hours: wp.hours,
    startAt: b.startAt,
    endAt: b.endAt,
    holdExpiresAt: status === "pending" ? b.holdExpiresAt : null,
    customer: wp.customer || null,
    contact: contact
      ? { id: String(contact._id), firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone }
      : b.contactId ? { id: String(b.contactId) } : null,
    payment: wp.payment
      ? { ...wp.payment, isTest: wp.payment.mode === "test", amountLabel: wp.payment.amount != null ? money(wp.payment.amount) : null, stripeUrl: stripePaymentUrl(wp.payment) }
      : null,
    createdAt: wp.createdAt,
    syncedAt: wp.lastSyncedAt || b.updatedAt,
  };
}

/** Express guard: rows mirrored from WordPress cannot be edited, confirmed, cancelled or deleted in the CRM. */
export async function assertNotWpManaged(workspaceId, bookingId) {
  const row = await Booking.findOne({ _id: bookingId, workspaceId }).select("externalRef").lean().catch(() => null);
  if (row?.externalRef)
    throw new AppError(
      `Booking ${row.externalRef} is managed in WordPress. Change or cancel it in WP Admin > Room Bookings.`,
      409,
      "WP_BOOKING_READ_ONLY",
    );
}
