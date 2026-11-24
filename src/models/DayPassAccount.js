import mongoose from "mongoose";

/*
 * One per contact with day pass entries (25 Nov, §3). A cache of the balance for the front desk list
 * plus the email bookkeeping; DayPassEntry rows are the source of truth.
 */
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true },
    balance: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null }, // latest redeem
    lastUsedDate: { type: String, default: null }, // its visit date (HK, YYYY-MM-DD)
    lastBalanceEmailAt: { type: Date, default: null },
    lastLowBalanceEmailAt: { type: Date, default: null },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, contactId: 1 }, { unique: true });
schema.index({ workspaceId: 1, balance: 1 });
export const DayPassAccount = mongoose.model("DayPassAccount", schema);
