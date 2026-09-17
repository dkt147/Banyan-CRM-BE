import { z } from "zod";

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");

const dealStatus = z.enum([
  "open",
  "won",
  "lost"
]);

const productTypes = z.enum([
  "membership",
  "private_office",
  "venue_hire",
  "transactional",
  "meeting_room",
  "day_pass",
  "virtual_office",
  "studio",
  "other"
]);

export const createDealSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Deal title is required")
    .max(200),

  contactId: objectId,

  companyId: objectId
    .nullable()
    .optional(),

  pipelineId: objectId,

  stageId: objectId,

  value: z
    .number()
    .min(0)
    .default(0),

  currency: z
    .string()
    .trim()
    .length(3)
    .toUpperCase()
    .default("HKD"),

  productType: productTypes.default("other"),

  source: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional(),

  expectedCloseDate: z
    .coerce
    .date()
    .nullable()
    .optional(),

  status: dealStatus.optional(),

  lostReason: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional(),

  description: z
    .string()
    .trim()
    .max(5000)
    .nullable()
    .optional(),

  nextActionAt: z
    .coerce
    .date()
    .nullable()
    .optional(),

  metadata: z
    .record(z.string(), z.any())
    .optional()
});

export const updateDealSchema =
  createDealSchema.partial();

export const moveDealSchema = z.object({
  stageId: objectId
});

export const dealIdParamSchema = z.object({
  dealId: objectId
});

export const dealListQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),

  search: z
    .string()
    .trim()
    .max(200)
    .optional(),

  pipelineId: objectId.optional(),

  stageId: objectId.optional(),

  status: dealStatus.optional(),

  contactId: objectId.optional(),

  companyId: objectId.optional()
});