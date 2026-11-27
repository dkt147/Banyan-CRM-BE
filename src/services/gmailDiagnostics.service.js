/*
 * Read-only Gmail delivery check (focused test 27 Nov, F1). Only GET calls to the Gmail API:
 *   - the connected account and its send-as addresses (is the From address the account or a verified alias?)
 *   - for each saved Gmail message id: labels (is SENT there?), From / To / Date / Subject headers
 *   - recent bounces in the connected inbox (mailer-daemon / postmaster)
 * Nothing is sent, changed or deleted. No tokens are returned.
 */
import { Integration } from "../models/Integration.js";
import { Message } from "../models/Message.js";
import { AppError } from "../utils/AppError.js";
import { getProviderAccessToken, providerJson } from "./providerApi.service.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const ID_RX = /^[A-Za-z0-9_-]{6,64}$/;

const header = (msg, name) =>
  (msg?.payload?.headers || []).find((h) => String(h.name).toLowerCase() === name.toLowerCase())?.value || null;

export async function gmailDiagnostics(workspaceId, { ids = [], days = 7 } = {}) {
  const integration = await Integration.findOne({ workspaceId, provider: "gmail" }).select("status accountName config.email").lean();
  if (!integration || integration.status !== "connected")
    throw new AppError("Gmail isn't connected.", 503, "GMAIL_NOT_CONNECTED");
  const wanted = [...new Set(ids.map((s) => String(s).trim()).filter(Boolean))].slice(0, 10);
  if (wanted.some((id) => !ID_RX.test(id))) throw new AppError("ids must be Gmail message ids.", 400, "INVALID_IDS");
  const lookback = Math.min(Math.max(Number(days) || 7, 1), 30);

  const token = await getProviderAccessToken(workspaceId, "gmail");
  const get = (path) => providerJson(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "Gmail");

  const configured = integration.config?.email || integration.accountName || null;
  const [profile, sendAsRes] = await Promise.all([get("/profile"), get("/settings/sendAs").catch((e) => ({ error: e.message }))]);
  const sendAs = (sendAsRes.sendAs || []).map((s) => ({
    email: s.sendAsEmail,
    isPrimary: Boolean(s.isPrimary),
    isDefault: Boolean(s.isDefault),
    verificationStatus: s.isPrimary ? "accepted" : s.verificationStatus || null,
  }));
  const fromMatch = sendAs.find((s) => s.email?.toLowerCase() === String(configured || "").toLowerCase());

  const messages = [];
  for (const id of wanted) {
    const saved = await Message.findOne({ workspaceId, "metadata.gmailMessageId": id }).select("sentAt status").lean();
    try {
      const m = await get(`/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Subject&metadataHeaders=Message-ID`);
      messages.push({
        id, found: true, savedInCrm: Boolean(saved), crmStatus: saved?.status || null,
        labelIds: m.labelIds || [], hasSentLabel: (m.labelIds || []).includes("SENT"),
        from: header(m, "From"), to: header(m, "To"), date: header(m, "Date"), subject: header(m, "Subject"),
        messageIdHeader: header(m, "Message-ID"), threadId: m.threadId || null,
      });
    } catch (error) {
      messages.push({ id, found: false, savedInCrm: Boolean(saved), error: String(error.message).slice(0, 200) });
    }
  }

  const q = `from:(mailer-daemon OR postmaster) newer_than:${lookback}d`;
  const list = await get(`/messages?maxResults=10&q=${encodeURIComponent(q)}`).catch((e) => ({ error: e.message }));
  const bounces = [];
  for (const { id } of list.messages || []) {
    const b = await get(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=Subject`).catch(() => null);
    if (b) bounces.push({ id, date: header(b, "Date"), from: header(b, "From"), subject: header(b, "Subject"), snippet: String(b.snippet || "").slice(0, 300) });
  }

  return {
    account: { signedIn: profile.emailAddress || null, configuredFrom: configured },
    fromIsSignedInAccount: Boolean(configured && profile.emailAddress && configured.toLowerCase() === profile.emailAddress.toLowerCase()),
    fromIsVerifiedAlias: Boolean(fromMatch && (fromMatch.isPrimary || fromMatch.verificationStatus === "accepted")),
    sendAs,
    sendAsError: sendAsRes.error ? String(sendAsRes.error).slice(0, 200) : undefined,
    messages,
    bounces: { lookbackDays: lookback, query: q, items: bounces, error: list.error ? String(list.error).slice(0, 200) : undefined },
  };
}
