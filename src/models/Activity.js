import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    type: { type: String, required: true, index: true },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", index: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subject: String,
    body: String,
    occurredAt: { type: Date, default: Date.now, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, occurredAt: -1 });
export const Activity = mongoose.model("Activity", schema);
