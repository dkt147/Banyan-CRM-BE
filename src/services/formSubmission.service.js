/*
 * Public form submissions (feedback 17 Nov, #5): POST /api/v1/public/forms/:slug.
 *
 * Every submission is stored as a FormSubmission. Then:
 *  - a form with an "interests" field and no pipeline behaves exactly like the website enquiry form
 *    (createPublicEnquiry: SERVICE_ROUTING pipelines, contact, deal(s), follow-up task, activity);
 *  - otherwise: contact found by email then phone (or created), mapped fields applied, optional deal
 *    in the form's pipeline/stage, optional task, timeline activity.
 * In both cases the form's tags, consent and staff notifications are applied.
 */
import { Activity } from "../models/Activity.js";
import { Company } from "../models/Company.js";
import { Deal } from "../models/Deal.js";
import { Form } from "../models/Form.js";
import { FormSubmission } from "../models/FormSubmission.js";
import { Notification } from "../models/Notification.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { Contact } from "../models/Contact.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { escapeRegex, normalizePhone } from "../utils/phone.js";
import { normalizeTags } from "../utils/contactTags.js";
import { publicEnquirySchema } from "../validators/publicEnquiry.validators.js";
import { findOrCreateContact } from "./contactMatching.service.js";
import { sendWorkspaceEmail } from "./mail.service.js";
import { createPublicEnquiry, endOfDayInTimeZone, getIntakeContext } from "./publicEnquiry.service.js";

const HONEYPOT_KEYS = ["website", "_honeypot", "website_confirm"];
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TICKED = new Set(["yes", "true", "on", "1"]);

export function normalizeOrigin(value) {
  try {
    return value ? new URL(String(value)).origin : "";
  } catch {
    return "";
  }
}

/** Origins allowed to post to a form: its own list, or the website and CRM when the list is empty. */
export function allowedOriginsFor(form) {
  const list = form.allowedOrigins?.length ? form.allowedOrigins : [env.PUBLIC_WEBSITE_URL, env.CLIENT_URL];
  return new Set(list.map(normalizeOrigin).filter(Boolean));
}

export async function findPublicForm(slug, publicKey) {
  if (!slug || !publicKey || typeof publicKey !== "string") return null;
  return Form.findOne({ slug: String(slug).toLowerCase(), publicKey, isActive: true });
}

/** Validate submitted values against the form's fields. Returns { values, mapped } or throws 400. */
export function validateSubmission(form, body = {}) {
  const values = {};
  const mapped = {};
  const errors = [];
  for (const field of form.fields || []) {
    // Checkbox groups arrive as key[] (urlencoded, parsed to an array) or as an array in JSON.
    let raw = body[field.key] ?? body[`${field.key}[]`];
    let value;
    if (field.type === "checkboxes") {
      const list = (Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : String(raw).split(/[;,\n]/))
        .map((v) => String(v).trim())
        .filter(Boolean);
      const bad = list.find((v) => !field.options.includes(v));
      if (bad) errors.push(`"${bad}" is not an option for ${field.label}.`);
      value = [...new Set(list)];
      if (field.required && !value.length) errors.push(`Please choose at least one option for ${field.label}.`);
    } else {
      if (Array.isArray(raw)) raw = raw[0];
      value = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
      const max = field.type === "textarea" ? 5000 : 300;
      if (value.length > max) errors.push(`${field.label} must be ${max} characters or fewer.`);
      if (field.required && !value) errors.push(`${field.label} is required.`);
      if (value && field.type === "email" && !EMAIL_RX.test(value)) errors.push(`Enter a valid email address for ${field.label}.`);
      if (value && field.type === "tel" && normalizePhone(value).length < 6) errors.push(`Enter a valid phone number for ${field.label}.`);
      if (value && field.type === "select" && !field.options.includes(value)) errors.push(`"${value}" is not an option for ${field.label}.`);
    }
    values[field.key] = value;
    if (field.mapTo) mapped[field.mapTo] = value;
  }
  if (mapped.email && !EMAIL_RX.test(mapped.email)) errors.push("Enter a valid email address.");
  if (!mapped.email && !normalizePhone(mapped.phone)) errors.push("Please give an email address or phone number.");
  if (errors.length) throw new AppError(errors[0], 400, "FORM_VALIDATION_FAILED", { errors });
  return { values, mapped };
}

async function formOwner(form) {
  const owner =
    (await User.findOne({ _id: form.createdBy, workspaceId: form.workspaceId, isActive: true }).select("_id name")) ||
    (await User.findOne({ workspaceId: form.workspaceId, role: "admin", isActive: true }).sort({ createdAt: 1 }).select("_id name"));
  if (!owner) throw new AppError("This form is not available right now.", 503, "FORM_OWNER_NOT_CONFIGURED");
  return owner;
}

function splitName(mapped) {
  let firstName = String(mapped.firstName || "").trim();
  let lastName = String(mapped.lastName || "").trim();
  if (!firstName && mapped.email) firstName = mapped.email.split("@")[0];
  return { firstName: firstName || "Guest", lastName };
}

async function applyContactExtras(contact, form, mapped, consent, meta) {
  contact.tags = normalizeTags([...(contact.tags || []), ...(form.tagsToApply || []), "form_submission"]).slice(0, 30);
  if (mapped.notes && !contact.notes) contact.notes = mapped.notes.slice(0, 5000);
  if (mapped.company && !contact.companyId) {
    // Link only to an existing company with the same name; never create companies from public input.
    const company = await Company.findOne({ workspaceId: form.workspaceId, name: { $regex: `^${escapeRegex(mapped.company)}$`, $options: "i" } }).select("_id");
    if (company) contact.companyId = company._id;
    else contact.metadata = { ...(contact.metadata || {}), companyName: mapped.company.slice(0, 200) };
  }
  if (mapped.interests?.length) contact.metadata = { ...(contact.metadata || {}), interests: mapped.interests };
  if (consent) {
    contact.marketingConsentAt = new Date();
    contact.consentSource = form.slug;
    contact.consentText = form.consentText || null;
    contact.consentIp = meta.ip || null;
  }
  contact.markModified("metadata");
  await contact.save();
}

async function notifyStaff(form, owner, contact, values, dealId) {
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  await Notification.create({
    workspaceId: form.workspaceId,
    userId: owner._id,
    type: "form_submission",
    title: `New ${form.name} submission`,
    body: `${fullName || contact.email || "Someone"} sent the ${form.name} form.`,
    entityType: dealId ? "deal" : "contact",
    entityId: dealId || contact._id,
    channel: "in_app",
  }).catch(() => {});
  if (!form.notifyEmails?.length) return;
  const lines = (form.fields || []).map((f) => {
    const v = values[f.key];
    return `${f.label}: ${Array.isArray(v) ? v.join(", ") : v || "—"}`;
  });
  const text = `New submission of "${form.name}".\n\n${lines.join("\n")}\n\nOpen the contact in Banyan CRM: ${env.CLIENT_URL.replace(/\/+$/, "")}/contacts/${contact._id}`;
  for (const to of form.notifyEmails) {
    await sendWorkspaceEmail(form.workspaceId, { to, subject: `New ${form.name} submission – ${fullName || contact.email || ""}`.trim(), text, label: "Form notification" })
      .catch((error) => console.error("[forms] notification email failed:", error.message));
  }
}

/**
 * Process one submission. meta: { ip, userAgent, sourceUrl }.
 * Returns { submissionId, contactId, dealIds }.
 */
export async function processFormSubmission(form, body, meta = {}) {
  const { values, mapped } = validateSubmission(form, body);
  const consent = TICKED.has(String(body.consent ?? "").toLowerCase());
  const submission = await FormSubmission.create({
    workspaceId: form.workspaceId,
    formId: form._id,
    payload: { values, consent },
    status: "received",
    sourceUrl: meta.sourceUrl ? String(meta.sourceUrl).slice(0, 500) : undefined,
    ip: meta.ip,
    userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 300) : undefined,
  });

  try {
    const owner = await formOwner(form);
    let contact;
    let dealIds = [];

    // Copied website enquiry form: identical routing to POST /public/enquiries.
    const interestsField = (form.fields || []).find((f) => f.mapTo === "interests");
    const intake = interestsField && !form.pipelineId ? await getIntakeContext().catch(() => null) : null;
    if (intake && String(intake.workspace._id) === String(form.workspaceId)) {
      const { firstName, lastName } = splitName(mapped);
      const payload = publicEnquirySchema.parse({
        firstName, lastName: lastName || "-", email: mapped.email, phone: mapped.phone || "",
        interests: Array.isArray(mapped.interests) ? mapped.interests : [mapped.interests].filter(Boolean),
        notes: mapped.notes || "",
      });
      const result = await createPublicEnquiry(payload);
      contact = await Contact.findById(result.contactId);
      dealIds = result.deals.map((d) => d.id);
    } else {
      const { firstName, lastName } = splitName(mapped);
      ({ contact } = await findOrCreateContact(form.workspaceId, owner._id, { firstName, lastName, email: mapped.email, phone: mapped.phone }, { source: "form" }));
      const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

      if (form.pipelineId) {
        const pipeline = await Pipeline.findOne({ _id: form.pipelineId, workspaceId: form.workspaceId, isActive: { $ne: false } });
        const stage = pipeline
          ? form.stageId
            ? await PipelineStage.findOne({ _id: form.stageId, workspaceId: form.workspaceId, pipelineId: pipeline._id })
            : await PipelineStage.findOne({ workspaceId: form.workspaceId, pipelineId: pipeline._id, isActive: true }).sort({ sortOrder: 1 })
          : null;
        if (stage) {
          const deal = await Deal.create({
            workspaceId: form.workspaceId,
            title: `${form.name} — ${fullName || contact.email || "submission"}`.slice(0, 200),
            contactId: contact._id,
            companyId: contact.companyId,
            pipelineId: pipeline._id,
            stageId: stage._id,
            ownerId: contact.ownerId || owner._id,
            source: "form",
            status: "open",
            description: mapped.notes || `Submitted the ${form.name} form.`,
            lastActivityAt: new Date(),
            stageChangedAt: new Date(),
            metadata: { formId: String(form._id), formSlug: form.slug, submissionId: String(submission._id), interests: mapped.interests || [] },
          });
          dealIds = [String(deal._id)];
        }
      }
      if (form.createTask) {
        await Task.create({
          workspaceId: form.workspaceId,
          title: `Follow up: ${form.name} — ${fullName || contact.email || ""}`.slice(0, 200),
          description: `Submitted the ${form.name} form.${mapped.notes ? ` Notes: ${mapped.notes}` : ""}`.slice(0, 5000),
          contactId: contact._id,
          dealId: dealIds[0],
          assignedTo: contact.ownerId || owner._id,
          createdBy: owner._id,
          dueAt: endOfDayInTimeZone(new Date()),
          priority: "high",
          status: "pending",
          source: "system",
          metadata: { origin: "form_submission", formId: String(form._id) },
        }).catch((error) => console.error("[forms] task failed:", error.message));
      }
      await Activity.create({
        workspaceId: form.workspaceId,
        userId: owner._id,
        type: "form_submission",
        contactId: contact._id,
        dealId: dealIds[0],
        subject: `${form.name} submitted`,
        body: (mapped.notes || "").slice(0, 2000) || undefined,
        occurredAt: new Date(),
        metadata: { formId: String(form._id), formSlug: form.slug, submissionId: String(submission._id) },
      }).catch((error) => console.error("[forms] activity failed:", error.message));
    }

    await applyContactExtras(contact, form, mapped, consent, meta);
    await notifyStaff(form, owner, contact, values, dealIds[0]);
    submission.status = "processed";
    submission.contactId = contact._id;
    if (dealIds[0]) submission.dealId = dealIds[0];
    submission.processedAt = new Date();
    await submission.save();
    return { submissionId: String(submission._id), contactId: String(contact._id), dealIds };
  } catch (error) {
    submission.status = "failed";
    submission.error = String(error.message).slice(0, 500);
    await submission.save().catch(() => {});
    throw error;
  }
}

/** Honeypot hit: keep a record marked spam, do nothing else. */
export function isHoneypot(body = {}) {
  return HONEYPOT_KEYS.some((k) => typeof body[k] === "string" && body[k].trim());
}

export async function recordSpam(form, meta) {
  await FormSubmission.create({ workspaceId: form.workspaceId, formId: form._id, status: "spam", ip: meta.ip, userAgent: meta.userAgent }).catch(() => {});
}
