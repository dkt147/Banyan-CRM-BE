/*
 * WhatsApp (Meta Cloud API), 27 Nov b, B: status check, template messages, linking a sent message to
 * the contact, and clear errors (WHATSAPP_WINDOW_CLOSED, WHATSAPP_NOT_ON_WHATSAPP).
 * Env: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID, WHATSAPP_VERIFY_TOKEN.
 * The token is never logged or returned.
 */
import { env } from "../config/env.js";
import { Activity } from "../models/Activity.js";
import { Contact } from "../models/Contact.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { AppError } from "../utils/AppError.js";

const STATUS_TTL_MS = 5 * 60 * 1000;
const graphBase = () => `https://graph.facebook.com/${String(env.META_GRAPH_API_VERSION || "v26.0").replace(/^v?/, "v")}`;
export const whatsappConfigured = () =>
  Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_BUSINESS_ACCOUNT_ID && env.WHATSAPP_VERIFY_TOKEN);

const digits = (v) => String(v || "").replace(/\D/g, "");
const metaMessage = (data, status) => String(data?.error?.error_data?.details || data?.error?.message || `Meta returned HTTP ${status}`).replace(/[\r\n]/g, " ").slice(0, 300);

async function graph(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${graphBase()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    throw new AppError(`WhatsApp is unreachable: ${error.message}`, 502, "WHATSAPP_API_ERROR");
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** "Hi {{1}}, see you {{2}}" -> highest placeholder number (2). */
export const paramCount = (text) => Math.max(0, ...[...String(text || "").matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
export const fillTemplate = (text, params = []) => String(text || "").replace(/\{\{(\d+)\}\}/g, (all, n) => (params[Number(n) - 1] ?? all));

let statusCache = { at: 0, value: null };
export function resetWhatsAppStatusCache() {
  statusCache = { at: 0, value: null };
}

async function listTemplates() {
  const r = await graph(`/${encodeURIComponent(env.WHATSAPP_BUSINESS_ACCOUNT_ID)}/message_templates?fields=name,language,category,status,components&limit=100`);
  if (!r.ok) throw new AppError(metaMessage(r.data, r.status), 502, "WHATSAPP_API_ERROR");
  return (r.data?.data || []).map((t) => {
    const body = (t.components || []).find((c) => String(c.type).toUpperCase() === "BODY")?.text || "";
    return { name: t.name, language: t.language, category: t.category, status: t.status, body, paramCount: paramCount(body) };
  });
}

/** GET /integrations/whatsapp/status (admin). Cached 5 minutes. Never 503: not set up -> configured false. */
export async function whatsappStatus(workspaceId, { fresh = false } = {}) {
  const [verified, lastInbound] = await Promise.all([
    WebhookEvent.findOne({ provider: "whatsapp", status: { $in: ["processed", "ignored"] } }).sort({ createdAt: -1 }).select("createdAt eventType").lean(),
    Message.findOne({ workspaceId, direction: "inbound", "metadata.provider": "whatsapp" }).sort({ createdAt: -1 }).select("createdAt").lean(),
  ]);
  const local = { webhookVerified: Boolean(verified), webhookVerifiedAt: verified?.createdAt || null, lastInboundAt: lastInbound?.createdAt || null };
  if (!whatsappConfigured()) {
    const missing = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_VERIFY_TOKEN"].filter((k) => !env[k]);
    return { configured: false, displayPhoneNumber: null, verifiedName: null, qualityRating: null, ...local, templates: [], error: `Not set on the server: ${missing.join(", ")}.` };
  }
  if (!fresh && statusCache.value && Date.now() - statusCache.at < STATUS_TTL_MS) return { ...statusCache.value, ...local };
  const value = { configured: false, displayPhoneNumber: null, verifiedName: null, qualityRating: null, templates: [], error: null };
  const phone = await graph(`/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}?fields=display_phone_number,verified_name,quality_rating`).catch((e) => ({ ok: false, data: { error: { message: e.message } } }));
  if (phone.ok) {
    Object.assign(value, { configured: true, displayPhoneNumber: phone.data.display_phone_number || null, verifiedName: phone.data.verified_name || null, qualityRating: phone.data.quality_rating || null });
    try {
      value.templates = await listTemplates();
    } catch (error) {
      value.error = error.message;
    }
  } else value.error = metaMessage(phone.data, phone.status);
  statusCache = { at: Date.now(), value };
  return { ...value, ...local };
}

/* ---------- sending ---------- */

const TEMPLATE_NAME_RX = /^[a-z0-9_]{1,512}$/;

/** Validated request -> { to, text?, template? }. */
export function parseSendBody(body = {}) {
  const to = digits(body.to);
  if (to.length < 8 || to.length > 15) throw new AppError("to must be a phone number in international format.", 400, "INVALID_WHATSAPP_RECIPIENT");
  if (body.template !== undefined && body.template !== null) {
    const t = body.template;
    if (typeof t !== "object") throw new AppError("template must be { name, language, params }.", 400, "INVALID_WHATSAPP_TEMPLATE");
    const name = String(t.name || "");
    if (!TEMPLATE_NAME_RX.test(name)) throw new AppError("template.name must be lowercase letters, numbers and underscores.", 400, "INVALID_WHATSAPP_TEMPLATE");
    const language = String(t.language || "en").trim();
    if (!/^[a-zA-Z_]{2,15}$/.test(language)) throw new AppError("template.language must be a code such as en or zh_HK.", 400, "INVALID_WHATSAPP_TEMPLATE");
    const params = t.params === undefined ? [] : t.params;
    if (!Array.isArray(params) || params.length > 10) throw new AppError("template.params must be a list of at most 10 values.", 400, "INVALID_WHATSAPP_TEMPLATE");
    const clean = params.map((p) => String(p ?? ""));
    if (clean.some((p) => p.length < 1 || p.length > 1024)) throw new AppError("Each template parameter must be 1 to 1024 characters.", 400, "INVALID_WHATSAPP_TEMPLATE");
    return { to, template: { name, language, params: clean } };
  }
  const text = String(body.text || "").trim();
  if (!text) throw new AppError("text is required.", 400, "WHATSAPP_TEXT_REQUIRED");
  if (text.length > 4096) throw new AppError("WhatsApp text messages must not exceed 4096 characters.", 400, "WHATSAPP_TEXT_TOO_LONG");
  return { to, text };
}

/** Sends through Meta. Returns { providerMessageId }. Maps 131047 / 131026; other errors -> 502. */
export async function sendViaMeta({ to, text, template }) {
  const payload = template
    ? {
        messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
        template: {
          name: template.name, language: { code: template.language },
          ...(template.params.length ? { components: [{ type: "body", parameters: template.params.map((p) => ({ type: "text", text: p })) }] } : {}),
        },
      }
    : { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text } };
  const r = await graph(`/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, { method: "POST", body: payload });
  if (!r.ok) {
    const code = Number(r.data?.error?.code);
    if (code === 131047)
      throw new AppError("This person hasn't messaged in the last 24 hours. Use an approved template.", 409, "WHATSAPP_WINDOW_CLOSED");
    if (code === 131026) throw new AppError("This number isn't on WhatsApp, or can't receive messages.", 422, "WHATSAPP_NOT_ON_WHATSAPP");
    throw new AppError(metaMessage(r.data, r.status), 502, "WHATSAPP_API_ERROR");
  }
  const providerMessageId = r.data?.messages?.[0]?.id;
  if (!providerMessageId) throw new AppError("WhatsApp did not return a message ID.", 502, "WHATSAPP_MESSAGE_ID_MISSING");
  return { providerMessageId };
}

/** The text stored for a template message: its body with {{n}} filled in. */
export async function templateText(template) {
  let body = "";
  try {
    const status = await whatsappStatus(null);
    body = status.templates?.find((t) => t.name === template.name && (t.language === template.language || !t.language))?.body || "";
  } catch {
    // Fall back to a short label below.
  }
  return body ? fillTemplate(body, template.params) : `[Template: ${template.name}]${template.params.length ? ` ${template.params.join(" · ")}` : ""}`;
}

/**
 * Conversation for a contact: the existing WhatsApp thread for this number (so replies join it), else
 * the contact's thread, else a new one.
 */
export async function conversationForContact(workspaceId, contact, to) {
  let conversation =
    (await Conversation.findOne({ workspaceId, channel: "whatsapp", externalThreadId: to })) ||
    (await Conversation.findOne({ workspaceId, channel: "whatsapp", contactId: contact._id }).sort({ lastMessageAt: -1 }));
  if (!conversation) {
    conversation = await Conversation.create({
      workspaceId, channel: "whatsapp", externalThreadId: to, contactId: contact._id,
      participantName: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || to, participantAddress: to, status: "open",
    });
  } else if (!conversation.contactId) {
    conversation.contactId = contact._id;
  }
  return conversation;
}

export async function logWhatsAppSent(workspaceId, user, contact, conversation, text) {
  await Activity.create({
    workspaceId, userId: user._id, type: "whatsapp_sent", contactId: contact._id, companyId: contact.companyId || undefined,
    subject: `WhatsApp sent: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`, body: text.slice(0, 2000),
    metadata: { conversationId: String(conversation._id) },
  }).catch((error) => console.error("[whatsapp] activity failed:", error.message));
}

export async function loadContact(workspaceId, contactId) {
  const contact = await Contact.findOne({ _id: contactId, workspaceId }).select("firstName lastName companyId").lean().catch(() => null);
  if (!contact) throw new AppError("Contact not found.", 404, "NOT_FOUND");
  return contact;
}

/** Phone variants for matching an inbound WhatsApp number: with and without the 852 prefix. */
export function phoneVariants(from) {
  const d = digits(from);
  const out = new Set([d]);
  if (d.startsWith("852") && d.length === 11) out.add(d.slice(3));
  if (d.length === 8) out.add(`852${d}`);
  return [...out];
}
