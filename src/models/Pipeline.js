import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, lowercase: true, trim: true },
    description: String,
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, key: 1 }, { unique: true });
export const Pipeline = mongoose.model("Pipeline", schema);
