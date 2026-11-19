import { z } from "zod";
import { tagsInputSchema } from "./contact.validators.js";

/* Forms (feedback 17 Nov, #5). Payload shape matches Banyan-CRM-Admin src/pages/Forms.jsx. */
export const FORM_TYPES = ["enquiry", "contact", "walk_in", "newsletter"];
export const FIELD_TYPES = ["text", "email", "tel", "textarea", "checkboxes", "select"];
// source: "How did you hear about us?" (contact.source when empty); newsletterOptIn: Yes/No marketing consent.
export const MAP_TO = ["firstName", "lastName", "email", "phone", "company", "interests", "notes", "source", "newsletterOptIn"];
export const FORM_LAYOUTS = ["centered", "image-left"];
const hexColor = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Colours are hex values like #2D5F4C.");
const designSchema = z
  .object({
    title: z.string().trim().max(160).optional(),
    intro: z.string().trim().max(1000).optional(),
    buttonText: z.string().trim().max(40).optional(),
    successMessage: z.string().trim().max(300).optional(),
    layout: z.enum(FORM_LAYOUTS).optional(),
    imageUrl: z.union([z.literal(""), z.string().trim().max(500).url().refine((u) => u.startsWith("https://"), "The image must be an https:// address.")]).optional(),
    headingFont: z.string().trim().max(60).optional(),
    bodyFont: z.string().trim().max(60).optional(),
    colors: z
      .object({ text: hexColor, button: hexColor, buttonHover: hexColor, buttonText: hexColor, background: hexColor, page: hexColor })
      .partial()
      .strict()
      .optional(),
  })
  .strict();
// Field keys that the public endpoint reserves for itself.
const RESERVED_KEYS = new Set(["publickey", "consent", "website", "_honeypot", "website_confirm"]);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ID");

const originSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) throw new Error();
      return url.origin;
    } catch {
      ctx.addIssue({ code: "custom", message: `"${value}" is not a valid website address (e.g. https://banyanworkspace.com).` });
      return z.NEVER;
    }
  });

const fieldSchema = z.object({
  key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/, "Field keys use letters, numbers and _ and start with a letter."),
  label: z.string().trim().min(1, "Every field needs a label.").max(200),
  type: z.enum(FIELD_TYPES),
  mapTo: z.enum(MAP_TO).nullable().optional().default(null),
  required: z.boolean().optional().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(50).optional().default([]),
  placeholder: z.string().trim().max(200).optional(),
});

const baseForm = {
  name: z.string().trim().min(1, "Form name is required.").max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/, "Slug uses lowercase letters, numbers and hyphens."),
  type: z.enum(FORM_TYPES),
  description: z.string().trim().max(2000).nullable().optional(),
  fields: z.array(fieldSchema).min(1, "Add at least one field.").max(40),
  consentText: z.string().trim().max(1000).nullable().optional(),
  tagsToApply: tagsInputSchema.optional(),
  pipelineId: objectId.nullable().optional(),
  stageId: objectId.nullable().optional(),
  createTask: z.boolean().optional(),
  notifyEmails: z.array(z.string().trim().toLowerCase().email("Invalid notification email.")).max(10).optional(),
  allowedOrigins: z.array(originSchema).max(10).optional(),
  isActive: z.boolean().optional(),
  design: designSchema.nullable().optional(),
  flodesk: z.object({ enabled: z.boolean() }).strict().optional(),
};

function checkFields(form, ctx) {
  if (form.fields) {
    const keys = new Set();
    const maps = new Set();
    form.fields.forEach((f, i) => {
      const key = f.key.toLowerCase();
      if (keys.has(key)) ctx.addIssue({ code: "custom", path: ["fields", i, "key"], message: `Field key "${f.key}" is used twice.` });
      if (RESERVED_KEYS.has(key)) ctx.addIssue({ code: "custom", path: ["fields", i, "key"], message: `"${f.key}" is reserved; choose another key.` });
      keys.add(key);
      if (["checkboxes", "select"].includes(f.type) && !f.options.length)
        ctx.addIssue({ code: "custom", path: ["fields", i, "options"], message: `"${f.label}" needs at least one option.` });
      if (f.mapTo) {
        if (maps.has(f.mapTo)) ctx.addIssue({ code: "custom", path: ["fields", i, "mapTo"], message: `Only one field can map to ${f.mapTo}.` });
        maps.add(f.mapTo);
      }
    });
    if (!maps.has("email") && !maps.has("phone"))
      ctx.addIssue({ code: "custom", path: ["fields"], message: "Map at least one field to Email or Phone so submissions can be linked to a contact." });
  }
  if (form.stageId && !form.pipelineId) ctx.addIssue({ code: "custom", path: ["stageId"], message: "Choose a pipeline for this stage." });
}

export const createFormSchema = z.object(baseForm).superRefine(checkFields);
// PATCH: parse the partial body, then validate the merged form with createFormSchema.
export const updateFormSchema = z.object(baseForm).partial();
