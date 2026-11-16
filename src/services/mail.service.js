/*
 * Send email through the workspace's connected Gmail account (server-side jobs: renewal reminders,
 * form notifications). Returns false when Gmail is not connected instead of throwing.
 */
import { Integration } from "../models/Integration.js";
import { buildMime, toGmailRaw } from "../utils/mail.js";
import { getProviderAccessToken, providerJson } from "./providerApi.service.js";

export async function sendWorkspaceEmail(workspaceId, { to, subject, text, html, label = "Gmail send" }) {
  const integration = await Integration.findOne({ workspaceId, provider: "gmail", status: "connected" }).lean();
  if (!integration) return false;
  const token = await getProviderAccessToken(workspaceId, "gmail");
  const from = integration.config?.email || integration.accountName || undefined;
  await providerJson(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ raw: toGmailRaw(buildMime({ to, from, subject, text, html })) }),
    },
    label,
  );
  return true;
}
