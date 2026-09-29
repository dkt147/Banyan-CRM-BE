import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LoyaltyAccount",
      required: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
    },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal" },
    points: { type: Number, required: true, min: 1 },
    rewardDescription: String,
    status: {
      type: String,
      enum: ["requested", "approved", "declined", "applied", "cancelled"],
      default: "requested",
      index: true,
    },
    requestedAt: { type: Date, default: Date.now },
    decidedAt: Date,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reason: String,
  },
  { timestamps: true },
);
export const LoyaltyRedemption = mongoose.model("LoyaltyRedemption", schema);
