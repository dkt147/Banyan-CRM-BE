import mongoose from "mongoose";
// Dashboard widget order and visibility (brief 6.7). scope "global" or per "role".
const schema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    scope: { type: String, enum: ["global", "role"], default: "global" },
    role: { type: String, default: null },
    layout: { type: mongoose.Schema.Types.Mixed, default: { widgets: [] } },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, scope: 1, role: 1 }, { unique: true });
export const DashboardLayout = mongoose.model("DashboardLayout", schema);
