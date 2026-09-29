import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ["email", "whatsapp"],
      required: true,
      index: true,
    },
    externalThreadId: String,
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
      index: true,
    },
    subject: String,
    participantName: String,
    participantAddress: String,
    status: {
      type: String,
      enum: ["open", "closed", "snoozed"],
      default: "open",
      index: true,
    },
    unreadCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ workspaceId: 1, lastMessageAt: -1 });
export const Conversation = mongoose.model("Conversation", schema);
