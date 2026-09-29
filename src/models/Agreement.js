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
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", index: true },
    name: { type: String, required: true },
    fileUrl: String,
    provider: { type: String, default: "docusign" },
    externalId: String,
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "HKD" },
    status: {
      type: String,
      enum: ["draft", "sent", "viewed", "signed", "declined", "expired"],
      default: "draft",
      index: true,
    },
    sentAt: Date,
    viewedAt: Date,
    signedAt: Date,
    expiresAt: Date,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, status: 1 });
export const Agreement = mongoose.model("Agreement", schema);
