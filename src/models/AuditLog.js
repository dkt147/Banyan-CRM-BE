import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: mongoose.Schema.Types.ObjectId,
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    reason: String,
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, createdAt: -1 });
export const AuditLog = mongoose.model("AuditLog", schema);
