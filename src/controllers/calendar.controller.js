import { asyncHandler } from "../utils/asyncHandler.js";
import { Booking } from "../models/Booking.js";
import { CalendarEvent } from "../models/CalendarEvent.js";
import { AppError } from "../utils/AppError.js";
export const availability = asyncHandler(async (req, res) => {
  const start = new Date(req.query.startAt),
    end = new Date(req.query.endAt);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()))
    throw new AppError(
      "Valid startAt and endAt are required",
      400,
      "INVALID_DATES",
    );
  const conflicts = await Booking.find({
    workspaceId: req.workspaceId,
    status: { $in: ["held", "pending", "confirmed"] },
    startAt: { $lt: end },
    endAt: { $gt: start },
  }).sort({ startAt: 1 });
  res.json({
    success: true,
    data: { available: conflicts.length === 0, conflicts },
  });
});
export const hold = asyncHandler(async (req, res) => {
  const start = new Date(req.body.startAt),
    end = new Date(req.body.endAt);
  const conflict = await Booking.exists({
    workspaceId: req.workspaceId,
    status: { $in: ["held", "pending", "confirmed"] },
    startAt: { $lt: end },
    endAt: { $gt: start },
  });
  if (conflict)
    throw new AppError("Slot is not available", 409, "SLOT_UNAVAILABLE");
  const b = await Booking.create({
    ...req.body,
    workspaceId: req.workspaceId,
    createdBy: req.user._id,
    status: "held",
    holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  res.status(201).json({ success: true, data: b });
});
export const confirm = asyncHandler(async (req, res) => {
  const b = await Booking.findOneAndUpdate(
    {
      _id: req.params.id,
      workspaceId: req.workspaceId,
      status: { $in: ["held", "pending"] },
    },
    { status: "confirmed", holdExpiresAt: null },
    { new: true },
  );
  if (!b)
    throw new AppError(
      "Booking not found or not confirmable",
      404,
      "NOT_FOUND",
    );
  res.json({ success: true, data: b });
});
export const cancel = asyncHandler(async (req, res) => {
  const b = await Booking.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    { status: "cancelled" },
    { new: true },
  );
  if (!b) throw new AppError("Booking not found", 404, "NOT_FOUND");
  res.json({ success: true, data: b });
});
export const events = asyncHandler(async (req, res) => {
  const filter = { workspaceId: req.workspaceId };
  if (req.query.from) filter.startAt = { $gte: new Date(req.query.from) };
  if (req.query.to)
    filter.endAt = { ...(filter.endAt || {}), $lte: new Date(req.query.to) };
  const rows = await CalendarEvent.find(filter)
    .populate("contactId companyId dealId assignedTo")
    .sort({ startAt: 1 });
  res.json({ success: true, data: rows });
});
