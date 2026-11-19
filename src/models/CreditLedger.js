import mongoose from "mongoose";

/*
 * Meeting room credit ledger (client meeting 19 Nov, §5). 1 credit = 1 hour, per company per Hong
 * Kong month. Usage = "use" minus "refund"; "adjust" changes the month's allowance (+/-).
 * One "use" and at most one "refund" per booking ref (unique), so retries and webhooks are safe.
 */
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    month: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    type: { type: String, enum: ["use", "refund", "adjust"], required: true },
    hours: { type: Number, required: true },
    bookingRef: { type: String, default: null },
    creditRef: { type: String, default: null },
    room: { type: String, default: null },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null },
    by: { type: String, default: null },
    note: { type: String, maxlength: 500, default: null },
    at: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, companyId: 1, month: 1 });
schema.index({ workspaceId: 1, month: 1 });
schema.index(
  { workspaceId: 1, bookingRef: 1, type: 1 },
  { unique: true, partialFilterExpression: { bookingRef: { $type: "string" }, type: { $in: ["use", "refund"] } } },
);
export const CreditLedger = mongoose.model("CreditLedger", schema);
