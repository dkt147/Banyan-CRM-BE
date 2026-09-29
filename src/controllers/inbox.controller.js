import { asyncHandler } from "../utils/asyncHandler.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { AppError } from "../utils/AppError.js";
export const list = asyncHandler(async (req, res) => {
  const filter = { workspaceId: req.workspaceId };
  for (const k of ["channel", "status", "assignedTo", "contactId", "dealId"])
    if (req.query[k]) filter[k] = req.query[k];
  const items = await Conversation.find(filter)
    .populate("contactId dealId assignedTo")
    .sort({ lastMessageAt: -1 })
    .limit(Math.min(+req.query.limit || 50, 100));
  res.json({ success: true, data: items });
});
export const get = asyncHandler(async (req, res) => {
  const c = await Conversation.findOne({
    _id: req.params.id,
    workspaceId: req.workspaceId,
  }).populate("contactId dealId assignedTo");
  if (!c) throw new AppError("Conversation not found", 404, "NOT_FOUND");
  const messages = await Message.find({
    workspaceId: req.workspaceId,
    conversationId: c._id,
  })
    .populate("templateId")
    .sort({ sentAt: 1 });
  res.json({ success: true, data: { conversation: c, messages } });
});
export const send = asyncHandler(async (req, res) => {
  const c = await Conversation.findOne({
    _id: req.params.id,
    workspaceId: req.workspaceId,
  });
  if (!c) throw new AppError("Conversation not found", 404, "NOT_FOUND");
  const m = await Message.create({
    workspaceId: req.workspaceId,
    conversationId: c._id,
    direction: "outbound",
    senderName: req.user.name,
    senderAddress: req.user.email,
    body: req.body.body,
    templateId: req.body.templateId,
    attachments: req.body.attachments || [],
    status: "sent",
  });
  c.lastMessageAt = new Date();
  await c.save();
  res.status(201).json({ success: true, data: m });
});
export const markRead = asyncHandler(async (req, res) => {
  const c = await Conversation.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    { unreadCount: 0 },
    { new: true },
  );
  if (!c) throw new AppError("Conversation not found", 404, "NOT_FOUND");
  res.json({ success: true, data: c });
});
export const link = asyncHandler(async (req, res) => {
  const c = await Conversation.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    {
      contactId: req.body.contactId,
      companyId: req.body.companyId,
      dealId: req.body.dealId,
      assignedTo: req.body.assignedTo,
    },
    { new: true, runValidators: true },
  );
  if (!c) throw new AppError("Conversation not found", 404, "NOT_FOUND");
  res.json({ success: true, data: c });
});
