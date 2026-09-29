import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    description: String,
    trigger: { type: String, required: true },
    conditions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    actions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    isEnabled: { type: Boolean, default: true, index: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, name: 1 }, { unique: true });
export const AutomationRule = mongoose.model("AutomationRule", schema);
