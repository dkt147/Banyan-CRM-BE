import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    pipelineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pipeline",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, lowercase: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    probability: { type: Number, min: 0, max: 100, default: 0 },
    isClosedWon: { type: Boolean, default: false },
    isClosedLost: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, pipelineId: 1, key: 1 }, { unique: true });
export const PipelineStage = mongoose.model("PipelineStage", schema);
