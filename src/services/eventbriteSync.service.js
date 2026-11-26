/*
 * Eventbrite -> CRM (27 Nov b, A). Eventbrite stays where events are created and tickets sold. The CRM
 * reads events and attendees and creates or updates a contact per attendee (by email only).
 *
 *  - Sync: every 30 minutes (and 2 minutes after boot), one run at a time. Events from 1 Jan 2026 plus
 *    every future one; attendees per event, with changed_since on later runs. Back off on 429.
 *  - Webhook: POST /api/v1/webhooks/eventbrite/:secret -> fetch api_url (www.eventbriteapi.com only),
 *    upsert like the sync. Idempotent through WebhookEvent (webhook_id + api_url).
 *  - Nothing is written to Eventbrite except creating the webhook.
 *  - Never logs or returns EVENTBRITE_PRIVATE_TOKEN or EVENTBRITE_WEBHOOK_SECRET.
 */
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { Activity } from "../models/Activity.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Event } from "../models/Event.js";
import { EventRegistration } from "../models/EventRegistration.js";
import { Integration } from "../models/Integration.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { AppError } from "../utils/AppError.js";
import { MAX_TAGS_PER_CONTACT } from "../utils/contactTags.js";
import { findContactByEmailOrPhone } from "./contactMatching.service.js";
import { requireEnvironment } from "./providerApi.service.js";
import { getIntakeContext } from "./publicEnquiry.service.js";

export const EVENTBRITE_API = "https://www.eventbriteapi.com/v3";
const SINCE = new Date("2026-01-01T00:00:00+08:00");
const STATUS_TTL_MS = 5 * 60 * 1000;
export const WEBHOOK_ACTIONS =
  "order.placed,order.updated,order.refunded,attendee.updated,attendee.checked_in,attendee.checked_out,event.published,event.updated";

export const isEventbriteConfigured = () => Boolean(env.EVENTBRITE_PRIVATE_TOKEN);

/* ---------- API (read-only, except creating the webhook) ---------- */

async function eb(pathOrUrl, { method = "GET", body, retries = 3 } = {}) {
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${EVENTBRITE_API}${pathOrUrl}`;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${env.EVENTBRITE_PRIVATE_TOKEN}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      throw new AppError(`Eventbrite is unreachable: ${error.message}`, 502, "EVENTBRITE_API_ERROR");
    }
    if (res.status === 429 && attempt < retries) {
      const wait = Math.min(Number(res.headers.get("retry-after")) * 1000 || Number(process.env.EVENTBRITE_RETRY_BASE_MS ?? 2000) * 3 ** attempt, 60000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(data?.error_description || data?.error || `HTTP ${res.status}`).replace(/[\r\n]/g, " ").slice(0, 240);
      throw new AppError(`Eventbrite request failed (${res.status}): ${msg}`, 502, "EVENTBRITE_API_ERROR", { status: res.status });
    }
    return data;
  }
}

/** All pages of a list endpoint (Eventbrite continuation paging). */
async function ebList(path, key, { stop } = {}) {
  const out = [];
  let continuation = null;
  for (let page = 0; page < 200; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const data = await eb(`${path}${continuation ? `${sep}continuation=${encodeURIComponent(continuation)}` : ""}`);
    const rows = data?.[key] || [];
    out.push(...rows);
    if (stop && rows.length && stop(rows.at(-1))) break;
    if (!data?.pagination?.has_more_items || !data.pagination.continuation) break;
    continuation = data.pagination.continuation;
  }
  return out;
}

async function organization() {
  const data = await eb("/users/me/organizations/");
  const orgs = data?.organizations || [];
  const org = env.EVENTBRITE_ORGANIZATION_ID ? orgs.find((o) => String(o.id) === String(env.EVENTBRITE_ORGANIZATION_ID)) || { id: env.EVENTBRITE_ORGANIZATION_ID, name: null } : orgs[0];
  if (!org?.id) throw new AppError("The Eventbrite token has no organisation.", 409, "EVENTBRITE_NO_ORGANIZATION");
  return { id: String(org.id), name: org.name || null };
}

/* ---------- state on Integration { provider: "eventbrite" } ---------- */

async function integrationFor(workspaceId) {
  return Integration.findOneAndUpdate(
    { workspaceId, provider: "eventbrite" },
    { $setOnInsert: { workspaceId, provider: "eventbrite", status: "pending", config: {} } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}
const saveState = (workspaceId, set) => Integration.updateOne({ workspaceId, provider: "eventbrite" }, { $set: set });

/* ---------- mapping ---------- */

const text = (v, max) => String(v ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const date = (v) => {
  const d = v ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d : null;
};

export function mapEvent(ev) {
  const addr = ev.venue?.address?.localized_address_display || [ev.venue?.address?.address_1, ev.venue?.address?.city].filter(Boolean).join(", ");
  return {
    name: text(ev.name?.text ?? ev.name, 300),
    description: text(ev.description?.text ?? ev.summary, 5000),
    url: ev.url || null,
    status: ev.status || "live",
    startAt: date(ev.start?.utc),
    endAt: date(ev.end?.utc),
    timezone: ev.start?.timezone || null,
    venue: [ev.venue?.name, addr].filter(Boolean).join(", ") || (ev.online_event ? "Online" : null),
    capacity: ev.capacity != null ? Number(ev.capacity) : null,
    isFree: Boolean(ev.is_free),
    currency: ev.currency || null,
  };
}

export function attendeeStatus(a) {
  if (a.refunded) return "refunded";
  if (a.cancelled) return "cancelled";
  if (a.checked_in) return "checked_in";
  if (String(a.status || "").toLowerCase() === "not attending") return "not_attending";
  return "attending";
}

/* ---------- contacts (by email only; never overwrite; no consent; no new companies) ---------- */

const locks = new Map();
function serial(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
  return next;
}
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function contactForAttendee(ctx, profile, stats) {
  const email = String(profile?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { contact: null, created: false };
  return serial(`${ctx.workspaceId}:${email}`, async () => {
    let { contact } = await findContactByEmailOrPhone(ctx.workspaceId, { email });
    let created = false;
    const company = profile.company
      ? await Company.findOne({ workspaceId: ctx.workspaceId, name: new RegExp(`^${escapeRx(String(profile.company).trim())}$`, "i") }).select("_id").lean()
      : null;
    if (!contact) {
      contact = await Contact.create({
        workspaceId: ctx.workspaceId, ownerId: ctx.ownerId,
        firstName: text(profile.first_name, 100) || email.split("@")[0], lastName: text(profile.last_name, 100),
        email, phone: profile.cell_phone ? text(profile.cell_phone, 50) : undefined, jobTitle: profile.job_title ? text(profile.job_title, 150) : undefined,
        source: "Eventbrite", tags: ["eventbrite"], companyId: company?._id || undefined,
        metadata: { eventbrite: true },
      });
      created = true;
      stats.contactsCreated++;
    } else {
      const set = {};
      if (!contact.phone && profile.cell_phone) set.phone = text(profile.cell_phone, 50);
      if (!contact.jobTitle && profile.job_title) set.jobTitle = text(profile.job_title, 150);
      if (!contact.companyId && company) set.companyId = company._id;
      const tags = contact.tags || [];
      const addTag = !tags.includes("eventbrite") && tags.length < MAX_TAGS_PER_CONTACT;
      if (Object.keys(set).length || addTag) {
        contact = await Contact.findOneAndUpdate(
          { _id: contact._id },
          { $set: set, ...(addTag ? { $addToSet: { tags: "eventbrite" } } : {}) },
          { new: true },
        );
        stats.contactsUpdated++;
      }
    }
    return { contact, created };
  });
}

/* ---------- upserts ---------- */

async function upsertEvent(ctx, ev) {
  return Event.findOneAndUpdate(
    { workspaceId: ctx.workspaceId, source: "eventbrite", externalId: String(ev.id) },
    { $set: { ...mapEvent(ev), lastSyncedAt: new Date() }, $setOnInsert: { workspaceId: ctx.workspaceId, source: "eventbrite", externalId: String(ev.id) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function eventFor(ctx, eventExternalId) {
  const existing = await Event.findOne({ workspaceId: ctx.workspaceId, source: "eventbrite", externalId: String(eventExternalId) });
  if (existing) return existing;
  return upsertEvent(ctx, await eb(`/events/${encodeURIComponent(eventExternalId)}/?expand=venue`));
}

const ACTIVITY_TITLES = {
  attending: (e, r) => `Signed up for ${e.name}${r.ticketClass ? ` (${r.ticketClass})` : ""}`,
  checked_in: (e) => `Checked in at ${e.name}`,
  cancelled: (e) => `Cancelled ${e.name}`,
  refunded: (e) => `Refunded ${e.name}`,
  not_attending: (e) => `Not attending ${e.name}`,
};

async function processAttendee(ctx, event, a, stats) {
  const status = attendeeStatus(a);
  const existing = await EventRegistration.findOne({ workspaceId: ctx.workspaceId, source: "eventbrite", externalId: String(a.id) }).lean();
  const profile = a.profile || {};
  const { contact, created } = existing?.contactId
    ? { contact: await Contact.findById(existing.contactId).select("companyId").lean(), created: false }
    : await contactForAttendee(ctx, profile, stats);
  const now = new Date();
  const doc = {
    eventId: event._id,
    contactId: contact?._id || null,
    companyId: contact?.companyId || null,
    orderId: a.order_id ? String(a.order_id) : null,
    name: text(profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(" "), 200),
    email: profile.email ? String(profile.email).trim().toLowerCase() : null,
    phone: profile.cell_phone ? text(profile.cell_phone, 50) : null,
    ticketClass: a.ticket_class_name || null,
    amount: Number(a.costs?.gross?.major_value ?? (a.costs?.gross?.value != null ? a.costs.gross.value / 100 : 0)) || 0,
    currency: a.costs?.gross?.currency || event.currency || null,
    status,
    registeredAt: date(a.created),
    checkedInAt: status === "checked_in" ? existing?.checkedInAt || date(a.barcodes?.[0]?.changed) || date(a.changed) || now : existing?.checkedInAt || null,
    cancelledAt: ["cancelled", "refunded"].includes(status) ? existing?.cancelledAt || date(a.changed) || now : null,
    answers: (a.answers || []).slice(0, 20).map((x) => ({ question: text(x.question, 500), answer: text(x.answer, 500) })).filter((x) => x.question),
  };
  const reg = await EventRegistration.findOneAndUpdate(
    { workspaceId: ctx.workspaceId, source: "eventbrite", externalId: String(a.id) },
    { $set: doc, $setOnInsert: { workspaceId: ctx.workspaceId, source: "eventbrite", externalId: String(a.id), contactCreated: Boolean(created) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  stats.registrations++;
  // Timeline: only for a new sign-up or a status change.
  if (reg.contactId && (!existing || existing.status !== status)) {
    await Activity.create({
      workspaceId: ctx.workspaceId, userId: ctx.ownerId, type: "event", contactId: reg.contactId, companyId: reg.companyId || undefined,
      subject: ACTIVITY_TITLES[status](event, reg), occurredAt: status === "attending" ? reg.registeredAt || now : now,
      metadata: { entityType: "contact", eventId: String(event._id), registrationId: String(reg._id), source: "eventbrite" },
    }).catch((error) => console.error("[eventbrite] activity failed:", error.message));
  }
  return reg;
}

async function recount(event) {
  const [registrationCount, checkedInCount] = await Promise.all([
    EventRegistration.countDocuments({ eventId: event._id, status: { $in: ["attending", "checked_in"] } }),
    EventRegistration.countDocuments({ eventId: event._id, status: "checked_in" }),
  ]);
  await Event.updateOne({ _id: event._id }, { $set: { registrationCount, checkedInCount } });
}

async function syncContext() {
  const { workspace, owner } = await getIntakeContext();
  return { workspaceId: workspace._id, ownerId: owner._id };
}

/* ---------- full sync ---------- */

let running = false;
export const isEventbriteSyncRunning = () => running;

export async function syncEventbrite({ ifRunning = "skip" } = {}) {
  requireEnvironment("EVENTBRITE_PRIVATE_TOKEN");
  if (running) {
    if (ifRunning === "throw") throw new AppError("An Eventbrite sync is already running.", 409, "SYNC_RUNNING");
    return null;
  }
  running = true;
  const ctx = await syncContext().catch((e) => { running = false; throw e; });
  const integration = await integrationFor(ctx.workspaceId);
  const prevSyncAt = integration.config?.lastSyncAt ? new Date(integration.config.lastSyncAt) : null;
  const startedAt = new Date();
  const stats = { events: 0, registrations: 0, contactsCreated: 0, contactsUpdated: 0, errors: 0 };
  try {
    const org = await organization();
    const events = await ebList(
      `/organizations/${encodeURIComponent(org.id)}/events/?status=all&order_by=start_desc&page_size=50&expand=venue`,
      "events",
      { stop: (last) => date(last.start?.utc) && date(last.start.utc) < SINCE },
    );
    const keep = events.filter((e) => (date(e.start?.utc) || new Date(8.64e15)) >= SINCE);
    const since = prevSyncAt ? new Date(prevSyncAt.getTime() - 3600000).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
    for (const ev of keep) {
      try {
        const event = await upsertEvent(ctx, ev);
        stats.events++;
        const attendees = await ebList(`/events/${encodeURIComponent(ev.id)}/attendees/?page_size=50${since ? `&changed_since=${encodeURIComponent(since)}` : ""}`, "attendees");
        for (const a of attendees) {
          try {
            await processAttendee(ctx, event, a, stats);
          } catch (error) {
            stats.errors++;
            console.error("[eventbrite] attendee failed:", error.message);
          }
        }
        await recount(event);
      } catch (error) {
        stats.errors++;
        console.error("[eventbrite] event failed:", error.message);
      }
    }
    await saveState(ctx.workspaceId, {
      status: "connected", accountName: org.name || undefined, externalAccountId: org.id, lastSyncedAt: startedAt,
      "config.organizationId": org.id, "config.organizationName": org.name, "config.lastSyncAt": startedAt, "config.lastSync": stats, "config.lastError": null,
    });
    // First successful sync: register the webhook if it isn't there yet.
    if (!integration.config?.webhookId && env.EVENTBRITE_WEBHOOK_SECRET && env.PUBLIC_API_URL)
      await ensureEventbriteWebhook().catch((error) => console.error("[eventbrite] webhook:", error.message));
    return stats;
  } catch (error) {
    await saveState(ctx.workspaceId, { "config.lastError": String(error.message).slice(0, 300), "config.lastSync": stats, status: "error" }).catch(() => {});
    throw error;
  } finally {
    running = false;
  }
}

export async function runEventbriteSyncJob() {
  if (!isEventbriteConfigured()) return;
  try {
    const r = await syncEventbrite();
    if (r && (r.registrations || r.contactsCreated))
      console.log(`[eventbrite] ${r.events} events, ${r.registrations} registrations, +${r.contactsCreated} contacts, ${r.errors} errors`);
  } catch (error) {
    console.error("[eventbrite] sync failed:", error.message);
  }
}

/* ---------- webhook ---------- */

export function webhookEndpointUrl() {
  return `${env.PUBLIC_API_URL}/api/v1/webhooks/eventbrite/${env.EVENTBRITE_WEBHOOK_SECRET}`;
}

/** POST /integrations/eventbrite/webhook (admin), and after the first sync. Reuses an existing one. */
export async function ensureEventbriteWebhook() {
  requireEnvironment("EVENTBRITE_PRIVATE_TOKEN", "EVENTBRITE_WEBHOOK_SECRET", "PUBLIC_API_URL");
  const ctx = await syncContext();
  await integrationFor(ctx.workspaceId);
  const org = await organization();
  const endpoint = webhookEndpointUrl();
  const existing = await ebList(`/organizations/${encodeURIComponent(org.id)}/webhooks/`, "webhooks").catch(() => []);
  let hook = existing.find((w) => w.endpoint_url === endpoint);
  if (!hook) hook = await eb(`/organizations/${encodeURIComponent(org.id)}/webhooks/`, { method: "POST", body: { endpoint_url: endpoint, actions: WEBHOOK_ACTIONS } });
  if (!hook?.id) throw new AppError("Eventbrite didn't return a webhook id.", 502, "EVENTBRITE_API_ERROR");
  await saveState(ctx.workspaceId, { "config.webhookId": String(hook.id), "config.webhookCreatedAt": new Date() });
  return { webhookActive: true, webhookId: String(hook.id) };
}

export function webhookSecretMatches(secret) {
  const expected = env.EVENTBRITE_WEBHOOK_SECRET;
  if (!expected || !secret) return false;
  const a = crypto.createHash("sha256").update(String(secret)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Accepts the webhook body, records it, and returns a promise that does the work (route doesn't wait). */
export async function acceptEventbriteWebhook(body = {}) {
  const action = String(body?.config?.action || "");
  const apiUrl = String(body?.api_url || "");
  let host = null;
  try {
    host = new URL(apiUrl).host;
  } catch {
    host = null;
  }
  // Eventbrite's own test ping has no api_url; anything not on Eventbrite's API host is ignored.
  if (host !== "www.eventbriteapi.com") return { accepted: false, reason: "ignored" };
  const externalEventId = crypto.createHash("sha256").update(`${body?.config?.webhook_id || ""}|${apiUrl}|${action}`).digest("hex");
  let record;
  try {
    record = await WebhookEvent.create({ provider: "eventbrite", eventType: action || "eventbrite.event", externalEventId, payload: { action, api_url: apiUrl }, status: "received" });
  } catch (error) {
    if (error?.code === 11000) return { accepted: false, reason: "duplicate" };
    throw error;
  }
  const work = processWebhook(action, apiUrl)
    .then(() => WebhookEvent.updateOne({ _id: record._id }, { $set: { status: "processed", processedAt: new Date() } }))
    .catch((error) => {
      console.error("[eventbrite] webhook failed:", error.message);
      return WebhookEvent.updateOne({ _id: record._id }, { $set: { status: "failed", error: String(error.message).slice(0, 300) } });
    });
  return { accepted: true, work };
}

async function processWebhook(action, apiUrl) {
  if (!isEventbriteConfigured()) throw new AppError("EVENTBRITE_PRIVATE_TOKEN is not set.", 503, "INTEGRATION_NOT_CONFIGURED");
  const ctx = await syncContext();
  const stats = { events: 0, registrations: 0, contactsCreated: 0, contactsUpdated: 0, errors: 0 };
  if (action.startsWith("event.")) {
    const ev = await eb(`${apiUrl}${apiUrl.includes("?") ? "&" : "?"}expand=venue`);
    if (ev?.id) await upsertEvent(ctx, ev);
    return stats;
  }
  let attendees = [];
  if (action.startsWith("order.")) {
    const orderUrl = apiUrl.replace(/\?.*$/, "");
    const order = await eb(`${orderUrl}?expand=attendees`);
    attendees = order?.attendees || [];
  } else if (action.startsWith("attendee.")) {
    const a = await eb(apiUrl);
    if (a?.id) attendees = [a];
  }
  const touched = new Map();
  for (const a of attendees) {
    if (!a?.event_id) continue;
    const event = touched.get(String(a.event_id)) || (await eventFor(ctx, a.event_id));
    touched.set(String(a.event_id), event);
    await processAttendee(ctx, event, a, stats);
  }
  for (const event of touched.values()) await recount(event);
  return stats;
}

/* ---------- status ---------- */

let statusCache = { at: 0, value: null };
export function resetEventbriteStatusCache() {
  statusCache = { at: 0, value: null };
}

/** GET /integrations/eventbrite (admin). connected = the token works (cached 5 minutes). */
export async function eventbriteStatus() {
  const ctx = await syncContext().catch(() => null);
  const row = ctx ? await Integration.findOne({ workspaceId: ctx.workspaceId, provider: "eventbrite" }).lean() : null;
  const local = {
    webhookActive: Boolean(row?.config?.webhookId),
    lastSyncAt: row?.config?.lastSyncAt || null,
    lastSync: row?.config?.lastSync || null,
    lastError: row?.config?.lastError || null,
    syncRunning: running,
  };
  if (!isEventbriteConfigured()) return { connected: false, organizationName: null, ...local, lastError: local.lastError || "EVENTBRITE_PRIVATE_TOKEN is not set on the server." };
  if (!statusCache.value || Date.now() - statusCache.at > STATUS_TTL_MS) {
    try {
      const org = await organization();
      statusCache = { at: Date.now(), value: { connected: true, organizationName: org.name || row?.config?.organizationName || null } };
    } catch (error) {
      statusCache = { at: Date.now(), value: { connected: false, organizationName: null, checkError: error.message } };
    }
  }
  const { checkError, ...value } = statusCache.value;
  return { ...value, ...local, lastError: local.lastError || checkError || null };
}

