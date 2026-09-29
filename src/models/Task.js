import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: String,
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      index: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    dealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", index: true },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    dueAt: { type: Date, required: true, index: true },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "snoozed", "cancelled"],
      default: "pending",
      index: true,
    },
    source: {
      type: String,
      enum: ["manual", "automation", "system"],
      default: "manual",
    },
    completedAt: Date,
    snoozedUntil: Date,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, assignedTo: 1, status: 1, dueAt: 1 });
export const Task = mongoose.model("Task", schema);
