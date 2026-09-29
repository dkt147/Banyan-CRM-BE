import { AutomationRule } from "../models/AutomationRule.js";
import { AutomationExecution } from "../models/AutomationExecution.js";
import { Task } from "../models/Task.js";
import { Activity } from "../models/Activity.js";
import { Notification } from "../models/Notification.js";
import { AppError } from "../utils/AppError.js";
export async function executeRule(
  workspaceId,
  userId,
  ruleId,
  entityType,
  entityId,
  context = {},
) {
  const rule = await AutomationRule.findOne({
    _id: ruleId,
    workspaceId,
    isEnabled: true,
  });
  if (!rule)
    throw new AppError(
      "Automation rule not found or disabled",
      404,
      "RULE_NOT_FOUND",
    );
  const ex = await AutomationExecution.create({
    workspaceId,
    ruleId,
    triggeredBy: "manual",
    entityType,
    entityId,
    status: "running",
    startedAt: new Date(),
  });
  try {
    const results = [];
    for (const a of rule.actions || []) {
      if (a.type === "create_task")
        results.push(
          await Task.create({
            workspaceId,
            title: a.title || "Automation task",
            description: a.description,
            assignedTo: a.assignedTo || userId,
            createdBy: userId,
            dueAt: new Date(Date.now() + (Number(a.delayDays) || 0) * 86400000),
            source: "automation",
            contactId: context.contactId,
            companyId: context.companyId,
            dealId: context.dealId,
          }),
        );
      else if (a.type === "log_activity")
        results.push(
          await Activity.create({
            workspaceId,
            userId,
            type: a.activityType || "note",
            subject: a.subject || rule.name,
            body: a.body,
            contactId: context.contactId,
            companyId: context.companyId,
            dealId: context.dealId,
          }),
        );
      else if (a.type === "notify")
        results.push(
          await Notification.create({
            workspaceId,
            userId: a.userId || userId,
            type: "automation",
            title: a.title || rule.name,
            body: a.body,
            entityType,
            entityId,
          }),
        );
    }
    ex.status = "completed";
    ex.completedAt = new Date();
    ex.result = { count: results.length };
    await ex.save();
    return ex;
  } catch (e) {
    ex.status = "failed";
    ex.error = e.message;
    ex.completedAt = new Date();
    await ex.save();
    throw e;
  }
}
