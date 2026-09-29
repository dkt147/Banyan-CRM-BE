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
      index: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["earn", "redeem", "adjust", "expire", "reversal"],
      required: true,
    },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
    redemptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LoyaltyRedemption",
    },
    reason: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
schema.index({ accountId: 1, createdAt: -1 });
export const LoyaltyLedger = mongoose.model("LoyaltyLedger", schema);
