import { z } from "zod";
import {
  TRIGGERS,
  DEAL_FIELDS,
  ACTION_TYPES,
  ASSIGNEE_DEALS_OWNER,
  ASSIGNEE_RULE_CREATOR,
  OPERATORS_BY_TYPE,
  operatorAllowed,
  operatorNeedsValue,
} from "../automation/catalog.js";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");
const assignee = z.union([z.literal(ASSIGNEE_DEALS_OWNER), z.literal(ASSIGNEE_RULE_CREATOR), objectId]);
const optionalText = (max) => z.string().trim().max(max).nullable().optional();

const conditionSchema = z
  .object({
    field: z.enum(Object.keys(DEAL_FIELDS), { message: "Unknown condition field" }),
    operator: z.enum(
      [...new Set(Object.values(OPERATORS_BY_TYPE).flat())],
      { message: "Unknown operator" },
    ),
    value: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
  })
  .superRefine((c, ctx) => {
    if (!operatorAllowed(c.field, c.operator)) {
      ctx.addIssue({ code: "custom", message: `Operator "${c.operator}" is not valid for field "${c.field}"` });
    }
    if (operatorNeedsValue(c.operator)) {
      const empty = c.value === null || c.value === undefined || String(c.value).trim() === "";
      if (empty) ctx.addIssue({ code: "custom", message: "A value is required for this condition" });
      if (DEAL_FIELDS[c.field]?.type === "number" && Number.isNaN(Number(c.value))) {
        ctx.addIssue({ code: "custom", message: "This condition needs a number" });
      }
    }
  });

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_task"),
    title: z.string().trim().min(1, "Task title is required").max(200),
    description: optionalText(5000),
    assignedTo: assignee.optional(),
    delayDays: z.coerce.number().min(0).max(365).default(0),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  }),
  z.object({
    type: z.literal("log_activity"),
    activityType: z.string().trim().max(60).default("note"),
    subject: z.string().trim().min(1, "Activity subject is required").max(200),
    body: optionalText(5000),
  }),
  z.object({
    type: z.literal("notify"),
    userId: assignee.optional(),
    title: z.string().trim().min(1, "Notification title is required").max(200),
    body: optionalText(2000),
  }),
  z.object({
    type: z.literal("change_stage"),
    stageId: objectId,
  }),
]);

// Frontend sends "" for blank optional selects; treat those as "not set".
const blankToUndefined = (v) => (v === "" || v === null ? undefined : v);

export const automationRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Rule name is required").max(120),
    description: optionalText(1000),
    trigger: z.enum(Object.keys(TRIGGERS), { message: "Unknown trigger" }),
    conditions: z.array(conditionSchema).max(20).default([]),
    actions: z.array(z.preprocess((a) => normalizeAction(a), actionSchema)).min(1, "Add at least one action").max(10),
    isEnabled: z.boolean().default(true),
  })
  .superRefine((rule, ctx) => {
    // Time-based triggers must be bounded, otherwise they would flag every deal.
    if (TRIGGERS[rule.trigger]?.timeBased) {
      const bounded = rule.conditions.some((c) => ["daysInactive", "daysInStage"].includes(c.field));
      if (!bounded) {
        ctx.addIssue({
          code: "custom",
          path: ["conditions"],
          message: "This trigger needs a condition on days inactive or days in stage",
        });
      }
    }
  });

function normalizeAction(a) {
  if (!a || typeof a !== "object") return a;
  const out = { ...a };
  for (const k of ["assignedTo", "userId", "description", "body", "stageId"]) {
    if (k in out) out[k] = blankToUndefined(out[k]);
  }
  if (out.type === "log_activity" && !out.activityType) out.activityType = "note";
  return out;
}

export const updateAutomationRuleSchema = automationRuleSchema;
export { ACTION_TYPES };
