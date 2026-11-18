import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");

import { MAX_TAGS_PER_CONTACT, TAG_PATTERN, normalizeTag, normalizeTags } from "../utils/contactTags.js";

// Tags: catalogue keys or custom snake_case keys. Input is normalised first ("Active Member" ->
// "active_member"), then validated, so the stored list is always clean. A value with nothing usable
// in it ("!!!") is rejected with INVALID_TAG instead of being dropped silently.
export const tagsInputSchema = z
  .array(z.string().max(200))
  .superRefine((values, ctx) => {
    const invalid = values.filter((v) => !normalizeTag(v));
    if (!invalid.length) return;
    const list = invalid.map((v) => JSON.stringify(v)).join(", ");
    ctx.addIssue({
      code: "custom",
      message: `${list} can't be ${invalid.length > 1 ? "tags" : "a tag"}. Use letters or numbers.`,
      params: { code: "INVALID_TAG", invalid },
    });
  })
  .transform((values) => normalizeTags(values))
  .pipe(
    z
      .array(z.string().regex(TAG_PATTERN, "Tags must be lowercase letters, numbers and underscores (max 50)."))
      .max(MAX_TAGS_PER_CONTACT, `A contact can have at most ${MAX_TAGS_PER_CONTACT} tags.`),
  );
const tagsSchema = tagsInputSchema;
// List filter: "a,b" means the contact has all of them.
const tagFilterSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value) => normalizeTags(value.split(",")))
  .refine((tags) => tags.length > 0 && tags.length <= 10 && tags.every((t) => TAG_PATTERN.test(t)), "Invalid tag filter.");
export { normalizeTag };

export const createContactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),

  lastName: z.string().trim().max(100).optional().default(""),

  email: z.string().trim().email("Invalid email address").nullable().optional(),

  phone: z.string().trim().max(50).nullable().optional(),

  whatsapp: z.string().trim().max(50).nullable().optional(),

  jobTitle: z.string().trim().max(150).nullable().optional(),

  companyId: objectId.nullable().optional(),

  tags: tagsSchema.optional(),

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

  tag: tagFilterSchema.optional(),

  isArchived: z
    // "all" returns active and archived records.
    .enum(["true", "false", "all"])
    .transform((value) => (value === "all" ? null : value === "true"))
    .default("false"),
});
