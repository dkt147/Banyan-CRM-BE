import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");

  const contactTags = [
    "prospect",
    "active_member",
    "past_member",
    "event_client",
    "broker_agent",
    "ngo",
    "vip",
  ];

export const createContactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),

  lastName: z.string().trim().max(100).optional().default(""),

  email: z.string().trim().email("Invalid email address").nullable().optional(),

  phone: z.string().trim().max(50).nullable().optional(),

  whatsapp: z.string().trim().max(50).nullable().optional(),

  jobTitle: z.string().trim().max(150).nullable().optional(),

  companyId: objectId.nullable().optional(),

  tags: z.array(z.enum(contactTags)).max(20).optional(),

  source: z.string().trim().max(100).nullable().optional(),

  language: z.string().trim().min(2).max(10).default("en"),

  notes: z.string().trim().max(5000).nullable().optional(),

  isArchived: z.boolean().optional(),
});

export const updateContactSchema = createContactSchema.partial();

export const contactIdParamSchema = z.object({
  contactId: objectId,
});

export const contactListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  search: z.string().trim().max(200).optional(),

  companyId: objectId.optional(),

  isArchived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("false"),
});
