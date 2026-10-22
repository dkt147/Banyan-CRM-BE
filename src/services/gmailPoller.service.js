import { Integration } from "../models/Integration.js";
import { Contact } from "../models/Contact.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { Task } from "../models/Task.js";
import { getProviderAccessToken, providerJson } from "./providerApi.service.js";

let running = false;
function header(message, name) { return (message.payload?.headers || []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || ""; }
function email(value) { const raw = String(value || "").trim(); const match = raw.match(/<([^<>]+)>/); const result = (match?.[1] || raw).trim().toLowerCase(); return result.includes("@") ? result : ""; }
function display(value, fallback) { return String(value || "").replace(/<[^<>]+>/g, "").replace(/^"|"$/g, "").trim() || fallback || "Email lead"; }
function bodyText(payload) {
  if (!payload) return "";
  const decode = (data) => { try { return Buffer.from(String(data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { return ""; } };
  if (payload.mimeType === "text/plain" && payload.body?.data) return decode(payload.body.data);
  for (const part of payload.parts || []) { const found = bodyText(part); if (found) return found; }
  if (payload.mimeType === "text/html" && payload.body?.data) return decode(payload.body.data).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}
function dueTodayHongKong() { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)])); return new Date(Date.UTC(p.year, p.month - 1, p.day, 15, 59, 59, 999)); }
export async function pollGmailInboxes() {
  if (running) return; running = true;
  try {
    const integrations = await Integration.find({ provider: "gmail", status: "connected" }).select("workspaceId accountName config").lean();
    for (const integration of integrations) {
      try {
        const token = await getProviderAccessToken(integration.workspaceId, "gmail");
        const list = await providerJson("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:2d&maxResults=50", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "Gmail background sync");
        const connectedEmail = String(integration.config?.email || integration.accountName || "").toLowerCase();
        for (const item of list.messages || []) {
          if (await Message.exists({ workspaceId: integration.workspaceId, "metadata.gmailMessageId": item.id })) continue;
          const message = await providerJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "Gmail message fetch");
          const from = email(header(message, "From")); const to = email(header(message, "To"));
          const direction = connectedEmail && from === connectedEmail ? "outbound" : "inbound";
          if (direction !== "inbound") continue;
          const participantEmail = from; if (!participantEmail) continue;
          const name = display(header(message, "From"), participantEmail); const subject = header(message, "Subject") || "(no subject)";
          let contact = await Contact.findOne({ workspaceId: integration.workspaceId, email: participantEmail });
          let owner = null;
          if (!contact) {
            owner = await User.findOne({ workspaceId: integration.workspaceId, role: "admin", isActive: true }).sort({ createdAt: 1 });
            if (!owner) owner = await User.findOne({ workspaceId: integration.workspaceId, isActive: true }).sort({ createdAt: 1 });
            if (owner) contact = await Contact.findOneAndUpdate({ workspaceId: integration.workspaceId, email: participantEmail }, { $setOnInsert: { workspaceId: integration.workspaceId, ownerId: owner._id, firstName: name.slice(0, 100), lastName: "", email: participantEmail, source: "email", tags: ["email_lead"], notes: "Contact created automatically from an inbound email." } }, { upsert: true, new: true, setDefaultsOnInsert: true });
          }
          const threadId = message.threadId || message.id;
          const prior = await Conversation.findOne({ workspaceId: integration.workspaceId, channel: "email", externalThreadId: threadId }).select("_id").lean();
          const conversation = await Conversation.findOneAndUpdate({ workspaceId: integration.workspaceId, channel: "email", externalThreadId: threadId }, { $setOnInsert: { workspaceId: integration.workspaceId, channel: "email", externalThreadId: threadId, contactId: contact?._id, participantName: name, participantAddress: participantEmail, status: "open" }, $set: { lastMessageAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(), subject }, $inc: { unreadCount: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true });
          await Message.create({ workspaceId: integration.workspaceId, conversationId: conversation._id, direction: "inbound", senderName: name, senderAddress: from, body: String(bodyText(message.payload) || "[Email message has no readable text body]").slice(0, 10000), sentAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(), status: "received", metadata: { provider: "gmail", gmailMessageId: message.id, gmailThreadId: threadId, subject, to: header(message, "To") } });
          if (!prior) {
            owner ||= await User.findOne({ workspaceId: integration.workspaceId, role: "admin", isActive: true }).sort({ createdAt: 1 });
            if (owner) await Task.create({ workspaceId: integration.workspaceId, title: `Respond to new email enquiry — ${name}`.slice(0, 200), description: `Review the new inbound email: ${subject}. Reply today and create a deal once the requested service is clear.`, contactId: contact?._id, assignedTo: owner._id, createdBy: owner._id, dueAt: dueTodayHongKong(), priority: "high", source: "system", metadata: { trigger: "new_inbound_email", conversationId: String(conversation._id) } });
          }
        }
        await Integration.updateOne({ workspaceId: integration.workspaceId, provider: "gmail" }, { $set: { lastSyncedAt: new Date() } });
      } catch (error) { console.error("[gmail-poller] workspace sync failed:", error.message); }
    }
  } catch (error) { console.error("[gmail-poller] failed:", error.message); }
  finally { running = false; }
}
