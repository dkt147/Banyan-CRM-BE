import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    pipelineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pipeline",
      required: true,
      index: true,
    },
    stageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PipelineStage",
      required: true,
      index: true,
    },
    value: { type: Number, min: 0, default: 0 },
    recurringValue: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "HKD", uppercase: true },
    productType: { type: String, default: "other" },
    source: String,
    expectedCloseDate: Date,
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "won", "lost"],
      default: "open",
      index: true,
    },
    lostReason: String,
    description: String,
    lastActivityAt: Date,
    nextActionAt: Date,
    stageChangedAt: Date,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, pipelineId: 1, stageId: 1, status: 1 });
schema.index({ title: "text", source: "text" });
export const Deal = mongoose.model("Deal", schema);
