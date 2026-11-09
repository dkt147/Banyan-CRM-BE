import mongoose from "mongoose";
// A public intake form (website enquiry, booking request, event registration).
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
    type: { type: String, enum: ["enquiry", "contact", "walk_in", "newsletter"], required: true },
    description: String,
    fields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    consentText: String,
    tagsToApply: { type: [String], default: [] },
    // Optional deal creation in this pipeline; optional follow-up task; staff notification.
    pipelineId: { type: mongoose.Schema.Types.ObjectId, ref: "Pipeline" },
    stageId: { type: mongoose.Schema.Types.ObjectId, ref: "PipelineStage" },
    createTask: { type: Boolean, default: false },
    notifyEmails: { type: [String], default: [] },
    doubleOptIn: { type: Boolean, default: false },
    // Public intake protection (brief 6.5).
    publicKey: { type: String, required: true },
    allowedOrigins: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, slug: 1 }, { unique: true });
schema.index({ publicKey: 1 }, { unique: true });
export const Form = mongoose.model("Form", schema);
