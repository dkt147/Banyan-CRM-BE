import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["admin", "manager", "operator"],
      default: "operator",
      index: true,
    },
    avatarUrl: String,
    phone: String,
    jobTitle: String,
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: Date,
    preferences: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, role: 1 });
export const User = mongoose.model("User", schema);
