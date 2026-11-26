import mongoose from "mongoose";
import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { Event } from "../models/Event.js";
import { EventRegistration } from "../models/EventRegistration.js";

// Eventbrite events and sign-ups, read-only (27 Nov b, A). Anyone signed in can read them.

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const paging = (q, max) => {
  const page = Math.max(Number(q.page) || 1, 1);
  const limit = Math.min(Math.max(Number(q.limit) || 25, 1), max);
  return { page, limit, skip: (page - 1) * limit };
};
const order = (q) => (String(q.order || "").toLowerCase() === "asc" ? 1 : -1);
const oid = (v, field) => {
  if (!mongoose.isValidObjectId(String(v))) throw new AppError(`${field} is not a valid id.`, 400, "INVALID_ID");
  return new mongoose.Types.ObjectId(String(v));
};

export const eventRoutes = Router();
eventRoutes.use(requireAuth);

/** GET /events?when=upcoming|past|all&search=&sort=startAt&order=&page=&limit= */
eventRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = req.query;
    const filter = { workspaceId: req.workspaceId };
    const now = new Date();
    const when = String(q.when || "all");
    if (!["upcoming", "past", "all"].includes(when)) throw new AppError("when must be upcoming, past or all.", 400, "VALIDATION_ERROR");
    // Upcoming = not ended yet (an event without an end counts by its start).
    if (when === "upcoming") filter.$or = [{ endAt: { $gte: now } }, { endAt: null, startAt: { $gte: now } }];
    if (when === "past") filter.$or = [{ endAt: { $lt: now } }, { endAt: null, startAt: { $lt: now } }];
    const search = String(q.search || "").trim().slice(0, 100);
    if (search) filter.name = new RegExp(escapeRx(search), "i");
    const { page, limit, skip } = paging(q, 100);
    const dir = q.order ? order(q) : when === "upcoming" ? 1 : -1;
    const [items, total] = await Promise.all([
      Event.find(filter).sort({ startAt: dir, _id: dir }).skip(skip).limit(limit).lean(),
      Event.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  }),
);

eventRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Event not found.", 404, "NOT_FOUND");
    const event = await Event.findOne({ _id: req.params.id, workspaceId: req.workspaceId }).lean();
    if (!event) throw new AppError("Event not found.", 404, "NOT_FOUND");
    res.json({ success: true, data: event });
  }),
);

export const eventRegistrationRoutes = Router();
eventRegistrationRoutes.use(requireAuth);

const REG_STATUSES = ["attending", "checked_in", "cancelled", "refunded", "not_attending"];

/** GET /event-registrations?eventId=&contactId=&companyId=&status=&sort=registeredAt|createdAt&order=&page=&limit= (max 200) */
eventRegistrationRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = req.query;
    const filter = { workspaceId: req.workspaceId };
    for (const k of ["eventId", "contactId", "companyId"]) if (q[k]) filter[k] = oid(q[k], k);
    if (q.status) {
      const list = String(q.status).split(",").filter(Boolean);
      if (!list.every((s) => REG_STATUSES.includes(s))) throw new AppError(`status must be one of ${REG_STATUSES.join(", ")}.`, 400, "VALIDATION_ERROR");
      filter.status = { $in: list };
    }
    const sortField = ["registeredAt", "createdAt"].includes(q.sort) ? q.sort : "registeredAt";
    const { page, limit, skip } = paging(q, 200);
    const [items, total] = await Promise.all([
      EventRegistration.find(filter)
        .sort({ [sortField]: order(q), _id: order(q) })
        .skip(skip)
        .limit(limit)
        .populate("eventId", "name startAt url")
        .populate("contactId", "firstName lastName email")
        .lean(),
      EventRegistration.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
  }),
);
