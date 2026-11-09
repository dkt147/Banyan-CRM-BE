import mongoose from "mongoose";
// Saved contact segment. Rules are evaluated in a later phase; Phase 1 only stores them.
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: String,
    // Saved filter over contacts: { all: [ { field, op, value } ] } or { any: [...] },
    // one nesting level (brief 6.4). Evaluated on demand.
    definition: { type: mongoose.Schema.Types.Mixed, default: { all: [] } },
    isActive: { type: Boolean, default: true, index: true },
    lastEvaluatedAt: Date,
    memberCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, name: 1 }, { unique: true });
export const Segment = mongoose.model("Segment", schema);
