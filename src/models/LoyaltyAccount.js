import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true,
    },
    tierId: { type: mongoose.Schema.Types.ObjectId, ref: "LoyaltyTier" },
    pointsBalance: { type: Number, default: 0 },
    lifetimeEarned: { type: Number, default: 0 },
    lifetimeRedeemed: { type: Number, default: 0 },
    lifetimeSpend: { type: Number, default: 0 },
    enrolledAt: { type: Date, default: Date.now },
    lastEventAt: Date,
  },
  { timestamps: true },
);

schema.index({ workspaceId: 1, contactId: 1 }, { unique: true });
export const LoyaltyAccount = mongoose.model("LoyaltyAccount", schema);
