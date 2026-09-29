import { asyncHandler } from "../utils/asyncHandler.js";
import { Task } from "../models/Task.js";
import { AppError } from "../utils/AppError.js";

export const complete = asyncHandler(async (req, res) => {
  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    { status: "completed", completedAt: new Date() },
    { new: true, runValidators: true },
  );
  if (!task) throw new AppError("Task not found", 404, "NOT_FOUND");
  res.json({ success: true, data: task });
});
export const snooze = asyncHandler(async (req, res) => {
  const until = new Date(req.body.until);
  if (Number.isNaN(until.valueOf()))
    throw new AppError("Valid until date is required", 400, "INVALID_DATE");
  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    { status: "snoozed", snoozedUntil: until },
    { new: true, runValidators: true },
  );
  if (!task) throw new AppError("Task not found", 404, "NOT_FOUND");
  res.json({ success: true, data: task });
});
