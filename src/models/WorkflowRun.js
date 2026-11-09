import mongoose from "mongoose";
// One enrollment of a contact in a workflow (brief 5: workflow_runs).
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    workflowId: { type: mongoose.Schema.Types.ObjectId, ref: "Workflow", required: true, index: true },
    workflowVersion: { type: Number, required: true },
    definitionSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    status: { type: String, enum: ["active", "completed", "exited", "failed"], default: "active", index: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
  },
  { timestamps: true },
);
// One active run per contact per workflow.
schema.index(
  { workflowId: 1, contactId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);
export const WorkflowRun = mongoose.model("WorkflowRun", schema);
