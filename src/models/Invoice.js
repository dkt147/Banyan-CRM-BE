import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal" },
    membershipId: { type: mongoose.Schema.Types.ObjectId, ref: "Membership" },
    invoiceNumber: String,
    provider: { type: String, default: "xero" },
    externalId: String,
    description: String,
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    currency: { type: String, default: "HKD" },
    dueAt: Date,
    paidAt: Date,
    status: {
      type: String,
      enum: ["draft", "awaiting", "overdue", "paid", "cancelled"],
      default: "draft",
      index: true,
    },
    recurring: { type: Boolean, default: false },
    source: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, status: 1, dueAt: 1 });
export const Invoice = mongoose.model("Invoice", schema);
