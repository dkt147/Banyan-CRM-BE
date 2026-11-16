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
    subject: { type: String, required: true, maxlength: 998 },
    // Plain text or HTML (imported from Brevo/Mailchimp/Canva). Stored and sent as given; {{variables}}
    // are filled in at send time (services/template.service.js). About 500 KB maximum.
    body: { type: String, required: true, maxlength: 512000 },
    category: String,
    variables: [String],
    triggerStage: String,
    followUp: { enabled: Boolean, delayDays: Number },
    isActive: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, name: 1 }, { unique: true });
export const Template = mongoose.model("Template", schema);
