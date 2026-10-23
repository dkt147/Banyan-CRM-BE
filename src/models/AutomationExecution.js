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
    trigger: String,
    // manual = "Run now"; trigger = deal event; schedule = time-based check
    triggeredBy: {
      type: String,
      enum: ["manual", "trigger", "schedule"],
      default: "manual",
    },
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    // Set for time-based runs so the same episode never fires twice for one rule and deal.
    dedupeKey: String,
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
schema.index({ ruleId: 1, dedupeKey: 1 }, { unique: true, sparse: true });
export const AutomationExecution = mongoose.model(
  "AutomationExecution",
  schema,
);
