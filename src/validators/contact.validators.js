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

// Partial updates must not re-apply create-time defaults (Zod applies .default()
// inside .partial(), which used to blank lastName and reset language on every PATCH).
export const updateContactSchema = createContactSchema.extend({
  lastName: z.string().trim().max(100),
  language: z.string().trim().min(2).max(10),
}).partial();

export const contactIdParamSchema = z.object({
  contactId: objectId,
});

export const contactListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),

  limit: z.coerce.number().int().min(1).max(100).default(20),

  search: z.string().trim().max(200).optional(),

  companyId: objectId.optional(),

  ownerId: objectId.optional(),

  tag: z.enum(contactTags).optional(),

  isArchived: z
    // "all" returns active and archived records.
    .enum(["true", "false", "all"])
    .transform((value) => (value === "all" ? null : value === "true"))
    .default("false"),
});
