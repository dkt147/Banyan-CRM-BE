import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, trim: true, default: "" },
    email: { type: String, lowercase: true, trim: true, index: true },
    phone: String,
    whatsapp: String,
    jobTitle: String,
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    tags: [String],
    source: String,
    language: { type: String, default: "en" },
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
  { timestamps: true, toJSON: { virtuals: true } },
);
schema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});
schema.index({ workspaceId: 1, email: 1 });
schema.index({ firstName: "text", lastName: "text", email: "text" });
export const Contact = mongoose.model("Contact", schema);
