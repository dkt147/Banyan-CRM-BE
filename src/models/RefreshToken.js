import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RefreshToken",
      default: null,
    },
    userAgent: String,
    ipAddress: String,
  },
  { timestamps: true },
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshToken = mongoose.model("RefreshToken", schema);
