import { asyncHandler } from "../utils/asyncHandler.js";
import { Booking } from "../models/Booking.js";
import { CalendarEvent } from "../models/CalendarEvent.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { AppError } from "../utils/AppError.js";
import { Deal } from "../models/Deal.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Task } from "../models/Task.js";
import { Notification } from "../models/Notification.js";
import { Invoice } from "../models/Invoice.js";

const ACTIVE_BOOKING_STATUSES = ["held", "pending", "confirmed"];
const VENUE_TYPES = ["studio", "venue", "photoshoot", "podcast"];
const TRIAL_TYPES = ["trial", "viewing"];
const BOOKING_TYPE_LABELS = {
  day_pass: "Day pass",
  meeting_room: "Meeting room",
  studio: "Studio",
  venue: "Venue",
  photoshoot: "Photoshoot",
  podcast: "Podcast",
  event_space: "Event space",
  trial: "Trial",
  viewing: "Viewing",
};
const CREDIT_WARNING_RATIO = 0.85;
const NEW_CONTACT_WINDOW_MS = 5 * 60 * 1000;
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
    ...(req.query.resourceName ? { resourceName: String(req.query.resourceName) } : {}),
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
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start)
    throw new AppError("Valid startAt and endAt (end after start) are required", 400, "INVALID_DATES");
  // Conflicts are scoped to the same room when one is named, so two different rooms can be held at once.
  const conflict = await Booking.exists({
    workspaceId: req.workspaceId,
    status: { $in: ACTIVE_BOOKING_STATUSES },
    ...(req.body.resourceName ? { resourceName: req.body.resourceName } : {}),
    startAt: { $lt: end },
    endAt: { $gt: start },
  });
  if (conflict)
    throw new AppError("Slot is not available", 409, "SLOT_UNAVAILABLE");
  const holdMinutes = Math.max(1, Number(req.body.holdMinutes) || 15);
  const b = await Booking.create({
    ...req.body,
    workspaceId: req.workspaceId,
    createdBy: req.user._id,
    status: "held",
    holdExpiresAt: req.body.holdExpiresAt
      ? new Date(req.body.holdExpiresAt)
      : new Date(Date.now() + holdMinutes * 60 * 1000),
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
  // Website-originated Self-Serve bookings create a local no-tax invoice draft automatically.
  // Xero sync is intentionally separate until the client provides item/account-code rules.
  if (b.source === "website" && Number(b.price || 0) > 0 && b.contactId) {
    const alreadyInvoiced = await Invoice.exists({ workspaceId: req.workspaceId, "metadata.bookingId": String(b._id) });
    if (!alreadyInvoiced) await Invoice.create({ workspaceId: req.workspaceId, contactId: b.contactId, companyId: b.companyId, dealId: b.dealId, description: `${b.title || b.bookingType || "Self-Serve booking"} — ${b.resourceName || "Banyan Workspace"}`, subtotal: Number(b.price), tax: 0, total: Number(b.price), currency: b.currency || "HKD", status: "draft", source: "self_serve_booking", createdBy: req.user._id, metadata: { bookingId: String(b._id), invoiceType: "self_serve", xeroSyncPending: true } });
  }

  if (b.dealId) {
    const deal = await Deal.findOne({ _id: b.dealId, workspaceId: req.workspaceId });
    if (deal) {
      const pipeline = await (await import("../models/Pipeline.js")).Pipeline.findOne({ _id: deal.pipelineId, workspaceId: req.workspaceId }).select("key").lean();
      const type = String(b.bookingType || "").toLowerCase();
      const keys = type === "viewing" ? ["viewing-scheduled", "viewing"] : type === "trial" ? ["trial-day-booked", "trial-booked"] : pipeline?.key === "transactional" ? ["confirmed"] : [];
      if (!keys.length) { /* No approved automatic stage exists for this booking type. */ }
      else {
      const stage = await PipelineStage.findOne({ workspaceId: req.workspaceId, pipelineId: deal.pipelineId, key: { $in: keys }, isActive: true }).sort({ sortOrder: 1 });
      if (stage) {
        deal.stageId = stage._id; deal.stageChangedAt = new Date(); deal.lastActivityAt = new Date(); await deal.save();
        const title = `Prepare for ${b.bookingType}: ${deal.title}`.slice(0, 200);
        const exists = await Task.exists({ workspaceId: req.workspaceId, dealId: deal._id, title, status: { $nin: ["completed", "cancelled"] } });
        if (!exists) await Task.create({ workspaceId: req.workspaceId, title, description: `${b.bookingType} booked for ${new Date(b.startAt).toLocaleString("en-GB", { timeZone: "Asia/Hong_Kong" })}.`, contactId: deal.contactId, companyId: deal.companyId, dealId: deal._id, assignedTo: deal.ownerId || req.user._id, createdBy: req.user._id, dueAt: new Date(b.startAt), priority: "high", source: "automation", metadata: { trigger: "booking_confirmed", bookingId: String(b._id) } });
        await Notification.create({ workspaceId: req.workspaceId, userId: deal.ownerId || req.user._id, type: "deal_stage_changed", title: `${b.bookingType} booked`, body: `${deal.title} stage updated to ${stage.name}.`, entityType: "deal", entityId: deal._id, channel: "in_app" });
      }
      }
    }
  }
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

const personName = (value) =>
  value && typeof value === "object"
    ? value.fullName || [value.firstName, value.lastName].filter(Boolean).join(" ") || value.name || ""
    : "";
const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3600000;
const bookingLabel = (type) =>
  BOOKING_TYPE_LABELS[type] ||
  String(type || "Booking").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function bookingCategory(booking) {
  if (booking.status === "held") return "hold";
  if (VENUE_TYPES.includes(booking.bookingType)) return "venue";
  if (TRIAL_TYPES.includes(booking.bookingType)) return "trial";
  return "confirmed";
}

function bookingItem(booking) {
  const who = personName(booking.contactId) || (booking.companyId?.name ?? "");
  const subtitle =
    booking.subtitle ||
    [who, booking.attendees ? `${booking.attendees} pax` : ""].filter(Boolean).join(" · ");
  return {
    id: String(booking._id),
    kind: "booking",
    category: bookingCategory(booking),
    title: booking.title || booking.resourceName || bookingLabel(booking.bookingType),
    subtitle,
    bookingType: booking.bookingType || "",
    resourceName: booking.resourceName || "",
    status: booking.status,
    startAt: booking.startAt,
    endAt: booking.endAt,
    holdExpiresAt: booking.holdExpiresAt || null,
    source: booking.source || "manual",
  };
}

function eventItem(event) {
  const trial = TRIAL_TYPES.includes(event.type);
  return {
    id: String(event._id),
    kind: "event",
    category: trial ? "trial" : "confirmed",
    title: event.title,
    subtitle: event.location || personName(event.contactId) || "",
    bookingType: event.type || "",
    resourceName: event.location || "",
    status: event.status,
    startAt: event.startAt,
    endAt: event.endAt,
    holdExpiresAt: null,
    source: event.externalProvider === "google_calendar" ? "google" : "manual",
  };
}

function buildConflicts(bookings) {
  const active = bookings.filter(
    (b) => ACTIVE_BOOKING_STATUSES.includes(b.status) && b.resourceName,
  );
  const conflicts = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i], b = active[j];
      if (a.resourceName !== b.resourceName) continue;
      if (!(a.startAt < b.endAt && a.endAt > b.startAt)) continue;
      // The provisional hold is the one to release; a hold never silently wins over a confirmed booking.
      const hold = a.status === "held" ? a : b.status === "held" ? b : null;
      const other = hold === a ? b : a;
      const holdItem = hold ? bookingItem(hold) : null;
      const otherItem = bookingItem(other);
      const holdTitle = holdItem ? holdItem.title : bookingItem(a).title;
      const otherTitle = hold ? otherItem.subtitle || otherItem.title : bookingItem(b).title;
      conflicts.push({
        id: `${a._id}:${b._id}`,
        resourceName: a.resourceName,
        releaseId: hold ? String(hold._id) : null,
        startAt: new Date(Math.max(a.startAt, b.startAt)),
        endAt: new Date(Math.min(a.endAt, b.endAt)),
        holdTitle,
        otherTitle,
        message: hold
          ? `The ${holdTitle.replace(/^hold\s*[—-]\s*/i, "")} hold overlaps the ${otherTitle} booking in ${a.resourceName}. ${a.resourceName} cannot take both — release one before confirming.`
          : `${bookingItem(a).title} and ${bookingItem(b).title} overlap in ${a.resourceName}.`,
      });
    }
  }
  return conflicts;
}

// One payload for the availability screen: grid items, meeting-room credits, inbound bookings and conflicts.
export const week = asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : new Date();
  if (Number.isNaN(from.valueOf()))
    throw new AppError("Valid from date is required", 400, "INVALID_DATES");
  const days = Math.min(14, Math.max(1, Number(req.query.days) || 5));
  const rangeEnd = new Date(from.getTime() + days * 86400000);
  const monthStart = new Date(from.getFullYear(), from.getMonth(), 1);
  const monthEnd = new Date(from.getFullYear(), from.getMonth() + 1, 1);

  const bookingPopulate = ["contactId", "companyId"];
  const [bookings, events, inboundRows, creditBookings, companies, contacts] = await Promise.all([
    Booking.find({
      workspaceId: req.workspaceId,
      status: { $in: [...ACTIVE_BOOKING_STATUSES, "completed"] },
      startAt: { $lt: rangeEnd },
      endAt: { $gt: from },
    }).populate(bookingPopulate).sort({ startAt: 1 }),
    CalendarEvent.find({
      workspaceId: req.workspaceId,
      status: { $ne: "cancelled" },
      startAt: { $lt: rangeEnd },
      endAt: { $gt: from },
    }).populate("contactId").sort({ startAt: 1 }),
    Booking.find({
      workspaceId: req.workspaceId,
      source: "website",
      createdAt: { $gte: new Date(Date.now() - 14 * 86400000) },
    }).populate(bookingPopulate).sort({ createdAt: -1 }).limit(5),
    Booking.find({
      workspaceId: req.workspaceId,
      bookingType: "meeting_room",
      status: { $in: ["confirmed", "completed"] },
      startAt: { $gte: monthStart, $lt: monthEnd },
    }).select("startAt endAt companyId contactId"),
    Company.find({ workspaceId: req.workspaceId, isArchived: false, meetingRoomCreditHours: { $gt: 0 } })
      .select("name meetingRoomCreditHours"),
    Contact.find({ workspaceId: req.workspaceId, isArchived: false, meetingRoomCreditHours: { $gt: 0 } })
      .select("firstName lastName meetingRoomCreditHours"),
  ]);

  // Meeting-room credits: monthly allowance vs hours used this month, per company or contact.
  const accounts = new Map();
  for (const c of companies)
    accounts.set(`company:${c._id}`, { id: String(c._id), name: c.name, limitHours: c.meetingRoomCreditHours, usedHours: 0 });
  for (const c of contacts)
    accounts.set(`contact:${c._id}`, { id: String(c._id), name: personName(c), limitHours: c.meetingRoomCreditHours, usedHours: 0 });
  for (const b of creditBookings) {
    const key = b.companyId ? `company:${b.companyId}` : b.contactId ? `contact:${b.contactId}` : null;
    if (key && accounts.has(key)) accounts.get(key).usedHours += hoursBetween(b.startAt, b.endAt);
  }
  const credits = [...accounts.values()]
    .map((a) => ({
      ...a,
      usedHours: Math.round(a.usedHours * 100) / 100,
      ratio: a.limitHours ? a.usedHours / a.limitHours : 0,
      approachingLimit: a.limitHours > 0 && a.usedHours / a.limitHours >= CREDIT_WARNING_RATIO,
    }))
    .sort((x, y) => y.ratio - x.ratio);

  // Bookings without their own company still match through the contact's company.
  const contactCompanyIds = [
    ...new Set(
      inboundRows
        .filter((b) => !b.companyId && b.contactId?.companyId)
        .map((b) => String(b.contactId.companyId)),
    ),
  ];
  const contactCompanies = contactCompanyIds.length
    ? await Company.find({ workspaceId: req.workspaceId, _id: { $in: contactCompanyIds } }).select("name")
    : [];
  const companyNameById = new Map(contactCompanies.map((c) => [String(c._id), c.name]));

  const inbound = inboundRows.map((b) => {
    const contact = b.contactId && typeof b.contactId === "object" ? b.contactId : null;
    const isNewContact = contact && Math.abs(new Date(contact.createdAt) - new Date(b.createdAt)) < NEW_CONTACT_WINDOW_MS;
    const companyName = b.companyId?.name || companyNameById.get(String(contact?.companyId || "")) || "";
    const status = isNewContact
      ? "New contact created"
      : companyName
        ? `Matched to ${companyName}`
        : "Returning client";
    return {
      id: String(b._id),
      label: `${bookingLabel(b.bookingType)} · ${personName(contact) || b.title || "Guest"}`,
      status,
      isNewContact: Boolean(isNewContact),
      createdAt: b.createdAt,
    };
  });

  res.json({
    success: true,
    data: {
      range: { startAt: from, endAt: rangeEnd, days },
      items: [...bookings.map(bookingItem), ...events.map(eventItem)].sort(
        (x, y) => new Date(x.startAt) - new Date(y.startAt),
      ),
      credits,
      inbound,
      conflicts: buildConflicts(bookings),
    },
  });
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
