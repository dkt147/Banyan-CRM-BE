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
    minSpend: { type: Number, required: true },
    maxSpend: { type: Number, default: null },
    pointsMultiplier: { type: Number, default: 1 },
    benefits: [String],
    discountPercent: { type: Number, default: 0 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, name: 1 }, { unique: true });
export const LoyaltyTier = mongoose.model("LoyaltyTier", schema);
