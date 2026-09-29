import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      index: true,
    },
    provider: String,
    eventType: String,
    externalEventId: String,
    payload: { type: mongoose.Schema.Types.Mixed },
    status: {
      type: String,
      enum: ["received", "processed", "failed", "ignored"],
      default: "received",
      index: true,
    },
    processedAt: Date,
    error: String,
  },
  { timestamps: true },
);
schema.index(
  { provider: 1, externalEventId: 1 },
  { unique: true, sparse: true },
);
export const WebhookEvent = mongoose.model("WebhookEvent", schema);
