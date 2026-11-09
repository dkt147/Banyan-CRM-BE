import mongoose from "mongoose";
// Workflow definition (brief 5 / 6.4). Editing creates a new version; runs keep a snapshot.
// The existing AutomationRule collection keeps powering the current simple rules until
// they are migrated to workflows in the workflow-engine phase.
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    status: { type: String, enum: ["draft", "active", "paused"], default: "draft", index: true },
    trigger: { type: mongoose.Schema.Types.Mixed, default: {} },
    conditions: { type: mongoose.Schema.Types.Mixed, default: { all: [] } },
    steps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    exitWhen: { type: mongoose.Schema.Types.Mixed, default: null },
    version: { type: Number, default: 1, min: 1 },
    allowReenroll: { type: Boolean, default: false },
    reenrollCooldownDays: { type: Number, min: 0, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, name: 1 }, { unique: true });
export const Workflow = mongoose.model("Workflow", schema);
