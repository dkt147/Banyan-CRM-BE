import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: String,
    title: { type: String, required: true },
    body: String,
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    readAt: Date,
    channel: {
      type: String,
      enum: ["in_app", "email", "whatsapp"],
      default: "in_app",
    },
  },
  { timestamps: true },
);
schema.index({ userId: 1, readAt: 1, createdAt: -1 });
export const Notification = mongoose.model("Notification", schema);
