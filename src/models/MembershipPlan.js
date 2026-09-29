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
    type: String,
    description: String,
    price: { type: Number, default: 0 },
    currency: { type: String, default: "HKD" },
    billingInterval: {
      type: String,
      enum: ["monthly", "quarterly", "yearly", "one_off"],
      default: "monthly",
    },
    features: [String],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, name: 1 }, { unique: true });
export const MembershipPlan = mongoose.model("MembershipPlan", schema);
