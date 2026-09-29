import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String, trim: true },
    logoUrl: String,
    timezone: { type: String, default: "Asia/Hong_Kong" },
    currency: { type: String, default: "HKD", uppercase: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);
schema.index({ name: "text", description: "text" });
export const Workspace = mongoose.model("Workspace", schema);
