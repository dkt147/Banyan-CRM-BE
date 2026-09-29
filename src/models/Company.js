import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    legalName: String,
    industry: String,
    website: String,
    email: String,
    phone: String,
    address: {
      street: String,
      city: String,
      country: String,
      postalCode: String,
    },
    tags: [String],
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    notes: String,
    isArchived: { type: Boolean, default: false, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, name: 1 });
schema.index({ name: "text", legalName: "text" });
export const Company = mongoose.model("Company", schema);
