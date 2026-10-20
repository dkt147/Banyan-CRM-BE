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
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal" },
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
      enum: ["held", "pending", "confirmed", "completed", "cancelled"],
      default: "held",
      index: true,
    },
    holdExpiresAt: Date,
    price: { type: Number, default: 0 },
    currency: { type: String, default: "HKD" },
    notes: String,
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
export const Booking = mongoose.model("Booking", schema);
