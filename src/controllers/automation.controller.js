import { asyncHandler } from "../utils/asyncHandler.js";
import { AutomationRule } from "../models/AutomationRule.js";
import { AutomationExecution } from "../models/AutomationExecution.js";
import { executeRule } from "../services/automation.service.js";
import { AppError } from "../utils/AppError.js";
export const list = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await AutomationRule.find({ workspaceId: req.workspaceId })
      .populate("createdBy updatedBy")
      .sort({ createdAt: -1 }),
  }),
);
export const create = asyncHandler(async (req, res) =>
  res.status(201).json({
    success: true,
    data: await AutomationRule.create({
      ...req.body,
      workspaceId: req.workspaceId,
      createdBy: req.user._id,
    }),
  }),
);
export const update = asyncHandler(async (req, res) => {
  const r = await AutomationRule.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    { ...req.body, updatedBy: req.user._id, workspaceId: req.workspaceId },
    { new: true, runValidators: true },
  );
  if (!r) throw new AppError("Automation rule not found", 404, "NOT_FOUND");
  res.json({ success: true, data: r });
});
export const execute = asyncHandler(async (req, res) =>
  res.status(201).json({
    success: true,
    data: await executeRule(
      req.workspaceId,
      req.user._id,
      req.params.id,
      req.body.entityType,
      req.body.entityId,
      req.body.context || {},
    ),
  }),
);
export const executions = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await AutomationExecution.find({
      workspaceId: req.workspaceId,
      ruleId: req.params.id,
    })
      .sort({ createdAt: -1 })
      .limit(100),
  }),
);
