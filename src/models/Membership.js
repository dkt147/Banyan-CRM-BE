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
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "MembershipPlan" },
    memberCode: String,
    startAt: Date,
    renewalAt: Date,
    endAt: Date,
    status: {
      type: String,
      enum: ["trial", "active", "paused", "expired", "cancelled"],
      default: "active",
      index: true,
    },
    monthlyValue: { type: Number, default: 0 },
    currency: { type: String, default: "HKD" },
    seats: { type: Number, default: 1 },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "low",
    },
    notes: String,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, renewalAt: 1 });
export const Membership = mongoose.model("Membership", schema);
