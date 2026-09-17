import mongoose from "mongoose";

const pipelineStageSchema = new mongoose.Schema(
  {
    pipelineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pipeline",
      required: true,
      index: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },

    sortOrder: {
      type: Number,
      required: true,
      default: 0
    },

    probability: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },

    isClosedWon: {
      type: Boolean,
      default: false
    },

    isClosedLost: {
      type: Boolean,
      default: false
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

pipelineStageSchema.index(
  { pipelineId: 1, key: 1 },
  { unique: true }
);

export const PipelineStage = mongoose.model(
  "PipelineStage",
  pipelineStageSchema
);