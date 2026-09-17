import mongoose from "mongoose";

const activitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "note",
        "call",
        "email",
        "whatsapp",
        "meeting",
        "stage_change",
        "deal_created",
        "task_created"
      ],
      required: true,
      index: true
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

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    subject: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null
    },

    body: {
      type: String,
      trim: true,
      default: null
    },

    occurredAt: {
      type: Date,
      default: Date.now,
      index: true
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

export const Activity = mongoose.model("Activity", activitySchema);