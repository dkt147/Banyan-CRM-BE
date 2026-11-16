/*
 * Room bookings → Google Calendar (feedback 17 Nov, #7).
 *
 * Library (and later Meeting Room) bookings are copied into shared room calendars that a partner
 * also uses. The client's rules, enforced here:
 *   - never change or delete an event the CRM did not create: every write goes through
 *     ownedEventWrite(), which first GETs the event and requires
 *     extendedProperties.private = { banyanSource: "crm-room-booking", banyanRef: <ref> };
 *   - no attendees, sendUpdates=none on every call (nobody is emailed);
 *   - Hong Kong time;
 *   - no automatic backfill: only bookings paid (or blocked) after a room's calendar was saved are
 *     pushed. GET …/backfill-preview lists the older ones without writing anything.
 * Event ids are deterministic ("b" + hex(ref)), so a retried push gets 409 instead of a duplicate.
 */
import { Booking } from "../models/Booking.js";
import { Integration } from "../models/Integration.js";
import { AppError } from "../utils/AppError.js";
import { HK_TZ } from "../utils/hkTime.js";
import { getProviderAccessToken } from "./providerApi.service.js";

export const BANYAN_EVENT_SOURCE = "crm-room-booking";
// The partner's Library calendar. Always treated as protected, even before settings are saved.
export const DEFAULT_LIBRARY_CALENDAR = "c_682acafdb6beb189d861f1a728b9c5bff9bf1d584e82cbf9d44f602ebecd952b@group.calendar.google.com";
export const ROOM_KEYS = ["small", "medium", "library"];
export const CALENDAR_ID_RX = /^[^\s@]+@(group\.calendar\.google\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,})$/i;
const GCAL = "https://www.googleapis.com/calendar/v3";

/* ---------- settings (Integration provider "wordpress", config.roomCalendars) ---------- */
const DEFAULTS = {
  calendars: { small: null, medium: null, library: DEFAULT_LIBRARY_CALENDAR },
  pushFrom: { small: null, medium: null, library: null },
  includePending: false,
  showPartnerEvents: true,
  partnerBlocks: { enabled: false },
};

export async function getRoomCalendarSettings(workspaceId) {
  const row = await Integration.findOne({ workspaceId, provider: "wordpress" }).select("config.roomCalendars").lean();
  const saved = row?.config?.roomCalendars;
  if (!saved) return { ...structuredClone(DEFAULTS), saved: false };
  return {
    calendars: { ...DEFAULTS.calendars, ...saved.calendars },
    pushFrom: { ...DEFAULTS.pushFrom, ...saved.pushFrom },
    includePending: Boolean(saved.includePending),
    showPartnerEvents: saved.showPartnerEvents !== false,
    partnerBlocks: { enabled: Boolean(saved.partnerBlocks?.enabled) },
    updatedAt: saved.updatedAt || null,
    saved: true,
  };
}

/** Calendar ids the CRM must treat as shared/read-only (saved room calendars + the partner Library calendar). */
export async function protectedCalendarIds(workspaceId) {
  const s = await getRoomCalendarSettings(workspaceId);
  return new Set([DEFAULT_LIBRARY_CALENDAR, ...Object.values(s.calendars)].filter(Boolean).map((id) => id.toLowerCase()));
}

export async function isGoogleCalendarConnected(workspaceId) {
  return Boolean(await Integration.exists({ workspaceId, provider: "google_calendar", status: "connected" }));
}

/* ---------- Google calls (status-aware; never throws on 404/409/410) ---------- */
async function gcal(workspaceId, path, { method = "GET", query = {}, body } = {}) {
  const token = await getProviderAccessToken(workspaceId, "google_calendar");
  const url = new URL(`${GCAL}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  return { status: res.status, data };
}
const eventPath = (calendarId, eventId) => `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;
const fail = (what, r) => new AppError(`Google Calendar ${what} failed (${r.status}): ${String(r.data?.error?.message || "").slice(0, 200)}`, 502, "GOOGLE_CALENDAR_API_ERROR");

/** Google event ids allow a–v and 0–9 only; hex of the ref fits and is stable. */
export const eventIdFor = (ref) => `b${Buffer.from(String(ref)).toString("hex")}`;

export function isOwnedEvent(event, ref) {
  const p = event?.extendedProperties?.private || {};
  return p.banyanSource === BANYAN_EVENT_SOURCE && (ref == null || p.banyanRef === ref);
}

/**
 * The only way this module changes an existing Google event. GETs it first and refuses unless it
 * carries our private markers for this ref. op: "patch" | "delete". Returns "done" | "gone".
 */
export async function ownedEventWrite(workspaceId, calendarId, eventId, ref, op, body) {
  const current = await gcal(workspaceId, eventPath(calendarId, eventId));
  if (current.status === 404 || current.status === 410) return "gone";
  if (current.status !== 200) throw fail("read", current);
  if (!isOwnedEvent(current.data, ref))
    throw new AppError(`Refusing to change Google event ${eventId}: it was not created by Banyan CRM for ${ref}.`, 409, "GOOGLE_EVENT_NOT_OURS");
  if (op === "delete") {
    if (current.data.status === "cancelled") return "gone";
    const r = await gcal(workspaceId, eventPath(calendarId, eventId), { method: "DELETE", query: { sendUpdates: "none" } });
    if (r.status === 404 || r.status === 410) return "gone";
    if (r.status >= 300) throw fail("delete", r);
    return "done";
  }
  const r = await gcal(workspaceId, eventPath(calendarId, eventId), { method: "PATCH", query: { sendUpdates: "none" }, body });
  if (r.status >= 300) throw fail("update", r);
  return "done";
}

/* ---------- event content ---------- */
export function eventBodyFor(booking) {
  const wp = booking.metadata?.wp || {};
  const c = wp.customer || {};
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Guest";
  const room = wp.roomName || booking.resourceName || "Room";
  const summary =
    wp.status === "blocked"
      ? `${room} – Blocked${c.notes ? `: ${c.notes}` : ""}`
      : `${wp.status === "pending" ? "Awaiting payment – " : ""}${room} – ${name} (${wp.ref})`;
  const description = [
    `Ref: ${wp.ref}`,
    wp.status !== "blocked" && c.email ? `Email: ${c.email}` : null,
    wp.status !== "blocked" && c.phone ? `Phone: ${c.phone}` : null,
    c.notes ? `Notes: ${c.notes}` : null,
    "",
    "Created by Banyan CRM from a WordPress room booking – please don't edit. Change bookings in WP Admin > Room Bookings.",
  ].filter((l) => l !== null).join("\n");
  return {
    summary: summary.slice(0, 250),
    description: description.slice(0, 8000),
    start: { dateTime: new Date(booking.startAt).toISOString(), timeZone: HK_TZ },
    end: { dateTime: new Date(booking.endAt).toISOString(), timeZone: HK_TZ },
    transparency: "opaque",
    status: "confirmed",
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    extendedProperties: { private: { banyanRef: wp.ref, banyanSource: BANYAN_EVENT_SOURCE } },
  };
}

/** Insert with the deterministic id; on 409 the event exists, so update it (only if it is ours). */
async function upsertOwnedEvent(workspaceId, calendarId, ref, body) {
  const id = eventIdFor(ref);
  const r = await gcal(workspaceId, eventPath(calendarId), { method: "POST", query: { sendUpdates: "none" }, body: { id, ...body } });
  if (r.status === 200 || r.status === 201) return { eventId: id, htmlLink: r.data?.htmlLink || null, action: "inserted" };
  if (r.status !== 409) throw fail("insert", r);
  await ownedEventWrite(workspaceId, calendarId, id, ref, "patch", body);
  return { eventId: id, action: "updated" };
}

/* ---------- what should be in the calendar for a booking ---------- */
function eligibleSince(booking) {
  const wp = booking.metadata?.wp || {};
  const when = wp.status === "paid" ? wp.payment?.paidAt || wp.createdAt : wp.createdAt;
  return when ? new Date(when) : new Date(booking.createdAt);
}

/** Desired state: { calendarId, present, reason }. */
export function desiredCalendarState(booking, settings) {
  const wp = booking.metadata?.wp || {};
  const calendarId = settings.calendars[wp.roomKey] || null;
  const showStatus = wp.status === "paid" || wp.status === "blocked" || (wp.status === "pending" && settings.includePending);
  if (!settings.saved) return { calendarId, present: false, reason: "settings_not_saved" };
  if (!calendarId) return { calendarId, present: false, reason: "no_calendar_for_room" };
  if (!showStatus) return { calendarId, present: false, reason: `status_${wp.status}` };
  if (new Date(booking.endAt) < new Date(Date.now() - 86400000)) return { calendarId, present: false, reason: "past" };
  const pushFrom = settings.pushFrom[wp.roomKey];
  const alreadyPushed = booking.metadata?.roomCalendar?.eventId && booking.metadata.roomCalendar.calendarId === calendarId;
  // No backfill: bookings paid/blocked before the calendar was saved stay out unless already pushed.
  if (!alreadyPushed && (!pushFrom || eligibleSince(booking) < new Date(pushFrom))) return { calendarId, present: false, reason: "before_push_start" };
  return { calendarId, present: true, reason: null };
}

const chains = new Map();
/** Serialise pushes per booking (webhook and sync can arrive together). */
function serial(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next);
  next.finally(() => { if (chains.get(key) === next) chains.delete(key); }).catch(() => {});
  return next;
}

/** Bring Google Calendar in line with one booking. Safe to call any number of times. */
export function syncBookingToRoomCalendar(bookingId) {
  return serial(String(bookingId), async () => {
    const booking = await Booking.findById(bookingId).lean();
    if (!booking?.externalRef || !booking.metadata?.wp) return { skipped: "not_a_room_booking" };
    const ws = booking.workspaceId;
    const settings = await getRoomCalendarSettings(ws);
    const want = desiredCalendarState(booking, settings);
    const prev = booking.metadata?.roomCalendar || {};
    if (!want.present && !prev.eventId) return { skipped: want.reason };
    if (!(await isGoogleCalendarConnected(ws))) return { skipped: "google_not_connected" };

    const ref = booking.externalRef;
    const state = { calendarId: null, eventId: null, syncedAt: new Date(), error: null, reason: want.reason };
    try {
      // Moved to another room's calendar, or should no longer be shown: remove our old event.
      if (prev.eventId && prev.calendarId && (!want.present || prev.calendarId !== want.calendarId))
        await ownedEventWrite(ws, prev.calendarId, prev.eventId, ref, "delete");
      if (want.present) {
        const r = await upsertOwnedEvent(ws, want.calendarId, ref, eventBodyFor(booking));
        Object.assign(state, { calendarId: want.calendarId, eventId: r.eventId, action: r.action });
      } else state.action = prev.eventId ? "removed" : "none";
    } catch (error) {
      Object.assign(state, { calendarId: prev.calendarId || null, eventId: prev.eventId || null, error: error.message });
      console.error(`[room-calendar] ${ref}:`, error.message);
    }
    await Booking.updateOne({ _id: booking._id }, { $set: { "metadata.roomCalendar": state } });
    return state;
  });
}

/** Fire-and-forget hook used by upsertWpBooking (never blocks or fails the webhook). */
export function queueRoomCalendarSync(bookingId) {
  setImmediate(() => syncBookingToRoomCalendar(bookingId).catch((e) => console.error("[room-calendar]", e.message)));
}

/** Dry run: bookings that are NOT pushed because they predate the calendar setting. Writes nothing. */
export async function backfillPreview(workspaceId) {
  const settings = await getRoomCalendarSettings(workspaceId);
  const rows = await Booking.find({
    workspaceId,
    externalRef: { $type: "string" },
    "metadata.wp.status": { $in: settings.includePending ? ["paid", "blocked", "pending"] : ["paid", "blocked"] },
    endAt: { $gt: new Date() },
  }).sort({ startAt: 1 }).limit(500).lean();
  const items = [];
  for (const b of rows) {
    const calendarId = settings.calendars[b.metadata.wp.roomKey];
    if (!calendarId || (b.metadata.roomCalendar?.eventId && b.metadata.roomCalendar.calendarId === calendarId)) continue;
    const ev = eventBodyFor(b);
    items.push({ ref: b.externalRef, roomKey: b.metadata.wp.roomKey, calendarId, status: b.metadata.wp.status, summary: ev.summary, startAt: b.startAt, endAt: b.endAt });
  }
  return {
    dryRun: true,
    note: "Nothing was written. These upcoming bookings predate the calendar setting, so they are not in Google Calendar. The partner may already have entered some by hand; add any missing ones manually.",
    items,
  };
}

/* ---------- settings write (with access check) ---------- */
/** Throws 400 when the connected Google account cannot write to calendarId. */
export async function assertCalendarWritable(workspaceId, calendarId) {
  const r = await gcal(workspaceId, `/users/me/calendarList/${encodeURIComponent(calendarId)}`);
  if (r.status === 404)
    throw new AppError(
      `The connected Google account can't see calendar ${calendarId}. Ask the calendar owner to share it with that account ("Make changes to events"), then add it in Google Calendar.`,
      400,
      "ROOM_CALENDAR_NOT_ACCESSIBLE",
    );
  if (r.status !== 200) throw fail("access check", r);
  if (!["owner", "writer"].includes(r.data?.accessRole))
    throw new AppError(
      `The connected Google account can only view calendar ${calendarId} (${r.data?.accessRole}). It needs "Make changes to events".`,
      400,
      "ROOM_CALENDAR_READ_ONLY",
    );
}

export async function saveRoomCalendarSettings(workspaceId, input, userId) {
  const current = await getRoomCalendarSettings(workspaceId);
  const calendars = { ...current.calendars };
  for (const key of ROOM_KEYS) {
    if (!(key in (input.calendars || {}))) continue;
    const v = input.calendars[key];
    const id = v == null || String(v).trim() === "" ? null : String(v).trim();
    if (id && !CALENDAR_ID_RX.test(id)) throw new AppError(`"${id}" is not a Google Calendar ID.`, 400, "INVALID_CALENDAR_ID");
    calendars[key] = id;
  }
  const connected = await isGoogleCalendarConnected(workspaceId);
  const warnings = [];
  if (connected) {
    for (const id of new Set(Object.values(calendars).filter(Boolean))) await assertCalendarWritable(workspaceId, id);
  } else warnings.push("Google Calendar isn't connected, so nothing will be added until it is (Settings > Integrations > Google).");

  // Push start per room: when its calendar is first set or changed. No backfill before that.
  const now = new Date().toISOString();
  const pushFrom = { ...current.pushFrom };
  for (const key of ROOM_KEYS) {
    if (!calendars[key]) pushFrom[key] = null;
    else if (!current.saved || calendars[key] !== current.calendars[key] || !pushFrom[key]) pushFrom[key] = now;
  }
  const value = {
    calendars,
    pushFrom,
    includePending: input.includePending != null ? Boolean(input.includePending) : current.includePending,
    showPartnerEvents: input.showPartnerEvents != null ? Boolean(input.showPartnerEvents) : current.showPartnerEvents,
    partnerBlocks: { enabled: input.partnerBlocks?.enabled != null ? Boolean(input.partnerBlocks.enabled) : current.partnerBlocks.enabled },
    updatedAt: now,
    updatedBy: userId ? String(userId) : null,
  };
  await Integration.findOneAndUpdate(
    { workspaceId, provider: "wordpress" },
    { $set: { "config.roomCalendars": value }, $setOnInsert: { workspaceId, provider: "wordpress", status: "pending", accountName: "banyanworkspace.com" } },
    { upsert: true },
  );
  return { settings: await getRoomCalendarSettings(workspaceId), warnings };
}

/** Public shape for GET /room-bookings/google-calendars. */
export async function roomCalendarStatus(workspaceId) {
  const s = await getRoomCalendarSettings(workspaceId);
  const last = await Booking.findOne({ workspaceId, "metadata.roomCalendar.syncedAt": { $exists: true } })
    .sort({ "metadata.roomCalendar.syncedAt": -1 }).select("metadata.roomCalendar").lean();
  return {
    calendars: s.calendars,
    includePending: s.includePending,
    showPartnerEvents: s.showPartnerEvents,
    partnerBlocks: s.partnerBlocks,
    pushFrom: s.pushFrom,
    saved: s.saved,
    connected: await isGoogleCalendarConnected(workspaceId),
    lastSync: last?.metadata?.roomCalendar?.syncedAt || null,
    lastError: last?.metadata?.roomCalendar?.error || null,
  };
}

/* ---------- guards for the general two-way Google Calendar sync ---------- */
export const ROOM_CALENDAR_READ_ONLY_MESSAGE = "This event is in a shared room calendar and is read-only in the CRM";

/** Throws 409 when a CalendarEvent belongs to a room calendar (or is marked read-only). */
export async function assertCalendarEventWritable(workspaceId, event) {
  if (!event) return;
  const calId = String(event.metadata?.googleCalendarId || "").toLowerCase();
  if (event.metadata?.readOnly || (calId && (await protectedCalendarIds(workspaceId)).has(calId)))
    throw new AppError(ROOM_CALENDAR_READ_ONLY_MESSAGE, 409, "ROOM_CALENDAR_READ_ONLY");
}

/** Throws 409 when the CRM's two-way sync calendar is a room calendar. */
export async function assertSyncCalendarWritable(workspaceId, calendarId) {
  if ((await protectedCalendarIds(workspaceId)).has(String(calendarId || "").toLowerCase()))
    throw new AppError(ROOM_CALENDAR_READ_ONLY_MESSAGE, 409, "ROOM_CALENDAR_READ_ONLY");
}

/** Import rules for events read from Google: skip our own pushes, mark room-calendar events read-only. */
export async function importRulesFor(workspaceId, calendarId) {
  const isRoom = (await protectedCalendarIds(workspaceId)).has(String(calendarId || "").toLowerCase());
  const settings = isRoom ? await getRoomCalendarSettings(workspaceId) : null;
  return {
    isRoom,
    skipCalendar: isRoom && settings.showPartnerEvents === false,
    // Our own booking events are already shown as bookings.
    skipEvent: (external) => isRoom && isOwnedEvent(external),
    readOnly: isRoom,
  };
}

