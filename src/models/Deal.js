import mongoose from "mongoose";
import { Sequence } from "./Sequence.js";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    dealNumber: { type: Number, index: true, min: 1000 },
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
    membershipStartAt: Date,
    membershipEndAt: Date,
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
schema.index({ workspaceId: 1, dealNumber: 1 }, { unique: true, sparse: true });
schema.pre("validate", async function assignDealNumber() {
  if (!this.isNew || this.dealNumber != null) return;
  const key = `deal:${this.workspaceId}`;
  const sequence = await Sequence.findOneAndUpdate(
    { key }, { $inc: { value: 1 }, $setOnInsert: { key } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  // Start readable IDs at 3333 while keeping them unique within each workspace.
  this.dealNumber = 3332 + sequence.value;
});
schema.index({ workspaceId: 1, pipelineId: 1, stageId: 1, status: 1 });
schema.index({ title: "text", source: "text" });
export const Deal = mongoose.model("Deal", schema);
