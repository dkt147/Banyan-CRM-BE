import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    category: String,
    variables: [String],
    triggerStage: String,
    followUp: { enabled: Boolean, delayDays: Number },
    isActive: { type: Boolean, default: true },
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
export const Template = mongoose.model("Template", schema);
