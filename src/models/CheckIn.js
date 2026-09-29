import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Membership",
      index: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contact",
      required: true,
      index: true,
    },
    checkedInAt: { type: Date, default: Date.now },
    checkedOutAt: Date,
    source: { type: String, default: "manual" },
  },
  { timestamps: true },
);
export const CheckIn = mongoose.model("CheckIn", schema);
