import { z } from "zod";

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");

const addressSchema = z
  .object({
    street: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(100).nullable().optional(),
    country: z.string().trim().max(100).nullable().optional(),
    postalCode: z.string().trim().max(30).nullable().optional()
  })
  .optional();

export const createCompanySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters")
    .max(200),

  legalName: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional(),

  industry: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional(),

  website: z
    .string()
    .trim()
    .url("Invalid website URL")
    .nullable()
    .optional(),

  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .nullable()
    .optional(),

  phone: z
    .string()
    .trim()
    .max(50)
    .nullable()
    .optional(),

  address: addressSchema,

  tags: z
    .array(z.string().trim().min(1).max(50))
    .max(50)
    .optional(),

  notes: z
    .string()
    .trim()
    .max(5000)
    .nullable()
    .optional(),

  isArchived: z
    .boolean()
    .optional()
});

export const updateCompanySchema =
  createCompanySchema.partial();

export const companyIdParamSchema = z.object({
  companyId: objectId
});

export const companyListQuerySchema = z.object({
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

  isArchived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("false")
});