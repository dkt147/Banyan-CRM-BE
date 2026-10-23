import { asyncHandler } from "../utils/asyncHandler.js";
import { AutomationRule } from "../models/AutomationRule.js";
import { AutomationExecution } from "../models/AutomationExecution.js";
import { executeRule } from "../services/automation.service.js";
import { AppError } from "../utils/AppError.js";
import { automationRuleSchema } from "../validators/automation.validators.js";
import {
  TRIGGERS,
  DEAL_FIELDS,
  OPERATORS_BY_TYPE,
  OPERATOR_LABELS,
  ACTION_TYPES,
  ASSIGNEE_DEALS_OWNER,
  ASSIGNEE_RULE_CREATOR,
} from "../automation/catalog.js";

// Lets the frontend build its forms from the same lists the server enforces.
export const catalog = asyncHandler(async (_req, res) =>
  res.json({
    success: true,
    data: {
      triggers: TRIGGERS,
      fields: DEAL_FIELDS,
      operators: OPERATORS_BY_TYPE,
      operatorLabels: OPERATOR_LABELS,
      actionTypes: ACTION_TYPES,
      assignees: { dealOwner: ASSIGNEE_DEALS_OWNER, creator: ASSIGNEE_RULE_CREATOR },
    },
  }),
);

export const list = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await AutomationRule.find({ workspaceId: req.workspaceId })
      .populate("createdBy updatedBy")
      .sort({ createdAt: -1 }),
  }),
);

// Route runs validate(automationRuleSchema) first, so req.body is already clean.
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

// Partial updates are merged with the saved rule and re-validated as a whole,
// so the trigger/condition rules still apply when only one of them changes.
export const update = asyncHandler(async (req, res) => {
  const existing = await AutomationRule.findOne({ _id: req.params.id, workspaceId: req.workspaceId }).lean();
  if (!existing) throw new AppError("Automation rule not found", 404, "NOT_FOUND");
  // Turning a rule on/off must always work, even if an older rule no longer passes today's rules.
  const onlyToggle = Object.keys(req.body || {}).every((k) => k === "isEnabled");
  if (onlyToggle) {
    const toggled = await AutomationRule.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspaceId },
      { $set: { isEnabled: Boolean(req.body.isEnabled), updatedBy: req.user._id } },
      { new: true },
    );
    return res.json({ success: true, data: toggled });
  }
  const merged = automationRuleSchema.parse({
    name: existing.name,
    description: existing.description,
    trigger: existing.trigger,
    conditions: existing.conditions,
    actions: existing.actions,
    isEnabled: existing.isEnabled,
    ...req.body,
  });
  const r = await AutomationRule.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    { $set: { ...merged, updatedBy: req.user._id } },
    { new: true, runValidators: true },
  );
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
