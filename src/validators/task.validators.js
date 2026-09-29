import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");

const taskStatus = z.enum([
  "pending",
  "in_progress",
  "completed",
  "snoozed",
  "cancelled",
]);

const taskPriority = z.enum(["low", "medium", "high", "urgent"]);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(200),

  description: z.string().trim().max(5000).nullable().optional(),

  contactId: objectId.nullable().optional(),

  companyId: objectId.nullable().optional(),

  dealId: objectId.nullable().optional(),

  assignedTo: objectId.optional(),

  dueAt: z.coerce.date(),

  priority: taskPriority.default("medium"),

  status: taskStatus.default("pending"),

  source: z.enum(["manual", "automation", "system"]).default("manual"),

  metadata: z.record(z.string(), z.any()).optional(),
});

export const updateTaskSchema = createTaskSchema.partial();

export const completeTaskSchema = z.object({});

export const snoozeTaskSchema = z.object({
  snoozedUntil: z.coerce.date(),
});

export const taskIdParamSchema = z.object({
  taskId: objectId,
});

export const taskListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  status: taskStatus.optional(),

  priority: taskPriority.optional(),

  assignedTo: objectId.optional(),

  contactId: objectId.optional(),

  companyId: objectId.optional(),

  dealId: objectId.optional(),

  from: z.coerce.date().optional(),

  to: z.coerce.date().optional(),
});
