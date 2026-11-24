import mongoose from "mongoose";

/*
 * Day pass credits (client meeting 25 Nov, §3): a member buys a package of days and uses it by
 * the half or full day. Unit = days in 0.5 steps; per contact. Balance = sum of `days`.
 */
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true },
    type: { type: String, enum: ["purchase", "redeem", "adjust", "refund"], required: true },
    days: { type: Number, required: true }, // signed: purchase +10, redeem -0.5 / -1, adjust +/-, refund +
    amount: { type: Number, default: null }, // HK$ paid, purchases only
    date: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ }, // visit date (HK), redeems only
    note: { type: String, maxlength: 500, default: null },
    by: { type: String, default: null },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    at: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, contactId: 1, at: -1 });
export const DayPassEntry = mongoose.model("DayPassEntry", schema);
