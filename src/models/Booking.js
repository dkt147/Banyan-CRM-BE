import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      index: true,
    },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", index: true },
    // Bookable room/studio. resourceName is kept for existing rows and display.
    resourceId: { type: mongoose.Schema.Types.ObjectId, ref: "Resource", index: true },
    resourceName: String,
    // Display text for the availability grid. Falls back to resourceName / contact name when empty.
    title: { type: String, trim: true, maxlength: 160 },
    subtitle: { type: String, trim: true, maxlength: 160 },
    bookingType: String,
    attendees: { type: Number, min: 0 },
    // Where the booking came from. "website" rows surface in the Inbound bookings panel.
    source: {
      type: String,
      enum: ["manual", "website", "google"],
      default: "manual",
      index: true,
    },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    status: {
      type: String,
      // held/pending are the original values and remain valid for existing rows.
      // pending_payment and expired were added for the Phase 1 booking lifecycle.
      // Brief statuses: pending_payment, confirmed, cancelled, expired, completed, no_show, refunded.
      enum: ["held", "pending", "pending_payment", "confirmed", "completed", "cancelled", "expired", "no_show", "refunded"],
      default: "held",
      index: true,
    },
    holdExpiresAt: Date,
    // Payment (brief 5). Amounts are integer minor units (HKD cents); `price` is the legacy float.
    paymentStatus: {
      type: String,
      enum: ["not_required", "unpaid", "paid", "refunded", "failed"],
      default: "not_required",
      index: true,
    },
    amountMinor: { type: Number, min: 0, default: null },
    stripeCheckoutSessionId: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },
    // Google Calendar event mirrored from/to this booking (unique when set).
    googleEventId: { type: String, default: undefined },
    // Day passes: date-only booking with a quantity.
    quantity: { type: Number, min: 1, default: 1 },
    price: { type: Number, default: 0 },
    currency: { type: String, default: "HKD" },
    notes: String,
    // e.g. metadata.contactMatch = "email" | "phone" | "created" for website bookings.
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, startAt: 1, endAt: 1 });
schema.index({ workspaceId: 1, resourceName: 1, startAt: 1 });
schema.index({ workspaceId: 1, contactId: 1, startAt: -1 });
schema.index({ googleEventId: 1 }, { unique: true, partialFilterExpression: { googleEventId: { $type: "string" } } });
schema.index({ stripeCheckoutSessionId: 1 }, { partialFilterExpression: { stripeCheckoutSessionId: { $type: "string" } } });
schema.index({ workspaceId: 1, companyId: 1, startAt: -1 });
export const Booking = mongoose.model("Booking", schema);
