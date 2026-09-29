import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    type: { type: String, default: "meeting" },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    timezone: String,
    location: String,
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      index: true,
    },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    externalProvider: String,
    externalEventId: String,
    status: {
      type: String,
      enum: ["scheduled", "cancelled", "completed"],
      default: "scheduled",
    },
    notes: String,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, startAt: 1 });
export const CalendarEvent = mongoose.model("CalendarEvent", schema);
