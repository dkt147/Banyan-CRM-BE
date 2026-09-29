import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");

const activityTypes = z.enum([
  "note",
  "call",
  "email",
  "whatsapp",
  "meeting",
  "stage_change",
  "deal_created",
  "task_created",
]);

export const createActivitySchema = z.object({
  type: activityTypes,

  contactId: objectId.nullable().optional(),

  companyId: objectId.nullable().optional(),

  dealId: objectId.nullable().optional(),

  subject: z.string().trim().max(200).nullable().optional(),

  body: z.string().trim().max(10000).nullable().optional(),

  occurredAt: z.coerce.date().optional(),

  metadata: z.record(z.string(), z.any()).optional(),
});

export const activityIdParamSchema = z.object({
  activityId: objectId,
});

export const activityListQuerySchema = z.object({
  contactId: objectId.optional(),

  companyId: objectId.optional(),

  dealId: objectId.optional(),

  type: activityTypes.optional(),

  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(50),
});
