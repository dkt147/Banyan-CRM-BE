import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    ruleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AutomationRule",
      required: true,
      index: true,
    },
    triggeredBy: String,
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "skipped"],
      default: "queued",
      index: true,
    },
    startedAt: Date,
    completedAt: Date,
    error: String,
    result: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
export const AutomationExecution = mongoose.model(
  "AutomationExecution",
  schema,
);
