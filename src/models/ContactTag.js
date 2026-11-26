import mongoose from "mongoose";

/*
 * Editable contact tags (client feedback 26 Nov, D). Seeded from TAG_CATALOGUE per workspace; the team
 * can rename, describe, archive and add tags. `key` never changes, so a rename applies to every contact.
 */
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    key: { type: String, required: true, match: /^[a-z0-9_]{1,50}$/ },
    label: { type: String, required: true, trim: true, maxlength: 50 },
    description: { type: String, trim: true, maxlength: 200, default: "" },
    group: { type: String, enum: ["segment", "source"], default: "segment" },
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false }, // added automatically by the CRM (source tags)
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, key: 1 }, { unique: true });
export const ContactTag = mongoose.model("ContactTag", schema);
