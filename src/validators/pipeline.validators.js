import { z } from "zod";

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Key may only contain letters, numbers, underscores and hyphens"
  );

export const createPipelineSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Pipeline name is required")
    .max(150),

  key: keySchema,

  description: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional(),

  isActive: z
    .boolean()
    .optional(),

  sortOrder: z
    .number()
    .int()
    .min(0)
    .optional()
});

export const updatePipelineSchema =
  createPipelineSchema.partial();

export const pipelineIdParamSchema = z.object({
  pipelineId: objectId
});

export const pipelineStageIdParamSchema = z.object({
  stageId: objectId
});

export const createPipelineStageSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Stage name is required")
    .max(150),

  key: keySchema,

  sortOrder: z
    .number()
    .int()
    .min(0)
    .default(0),

  probability: z
    .number()
    .min(0)
    .max(100)
    .default(0),

  isClosedWon: z
    .boolean()
    .default(false),

  isClosedLost: z
    .boolean()
    .default(false),

  isActive: z
    .boolean()
    .default(true)
});

export const updatePipelineStageSchema =
  createPipelineStageSchema.partial();

export const pipelineListQuerySchema = z.object({
  includeInactive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("false")
});