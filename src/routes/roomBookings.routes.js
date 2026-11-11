/*
 * /api/v1/room-bookings — WordPress meeting-room bookings for CRM staff.
 *
 * Reads come from the CRM cache (Booking rows with externalRef), kept fresh by the
 * WordPress webhook and the updated_since sync job. New bookings are NOT created here:
 * the staff browser calls WordPress /availability, /checkout and /session directly
 * (public endpoints), using GET /config for the rules, then calls POST /sync.
 */
import { Router } from "express";
import { env } from "../config/env.js";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { Booking } from "../models/Booking.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { escapeRegex } from "../utils/phone.js";
import {
  CRM_NOTES_PREFIX,
  WP_BOOKING_RULES,
  WP_ROOMS,
  WP_SYNC_NOT_CONFIGURED_MESSAGE,
  getWpLastSync,
  roomLabel,
  syncWpIfStale,
  syncWpIncremental,
  syncWpRange,
  toRoomBookingRow,
} from "../services/wpRoomBooking.service.js";

const r = Router();
r.use(requireAuth);

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

// Everything the booking modal needs (spec §3 and §7 window.BNRB).
r.get(
  "/config",
  asyncHandler(async (req, res) => {
    const staffName = req.user.name || req.user.email;
    res.json({
      success: true,
      data: {
        rest: env.BANYAN_WP_API_URL,
        rooms: WP_ROOMS.map(({ key, name, capacity, price }) => ({ key, name, capacity, price, label: roomLabel({ name, capacity }) })),
        ...WP_BOOKING_RULES,
        enabled: true,
        timezone: "Asia/Hong_Kong",
        returnUrl: env.BANYAN_BOOKING_RETURN_URL,
        staffName,
        notesPrefix: `${CRM_NOTES_PREFIX} by ${staffName}`,
        syncConfigured: Boolean(env.BANYAN_CRM_TOKEN),
        // { at, mode, created, updated, failed, error } or null before the first run.
        lastSync: await getWpLastSync(req.workspaceId),
        syncIntervalMinutes: env.BANYAN_BOOKING_SYNC_MINUTES,
      },
    });
  }),
);

// Filters match WP admin: active (paid+pending+blocked) | paid | blocked | pending | cancelled | expired | all.
function statusClause(filter, now) {
  const livePending = { "metadata.wp.status": "pending", holdExpiresAt: { $gt: now } };
  const lapsedPending = { "metadata.wp.status": "pending", $or: [{ holdExpiresAt: null }, { holdExpiresAt: { $lte: now } }] };
  switch (filter) {
    case "all": return null;
    case "paid": return { "metadata.wp.status": "paid" };
    case "blocked": return { "metadata.wp.status": "blocked" };
    case "pending": return livePending;
    case "cancelled": return { "metadata.wp.status": "cancelled" };
    case "expired": return { $or: [{ "metadata.wp.status": { $in: ["expired", "error"] } }, lapsedPending] };
    case "active": return { $or: [{ "metadata.wp.status": { $in: ["paid", "blocked"] } }, livePending] };
    default: throw new AppError("status must be active, paid, blocked, pending, cancelled, expired or all.", 400, "INVALID_FILTER");
  }
}

r.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = req.query;
    // Pending holds, expiries and admin blocks have no webhook: refresh in the background when
    // the last sync is over a minute old. This response uses the current cache; the next poll sees the result.
    syncWpIfStale(60 * 1000);
    const now = new Date();
    const page = Math.max(Number(q.page) || 1, 1);
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
    const range = ["upcoming", "past", "all"].includes(q.range) ? q.range : "upcoming";
    const and = [{ workspaceId: req.workspaceId, externalRef: { $type: "string" } }];

    const sc = statusClause(String(q.status || "active"), now);
    if (sc) and.push(sc);
    if (range === "upcoming") and.push({ endAt: { $gt: now } });
    if (range === "past") and.push({ endAt: { $lte: now } });
    // from/to: inclusive Hong Kong dates (calendar views).
    if (q.from || q.to) {
      if ((q.from && !DATE_RX.test(q.from)) || (q.to && !DATE_RX.test(q.to)))
        throw new AppError("from/to must be YYYY-MM-DD.", 400, "INVALID_DATES");
      const startAt = {};
      if (q.from) startAt.$gte = new Date(`${q.from}T00:00:00+08:00`);
      if (q.to) startAt.$lt = new Date(new Date(`${q.to}T00:00:00+08:00`).getTime() + 86400000);
      and.push({ startAt });
    }
    if (q.room) and.push({ "metadata.wp.roomKey": String(q.room) });
    if (q.contactId) and.push({ contactId: String(q.contactId) });
    const search = String(q.search || "").trim();
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: "i" };
      and.push({
        $or: [
          { externalRef: rx },
          { "metadata.wp.customer.firstName": rx },
          { "metadata.wp.customer.lastName": rx },
          { "metadata.wp.customer.email": rx },
          { "metadata.wp.customer.phone": rx },
          { title: rx },
        ],
      });
    }

    const filter = { $and: and };
    const order = q.order === "asc" || q.order === "desc" ? q.order : range === "upcoming" ? "asc" : "desc";
    const [rows, total] = await Promise.all([
      Booking.find(filter)
        .sort({ startAt: order === "asc" ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("contactId", "firstName lastName email phone")
        .select("-metadata.wpRawPayload")
        .lean(),
      Booking.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: {
        items: rows.map((b) => toRoomBookingRow(b, now)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  }),
);

// Pull from WordPress now. Body { from, to } (YYYY-MM-DD) re-reads that date range;
// empty body runs the incremental updated_since sync. Call it after a CRM checkout is paid.
r.post(
  "/sync",
  requirePermission("bookings.write"),
  asyncHandler(async (req, res) => {
    if (!env.BANYAN_CRM_TOKEN) throw new AppError(WP_SYNC_NOT_CONFIGURED_MESSAGE, 503, "WP_BOOKING_NOT_CONFIGURED");
    const { from, to } = req.body || {};
    if (from || to) {
      if (!DATE_RX.test(from || "") || !DATE_RX.test(to || "")) throw new AppError("from and to must both be YYYY-MM-DD.", 400, "INVALID_DATES");
      const days = (new Date(to) - new Date(from)) / 86400000;
      if (days < 0 || days > 400) throw new AppError("The sync range must be 0–400 days.", 400, "INVALID_DATES");
      return res.json({ success: true, data: { mode: "range", ...(await syncWpRange(from, to)) } });
    }
    res.json({ success: true, data: await syncWpIncremental() });
  }),
);

r.get(
  "/:ref",
  asyncHandler(async (req, res) => {
    const b = await Booking.findOne({ workspaceId: req.workspaceId, externalRef: String(req.params.ref).toUpperCase() })
      .populate("contactId", "firstName lastName email phone")
      .lean();
    if (!b) throw new AppError("Booking not found.", 404, "NOT_FOUND");
    res.json({ success: true, data: { ...toRoomBookingRow(b), notes: b.notes || "", raw: b.metadata?.wpRawPayload || null } });
  }),
);

export default r;
