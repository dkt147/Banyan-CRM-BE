import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },

    description: {
      type: String,
      trim: true,
      default: null
    },

    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
      index: true
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true
    },

    dealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deal",
      default: null,
      index: true
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    dueAt: {
      type: Date,
      required: true,
      index: true
    },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true
    },

    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "snoozed", "cancelled"],
      default: "pending",
      index: true
    },

    source: {
      type: String,
      enum: ["manual", "automation", "system"],
      default: "manual"
    },

    completedAt: {
      type: Date,
      default: null
    },

    snoozedUntil: {
      type: Date,
      default: null
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

taskSchema.index({
  assignedTo: 1,
  status: 1,
  dueAt: 1
});

export const Task = mongoose.model("Task", taskSchema);