import mongoose from "mongoose";
// One step of a workflow run (brief 5: workflow_run_steps).
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowRun", required: true, index: true },
    stepIndex: { type: Number, required: true, min: 0 },
    type: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "waiting", "running", "completed", "failed", "skipped"],
      default: "pending",
      index: true,
    },
    // For wait steps: when the scheduler should resume the run.
    resumeAt: Date,
    // Unique per send so a retry never sends twice.
    idempotencyKey: { type: String, required: true },
    startedAt: Date,
    completedAt: Date,
    attempts: { type: Number, default: 0 },
    error: String,
    result: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Records the step touched, so contact/deal timelines can show workflow activity.
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", index: true },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", index: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
  },
  { timestamps: true },
);
schema.index({ runId: 1, stepIndex: 1 }, { unique: true });
schema.index({ status: 1, resumeAt: 1 });
schema.index({ idempotencyKey: 1 }, { unique: true });
export const WorkflowRunStep = mongoose.model("WorkflowRunStep", schema);
