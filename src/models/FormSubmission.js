import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    formId: { type: mongoose.Schema.Types.ObjectId, ref: "Form", required: true, index: true },
    // Set once the submission is matched to (or creates) a contact.
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", index: true },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", index: true },
    // Every deal the submission made (a walk-in with services in two pipelines makes two).
    dealIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Deal" }], default: undefined },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["received", "processed", "failed", "spam"],
      default: "received",
      index: true,
    },
    error: String,
    sourceUrl: String,
    // Retained for the consent audit trail (brief 5 / 6.5).
    ip: String,
    userAgent: String,
    processedAt: Date,
    // { status: "pending" | "added" | "skipped" | "failed", segments: [names], reason, at }, or null when off.
    flodesk: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, formId: 1, createdAt: -1 });
export const FormSubmission = mongoose.model("FormSubmission", schema);
