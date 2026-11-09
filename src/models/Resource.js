import mongoose from "mongoose";
// A bookable space (meeting room, studio, venue). Bookings reference it by resourceId;
// Booking.resourceName is kept for existing rows and as the display fallback.
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: {
      type: String,
      enum: ["meeting_room", "studio", "venue", "event_space", "desk", "office", "other"],
      default: "meeting_room",
    },
    capacity: { type: Number, min: 0 },
    // Integer minor units (HKD cents). Never floats (brief section 4).
    pricePerHourMinor: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "HKD", uppercase: true },
    // Opening hours in Asia/Hong_Kong, e.g. { mon: [{ open: "09:00", close: "18:00" }], ... }.
    openingHours: { type: mongoose.Schema.Types.Mixed, default: {} },
    slotMinutes: { type: Number, min: 5, default: 30 },
    bufferMinutes: { type: Number, min: 0, default: 0 },
    minNoticeMinutes: { type: Number, min: 0, default: 0 },
    maxDurationMinutes: { type: Number, min: 0, default: 480 },
    // Optional Google Calendar that mirrors this resource (used by the later sync phase).
    googleCalendarId: String,
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, name: 1 }, { unique: true });
schema.index({ workspaceId: 1, isActive: 1, sortOrder: 1 });
export const Resource = mongoose.model("Resource", schema);
