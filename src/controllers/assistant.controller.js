import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import { askBanyanAssistant, getAssistantStatus } from "../services/assistant.service.js";

const chatSchema = z.object({
  message: z.string().trim().min(1, "Please enter a question.").max(2000, "Question must be 2,000 characters or fewer."),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(5000),
  })).max(8).optional().default([]),
}).strict();

export const status = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: getAssistantStatus() });
});

export const chat = asyncHandler(async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError("Please provide a valid question and recent conversation history.", 400, "AI_INVALID_REQUEST", parsed.error.issues);
  }
  const result = await askBanyanAssistant({
    workspaceId: req.workspaceId,
    question: parsed.data.message,
    history: parsed.data.history,
  });
  res.json({ success: true, message: "Banyan Assist answered successfully.", data: result });
});
