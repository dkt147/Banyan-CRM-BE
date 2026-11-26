import mongoose from "mongoose";

/* One per Eventbrite attendee, i.e. per ticket (27 Nov b, A). */
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    source: { type: String, default: "eventbrite" },
    externalId: { type: String, required: true }, // Eventbrite attendee id
    orderId: { type: String, default: null },
    name: { type: String, default: "" },
    email: { type: String, lowercase: true, trim: true, default: null },
    phone: { type: String, default: null },
    ticketClass: { type: String, default: null },
    amount: { type: Number, default: 0 }, // major units, e.g. 150
    currency: { type: String, default: null },
    status: { type: String, enum: ["attending", "checked_in", "cancelled", "refunded", "not_attending"], default: "attending" },
    registeredAt: { type: Date, default: null },
    checkedInAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    contactCreated: { type: Boolean, default: false },
    answers: {
      type: [{ question: { type: String, maxlength: 500 }, answer: { type: String, maxlength: 500 }, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, source: 1, externalId: 1 }, { unique: true });
schema.index({ workspaceId: 1, eventId: 1, registeredAt: 1 });
schema.index({ workspaceId: 1, contactId: 1, registeredAt: -1 });
schema.index({ workspaceId: 1, companyId: 1, registeredAt: -1 });
export const EventRegistration = mongoose.model("EventRegistration", schema);
