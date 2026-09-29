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
    url: String,
    storageKey: String,
    mimeType: String,
    size: Number,
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company" },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal" },
    agreementId: { type: mongoose.Schema.Types.ObjectId, ref: "Agreement" },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
export const Document = mongoose.model("Document", schema);
