import mongoose from "mongoose";

const dealSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },

    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true
    },

    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true
    },

    pipelineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pipeline",
      required: true,
      index: true
    },

    stageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PipelineStage",
      required: true,
      index: true
    },

    value: {
      type: Number,
      min: 0,
      default: 0
    },

    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "HKD"
    },

    productType: {
      type: String,
      enum: [
        "membership",
        "private_office",
        "venue_hire",
        "transactional",
        "meeting_room",
        "day_pass",
        "virtual_office",
        "studio",
        "other"
      ],
      default: "other"
    },

    source: {
      type: String,
      trim: true,
      default: null
    },

    expectedCloseDate: {
      type: Date,
      default: null
    },

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },

    status: {
      type: String,
      enum: ["open", "won", "lost"],
      default: "open",
      index: true
    },

    lostReason: {
      type: String,
      trim: true,
      default: null
    },

    description: {
      type: String,
      trim: true,
      default: null
    },

    lastActivityAt: {
      type: Date,
      default: null,
      index: true
    },

    nextActionAt: {
      type: Date,
      default: null,
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

dealSchema.index({
  title: "text",
  source: "text"
});

dealSchema.index({
  ownerId: 1,
  pipelineId: 1,
  stageId: 1,
  status: 1
});

export const Deal = mongoose.model("Deal", dealSchema);