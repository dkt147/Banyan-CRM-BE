import { AsyncLocalStorage } from "node:async_hooks";
import { AutomationRule } from "../models/AutomationRule.js";
import { AutomationExecution } from "../models/AutomationExecution.js";
import { Task } from "../models/Task.js";
import { Activity } from "../models/Activity.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { Deal } from "../models/Deal.js";
import { AppError } from "../utils/AppError.js";
import {
  TIME_BASED_TRIGGERS,
  ASSIGNEE_DEALS_OWNER,
  ASSIGNEE_RULE_CREATOR,
  buildDealFacts,
  evaluateConditions,
  DAY_MS,
} from "../automation/catalog.js";

// Rules can change deals (change_stage), which fires more rules. These limits stop loops:
// a rule never re-enters itself within one chain, and chains stop at MAX_CHAIN_DEPTH.
const MAX_CHAIN_DEPTH = 3;
const chain = new AsyncLocalStorage();

function dealContext(deal) {
  return {
    dealId: deal._id,
    contactId: deal.contactId,
    companyId: deal.companyId,
  };
}

// Resolve "deal_owner" / "creator" / explicit user id. Explicit ids must belong to the workspace.
async function resolveUser(value, { workspaceId, creatorId, deal }) {
  if (!value || value === ASSIGNEE_RULE_CREATOR) return creatorId;
  if (value === ASSIGNEE_DEALS_OWNER) {
    if (!deal?.ownerId) throw new Error("This action assigns to the deal owner, but the rule has no deal");
    return deal.ownerId;
  }
  const exists = await User.exists({ _id: value, workspaceId });
  if (!exists) throw new Error(`User ${value} is not a member of this workspace`);
  return value;
}

async function runAction(action, { workspaceId, creatorId, entityType, entityId, context, deal, rule }) {
  const meta = { automationRuleId: String(rule._id), automationRuleName: rule.name };
  if (action.type === "create_task") {
    const assignedTo = await resolveUser(action.assignedTo || (deal ? ASSIGNEE_DEALS_OWNER : ASSIGNEE_RULE_CREATOR), { workspaceId, creatorId, deal });
    return Task.create({
      workspaceId,
      title: action.title,
      description: action.description || undefined,
      assignedTo,
      createdBy: creatorId,
      dueAt: new Date(Date.now() + (Number(action.delayDays) || 0) * DAY_MS),
      priority: action.priority || "medium",
      source: "automation",
      contactId: context.contactId,
      companyId: context.companyId,
      dealId: context.dealId,
      metadata: meta,
    });
  }
  if (action.type === "log_activity") {
    return Activity.create({
      workspaceId,
      userId: creatorId,
      type: action.activityType || "note",
      subject: action.subject,
      body: action.body || undefined,
      contactId: context.contactId,
      companyId: context.companyId,
      dealId: context.dealId,
      metadata: meta,
    });
  }
  if (action.type === "notify") {
    const userId = await resolveUser(action.userId, { workspaceId, creatorId, deal });
    return Notification.create({
      workspaceId,
      userId,
      type: "automation",
      title: action.title,
      body: action.body || undefined,
      entityType,
      entityId,
    });
  }
  if (action.type === "change_stage") {
    if (!deal) throw new Error("Change stage needs a deal");
    // Imported lazily: deal.service imports this module, so a static import would be circular.
    const { moveDeal } = await import("./deal.service.js");
    return moveDeal(workspaceId, creatorId, deal._id, action.stageId);
  }
  throw new Error(`Unsupported action type: ${action.type}`);
}

// Runs one rule. Every action is attempted; one failing action does not stop the others.
async function runRule(rule, { workspaceId, creatorId, entityType, entityId, context = {}, deal = null, triggeredBy, trigger, dedupeKey }) {
  const state = chain.getStore() || { depth: 0, ruleIds: [] };
  const ruleKey = String(rule._id);
  if (state.depth >= MAX_CHAIN_DEPTH || state.ruleIds.includes(ruleKey)) {
    console.warn(`[automation] skipped rule ${ruleKey} to prevent a loop`);
    return null;
  }

  let ex;
  try {
    ex = await AutomationExecution.create({
      workspaceId,
      ruleId: rule._id,
      trigger: trigger || rule.trigger,
      triggeredBy,
      entityType,
      entityId,
      dedupeKey,
      status: "running",
      startedAt: new Date(),
    });
  } catch (error) {
    // Duplicate dedupeKey: this time-based episode already ran for this rule and deal.
    if (error?.code === 11000) return null;
    throw error;
  }

  const results = [];
  const next = { depth: state.depth + 1, ruleIds: [...state.ruleIds, ruleKey] };
  await chain.run(next, async () => {
    for (const action of rule.actions || []) {
      try {
        const doc = await runAction(action, { workspaceId, creatorId, entityType, entityId, context, deal, rule });
        results.push({ type: action.type, ok: true, id: doc?._id ? String(doc._id) : undefined });
      } catch (error) {
        results.push({ type: action.type, ok: false, error: error.message });
      }
    }
  });

  const failures = results.filter((r) => !r.ok);
  ex.status = failures.length ? "failed" : "completed";
  ex.error = failures.length ? failures.map((f) => `${f.type}: ${f.error}`).join("; ").slice(0, 1000) : undefined;
  ex.result = { count: results.length, actions: results };
  ex.completedAt = new Date();
  await ex.save();
  return ex;
}

// Manual "Run now" from the UI. Conditions are not checked here: the user chose to run it.
export async function executeRule(workspaceId, userId, ruleId, entityType, entityId, context = {}) {
  const rule = await AutomationRule.findOne({ _id: ruleId, workspaceId, isEnabled: true });
  if (!rule) throw new AppError("Automation rule not found or disabled", 404, "RULE_NOT_FOUND");
  let deal = null;
  let ctx = { ...context };
  if (entityType === "deal" && entityId) {
    deal = await Deal.findOne({ _id: entityId, workspaceId });
    if (!deal) throw new AppError("Deal not found", 404, "NOT_FOUND");
    ctx = { ...dealContext(deal), ...context };
  }
  return runRule(rule, { workspaceId, creatorId: userId, entityType, entityId, context: ctx, deal, triggeredBy: "manual" });
}

// Called from deal events (create / update / stage change / status change).
export async function fireDealTrigger(workspaceId, userId, trigger, deal) {
  const rules = await AutomationRule.find({ workspaceId, trigger, isEnabled: true }).lean();
  if (!rules.length) return [];
  const facts = buildDealFacts(deal);
  const out = [];
  for (const rule of rules) {
    if (!evaluateConditions(rule.conditions, facts)) continue;
    try {
      out.push(await runRule(rule, { workspaceId, creatorId: userId, entityType: "deal", entityId: deal._id, context: dealContext(deal), deal, triggeredBy: "trigger" }));
    } catch (error) {
      console.error(`[automation] rule ${rule._id} failed:`, error.message);
    }
  }
  return out;
}

// Scheduler for time-based triggers (deal_inactive). Each inactivity episode fires once:
// the dedupe key changes when the deal's activity or stage changes, so a new episode can fire again.
let scheduledRunning = false;
export async function runScheduledAutomations(now = new Date()) {
  if (scheduledRunning) return;
  scheduledRunning = true;
  try {
    const rules = await AutomationRule.find({ isEnabled: true, trigger: { $in: TIME_BASED_TRIGGERS } }).lean();
    for (const rule of rules) {
      const deals = await Deal.find({ workspaceId: rule.workspaceId, status: "open" }).lean();
      for (const deal of deals) {
        const facts = buildDealFacts(deal, now);
        if (!evaluateConditions(rule.conditions, facts)) continue;
        const episode = `${deal.lastActivityAt ? new Date(deal.lastActivityAt).toISOString() : ""}|${deal.stageChangedAt ? new Date(deal.stageChangedAt).toISOString() : ""}`;
        const dedupeKey = `${rule.trigger}:${String(deal._id)}:${episode}`;
        await runRule(rule, {
          workspaceId: rule.workspaceId,
          creatorId: deal.ownerId,
          entityType: "deal",
          entityId: deal._id,
          context: dealContext(deal),
          deal,
          triggeredBy: "schedule",
          dedupeKey,
        }).catch((error) => console.error(`[automation] scheduled rule ${rule._id} failed:`, error.message));
      }
    }
  } finally {
    scheduledRunning = false;
  }
}
