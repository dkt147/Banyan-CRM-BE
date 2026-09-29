import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: [
        "gmail",
        "whatsapp",
        "google_calendar",
        "xero",
        "stripe",
        "docusign",
        "wordpress",
        "access_control",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["connected", "disconnected", "error", "pending"],
      default: "pending",
      index: true,
    },
    accountName: String,
    externalAccountId: String,
    accessTokenEncrypted: String,
    refreshTokenEncrypted: String,
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastSyncedAt: Date,
    error: String,
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, provider: 1 }, { unique: true });
export const Integration = mongoose.model("Integration", schema);
