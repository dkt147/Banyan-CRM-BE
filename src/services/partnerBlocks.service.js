/*
 * Partner events → WordPress blocks (feedback 17 Nov, #7.4, option 3).
 *
 * Events the partner adds directly in a room calendar are unknown to WordPress, so the website could
 * sell those hours. This service turns them into WordPress "blocked" time through a token-protected
 * plugin endpoint that does NOT exist yet — see docs/WP_PARTNER_BLOCKS_SPEC.md:
 *   POST   /wp-json/banyan/v1/blocks        { room, date, start, hours, reason, external_id } → { ref }
 *   DELETE /wp-json/banyan/v1/blocks/{ref}
 * Until WordPress has it (and the setting partnerBlocks.enabled is on) only the dry-run preview runs.
 *
 * Only events the CRM did not create are considered; our own booking events are skipped. Partner
 * events are only read here — this module never writes to Google Calendar.
 */
import { env } from "../config/env.js";
import { Booking } from "../models/Booking.js";
import { Integration } from "../models/Integration.js";
import { AppError } from "../utils/AppError.js";
import { getProviderAccessToken } from "./providerApi.service.js";
import { getRoomCalendarSettings, isGoogleCalendarConnected, isOwnedEvent, ROOM_KEYS } from "./roomCalendar.service.js";
import { WP_BOOKING_RULES } from "./wpRoomBooking.service.js";

const OPEN = WP_BOOKING_RULES.open;
const CLOSE = WP_BOOKING_RULES.close;
const WINDOW_DAYS = WP_BOOKING_RULES.maxDays;
export const WP_BLOCKS_UNSUPPORTED = "WordPress doesn't support automatic blocks yet (POST /blocks). See docs/WP_PARTNER_BLOCKS_SPEC.md.";

/* ---------- time helpers (Hong Kong, UTC+8, no DST) ---------- */
const HK_MS = 8 * 3600 * 1000;
const hkDate = (d) => new Date(new Date(d).getTime() + HK_MS).toISOString().slice(0, 10);
const hkHourFloat = (d) => { const s = new Date(new Date(d).getTime() + HK_MS); return s.getUTCHours() + s.getUTCMinutes() / 60; };
const addDay = (ymd, n = 1) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isoDow = (ymd) => { const w = new Date(`${ymd}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };

/**
 * Whole-hour WordPress blocks for one Google event: one per open weekday it touches, rounded
 * outwards to full hours and clipped to opening hours. [{ date, start, hours }]
 */
export function eventToSlots(event) {
  const slots = [];
  if (event.start?.date) {
    for (let d = event.start.date; d < (event.end?.date || addDay(event.start.date)); d = addDay(d))
      if (WP_BOOKING_RULES.days.includes(isoDow(d))) slots.push({ date: d, start: OPEN, hours: CLOSE - OPEN });
    return slots;
  }
  const start = new Date(event.start?.dateTime);
  const end = new Date(event.end?.dateTime);
  if (!(start < end)) return slots;
  for (let d = hkDate(start); d <= hkDate(new Date(end.getTime() - 1)); d = addDay(d)) {
    if (!WP_BOOKING_RULES.days.includes(isoDow(d))) continue;
    const from = d === hkDate(start) ? Math.floor(hkHourFloat(start)) : 0;
    const to = d === hkDate(end) ? Math.ceil(hkHourFloat(end)) : 24;
    const s = Math.max(from, OPEN);
    const e = Math.min(to, CLOSE);
    if (e > s) slots.push({ date: d, start: s, hours: e - s });
  }
  return slots;
}

/* ---------- Google (read-only) ---------- */
async function listPartnerEvents(workspaceId, calendarId) {
  const token = await getProviderAccessToken(workspaceId, "google_calendar");
  const timeMin = new Date();
  const timeMax = new Date(Date.now() + (WINDOW_DAYS + 1) * 86400000);
  const items = [];
  let pageToken = null;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    for (const [k, v] of Object.entries({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "500" })) url.searchParams.set(k, v);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(`Google Calendar read failed (${res.status}): ${data?.error?.message || ""}`.slice(0, 300), 502, "GOOGLE_CALENDAR_API_ERROR");
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  // Partner events that make the room busy: not ours, not cancelled, not marked "free".
  return items.filter((e) => e.id && e.status !== "cancelled" && e.transparency !== "transparent" && !isOwnedEvent(e));
}

/* ---------- WordPress blocks API (token, server-side) ---------- */
async function wpBlocks(method, path, body) {
  if (!env.BANYAN_CRM_TOKEN) throw new AppError("WordPress sync isn't configured on the server (BANYAN_CRM_TOKEN).", 503, "WP_BOOKING_NOT_CONFIGURED");
  const res = await fetch(new URL(path, env.BANYAN_WP_API_URL), {
    method,
    headers: { Accept: "application/json", "X-Banyan-Token": env.BANYAN_CRM_TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
// Only WordPress's "no such route" means the plugin lacks the endpoint; a plain 404 on DELETE is "unknown ref".
const unsupported = (r) => r.status === 404 && r.data?.code === "rest_no_route";

/* ---------- state (Integration provider "wordpress", config.partnerBlocks) ---------- */
async function loadState(workspaceId) {
  const row = await Integration.findOne({ workspaceId, provider: "wordpress" }).select("config.partnerBlocks").lean();
  return row?.config?.partnerBlocks || { map: {} };
}
async function saveState(workspaceId, state) {
  await Integration.findOneAndUpdate(
    { workspaceId, provider: "wordpress" },
    { $set: { "config.partnerBlocks": state }, $setOnInsert: { workspaceId, provider: "wordpress", status: "pending", accountName: "banyanworkspace.com" } },
    { upsert: true },
  );
}

export async function partnerBlockStatus(workspaceId) {
  const settings = await getRoomCalendarSettings(workspaceId);
  const state = await loadState(workspaceId);
  return {
    enabled: settings.partnerBlocks.enabled,
    supported: state.supported ?? null, // null = not tried yet
    blocks: Object.values(state.map || {}).length,
    rooms: settings.partnerBlocks.rooms,
    clashes: state.clashes || [],
    // Partner events not blocked because they overlap a website booking, plus any WordPress refused.
    conflicts: [
      ...(state.conflicts || []),
      ...(state.blockConflicts || []).map((c) => ({
        title: String(c.reason || "").replace(/^Partner: /, ""), room: c.room, date: c.date,
        time: `${String(c.start).padStart(2, "0")}:00–${String(c.start + c.hours).padStart(2, "0")}:00`,
        bookingRef: c.conflicts?.[0]?.ref || null, bookingStatus: null, message: c.message,
      })),
    ],
    blockConflicts: state.blockConflicts || [],
    lastRun: state.lastRun || null,
    lastError: state.lastError || null,
  };
}

/**
 * Compare partner events with the blocks already created and apply the difference.
 * dryRun: compute only. Returns { dryRun, create, remove, unchanged, clashes, skipped }.
 */
export async function syncPartnerBlocks(workspaceId, { dryRun = true } = {}) {
  const settings = await getRoomCalendarSettings(workspaceId);
  if (!dryRun && !settings.partnerBlocks.enabled)
    throw new AppError("Turn on \"Block partner events in WordPress\" in the room calendar settings first.", 409, "PARTNER_BLOCKS_DISABLED");
  if (!(await isGoogleCalendarConnected(workspaceId)))
    throw new AppError("Google Calendar isn't connected (Settings > Integrations > Google).", 409, "INTEGRATION_NOT_CONNECTED");

  // Per-room ticks (25 Nov, §4): only rooms that are ticked and have a calendar are scanned.
  // A calendar shared by several rooms can't say which room the partner uses: skip it.
  const roomsByCalendar = new Map();
  for (const room of ROOM_KEYS) {
    const id = settings.calendars[room];
    if (id) roomsByCalendar.set(id, [...(roomsByCalendar.get(id) || []), room]);
  }
  const ticked = settings.partnerBlocks.rooms || {};
  const wanted = new Map(); // key -> { room, date, start, hours, reason, eventId, calendarId, title }
  const skipped = [];
  for (const [calendarId, rooms] of roomsByCalendar) {
    if (rooms.length > 1) { skipped.push({ calendarId, reason: `used by several rooms (${rooms.join(", ")})` }); continue; }
    const room = rooms[0];
    if (!ticked[room]) { skipped.push({ room, calendarId, reason: "room not ticked" }); continue; }
    for (const event of await listPartnerEvents(workspaceId, calendarId)) {
      // All-day entries (holidays, notes, out-of-office) don't block a room; timed events do.
      if (event.start?.date) { skipped.push({ room, eventId: event.id, title: String(event.summary || "").slice(0, 120), reason: "all-day event" }); continue; }
      for (const slot of eventToSlots(event))
        wanted.set(`${event.id}|${slot.date}`, {
          room, ...slot, eventId: event.id, calendarId,
          title: String(event.summary || "Busy").slice(0, 120),
          reason: `Partner: ${String(event.summary || "busy").slice(0, 120)}`,
          external_id: `gcal:${event.id}:${slot.date}`,
        });
    }
  }

  const state = await loadState(workspaceId);
  const map = { ...(state.map || {}) };

  // Never block over a paid (or held) website booking: those slots are conflicts for staff to sort out.
  const clashes = [];
  const conflicts = [];
  for (const [key, want] of wanted) {
    if (map[key]) continue; // already blocked by the CRM
    const s = new Date(`${want.date}T${String(want.start).padStart(2, "0")}:00:00+08:00`);
    const e = new Date(s.getTime() + want.hours * 3600000);
    const hits = await Booking.find({
      workspaceId, externalRef: { $type: "string" }, "metadata.wp.roomKey": want.room,
      "metadata.wp.status": { $in: ["paid", "pending"] }, startAt: { $lt: e }, endAt: { $gt: s },
    }).select("externalRef startAt endAt metadata.wp.status").lean();
    if (!hits.length) continue;
    wanted.delete(key);
    for (const h of hits) {
      clashes.push({ ref: h.externalRef, status: h.metadata.wp.status, room: want.room, date: want.date, partnerEventId: want.eventId, partnerEvent: want.reason });
      conflicts.push({
        title: want.title, room: want.room, date: want.date,
        time: `${String(want.start).padStart(2, "0")}:00–${String(want.start + want.hours).padStart(2, "0")}:00`,
        bookingRef: h.externalRef, bookingStatus: h.metadata.wp.status, eventId: want.eventId,
      });
    }
  }

  const same = (a, b) => a.room === b.room && a.date === b.date && a.start === b.start && a.hours === b.hours;
  const create = [];
  const remove = [];
  let unchanged = 0;
  for (const [key, want] of wanted) {
    const have = map[key];
    if (have && same(have, want)) unchanged += 1;
    else { if (have) remove.push({ key, ...have }); create.push({ key, ...want }); }
  }
  // Only blocks the CRM created (in map) are ever removed, e.g. after a room is unticked.
  for (const [key, have] of Object.entries(map)) if (!wanted.has(key)) remove.push({ key, ...have });

  if (conflicts.length && !dryRun)
    for (const c of conflicts) console.warn(`[partner-blocks] conflict: "${c.title}" ${c.room} ${c.date} ${c.time} overlaps ${c.bookingRef} (${c.bookingStatus})`);
  const result = { dryRun, rooms: ticked, create, remove, unchanged, clashes, conflicts, skipped, supported: state.supported ?? null };
  if (dryRun) return result;

  const errors = [];
  // Partner events WordPress refused because they overlap a paid booking or unexpired hold (409).
  const blockConflicts = [];
  for (const r of remove) {
    if (!r.ref) { delete map[r.key]; continue; }
    const res = await wpBlocks("DELETE", `blocks/${encodeURIComponent(r.ref)}`);
    if (unsupported(res)) { await saveState(workspaceId, { ...state, map, supported: false, lastRun: new Date().toISOString(), lastError: WP_BLOCKS_UNSUPPORTED }); throw new AppError(WP_BLOCKS_UNSUPPORTED, 501, "WP_BLOCKS_UNSUPPORTED"); }
    if (res.status < 300 || res.status === 404) delete map[r.key];
    else errors.push({ key: r.key, message: res.data?.message || `HTTP ${res.status}` });
  }
  for (const c of create) {
    const res = await wpBlocks("POST", "blocks", { room: c.room, date: c.date, start: c.start, hours: c.hours, reason: c.reason, external_id: c.external_id });
    if (unsupported(res)) { await saveState(workspaceId, { ...state, map, supported: false, lastRun: new Date().toISOString(), lastError: WP_BLOCKS_UNSUPPORTED }); throw new AppError(WP_BLOCKS_UNSUPPORTED, 501, "WP_BLOCKS_UNSUPPORTED"); }
    if (res.status < 300 && res.data?.ref) map[c.key] = { ref: res.data.ref, room: c.room, date: c.date, start: c.start, hours: c.hours, eventId: c.eventId, calendarId: c.calendarId };
    else if (res.status === 409) blockConflicts.push({ key: c.key, room: c.room, date: c.date, start: c.start, hours: c.hours, reason: c.reason, conflicts: res.data?.conflicts || [], message: res.data?.message || "Overlaps a booking." });
    else errors.push({ key: c.key, status: res.status, message: res.data?.message || `HTTP ${res.status}` });
  }
  await saveState(workspaceId, {
    map, supported: true, clashes, conflicts, blockConflicts, lastRun: new Date().toISOString(),
    lastError: errors.length ? `${errors.length} block(s) failed: ${errors[0].message}` : null,
  });
  return { ...result, supported: true, errors, blockConflicts };
}

/** Background job: only when enabled and WordPress is known (or not yet known) to support blocks. */
const jobRunning = new Set();
export async function runPartnerBlocksJob(workspaceId) {
  // The 3-minute timer and the poll trigger can coincide: one run at a time per workspace.
  const key = String(workspaceId);
  if (jobRunning.has(key)) return;
  jobRunning.add(key);
  try {
    await runPartnerBlocksJobNow(workspaceId);
  } finally {
    jobRunning.delete(key);
  }
}

async function runPartnerBlocksJobNow(workspaceId) {
  try {
    const settings = await getRoomCalendarSettings(workspaceId);
    if (!settings.partnerBlocks.enabled) return;
    const state = await loadState(workspaceId);
    if (state.supported === false && state.lastRun && Date.now() - Date.parse(state.lastRun) < 6 * 3600000) return; // retry every 6 h
    const r = await syncPartnerBlocks(workspaceId, { dryRun: false });
    if (r.create.length || r.remove.length || r.clashes.length)
      console.log(`[partner-blocks] +${r.create.length} -${r.remove.length}, ${r.clashes.length} clash(es)`);
  } catch (error) {
    console.error("[partner-blocks]", error.message);
  }
}

