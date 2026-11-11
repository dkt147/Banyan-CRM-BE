import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Booking } from "../models/Booking.js";
import { AppError } from "../utils/AppError.js";
import { prepareBookingPayload, displayStatus, EXPIRING_STATUSES } from "../services/booking.service.js";
import { Contact } from "../models/Contact.js";
import { contactSearchFilter } from "../services/contact.service.js";
import { escapeRegex } from "../utils/phone.js";
import { assertNotWpManaged, rejectWpRoomForCrmBooking } from "../services/wpRoomBooking.service.js";

const service = resourceRegistry.bookings.service;
const r = Router();
r.use(requireAuth);

// List: search matches title/room/type or the booking's contact (name, email, phone,
// company), status accepts a comma-separated list, and each row carries displayStatus
// (a lapsed hold shows as "expired").
const LIST_FILTERS = ["contactId", "dealId", "companyId", "resourceId", "source"];
r.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = req.query;
    const page = Math.max(Number(q.page) || 1, 1);
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
    const filter = { workspaceId: req.workspaceId };
    for (const key of LIST_FILTERS) if (q[key]) filter[key] = String(q[key]);
    const and = [];
    const now = new Date();
    if (q.status) {
      // Filter on the status users see: a lapsed hold counts as "expired", not "held".
      const statuses = String(q.status).split(",").map((v) => v.trim()).filter(Boolean);
      const live = { $or: [{ holdExpiresAt: null }, { holdExpiresAt: { $gt: now } }] };
      const plain = statuses.filter((v) => !EXPIRING_STATUSES.includes(v) && v !== "expired");
      const expiring = statuses.filter((v) => EXPIRING_STATUSES.includes(v));
      const clauses = [];
      if (plain.length) clauses.push({ status: { $in: plain } });
      if (expiring.length) clauses.push({ status: { $in: expiring }, ...live });
      if (statuses.includes("expired"))
        clauses.push({ status: "expired" }, { status: { $in: EXPIRING_STATUSES }, holdExpiresAt: { $lte: now } });
      and.push(clauses.length ? { $or: clauses } : { _id: null });
    }
    if (q.from || q.to) {
      filter.startAt = {};
      if (q.from) filter.startAt.$gte = new Date(q.from);
      if (q.to) filter.startAt.$lt = new Date(q.to);
    }
    const search = String(q.search || "").trim();
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: "i" };
      const contactIds = await Contact.find({ workspaceId: req.workspaceId, ...(await contactSearchFilter(req.workspaceId, search)) }).limit(500).distinct("_id");
      and.push({ $or: [{ title: rx }, { resourceName: rx }, { bookingType: rx }, { contactId: { $in: contactIds } }] });
    }
    if (and.length) filter.$and = and;
    const sortField = ["startAt", "createdAt"].includes(q.sort) ? q.sort : "startAt";
    const sort = { [sortField]: q.order === "asc" ? 1 : -1 };
    const [items, total] = await Promise.all([
      Booking.find(filter).sort(sort).skip((page - 1) * limit).limit(limit)
        .populate("contactId", "firstName lastName email phone").populate("companyId", "name").populate("dealId", "title").populate("createdBy", "name").lean(),
      Booking.countDocuments(filter),
    ]);
    res.json({
      success: true,
      data: {
        items: items.map((b) => ({ ...b, displayStatus: displayStatus(b, now) })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  }),
);

// Create/update validate contact links first (D1: every booking belongs to a contact,
// except unlinked Google Calendar events). List/get/delete stay on the generic CRUD.
r.post(
  "/",
  rejectWpRoomForCrmBooking,
  asyncHandler(async (req, res) => {
    const data = await prepareBookingPayload(req.workspaceId, req.user._id, req.body, { mode: "create" });
    res.status(201).json({ success: true, data: await service.create(req.workspaceId, req.user._id, data) });
  }),
);
r.patch(
  "/:id",
  rejectWpRoomForCrmBooking,
  asyncHandler(async (req, res) => {
    const existing = await Booking.findOne({ _id: req.params.id, workspaceId: req.workspaceId }).select("source companyId contactId externalRef");
    if (!existing) throw new AppError("Resource not found.", 404, "NOT_FOUND");
    // Re-linking the contact is allowed; everything else on a WordPress booking is owned by WordPress.
    if (existing.externalRef && Object.keys(req.body || {}).some((k) => !["contactId", "companyId", "dealId"].includes(k)))
      await assertNotWpManaged(req.workspaceId, req.params.id);
    const data = await prepareBookingPayload(req.workspaceId, req.user._id, req.body, { mode: "update", existing });
    res.json({ success: true, data: await service.update(req.workspaceId, req.params.id, req.user._id, data) });
  }),
);
r.delete(
  "/:id",
  asyncHandler(async (req, _res, next) => {
    await assertNotWpManaged(req.workspaceId, req.params.id);
    next();
  }),
);
r.use(resourceRouter(service));
export default r;
