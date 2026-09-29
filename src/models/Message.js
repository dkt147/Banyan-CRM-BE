import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    senderName: String,
    senderAddress: String,
    body: { type: String, required: true },
    sentAt: { type: Date, default: Date.now, index: true },
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "failed"],
      default: "sent",
    },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "Template" },
    attachments: [
      { name: String, url: String, mimeType: String, size: Number },
    ],
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
schema.index({ conversationId: 1, sentAt: 1 });
export const Message = mongoose.model("Message", schema);
