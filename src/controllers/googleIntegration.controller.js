import { CalendarEvent } from "../models/CalendarEvent.js";
import { Contact } from "../models/Contact.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { Integration } from "../models/Integration.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";
import {
  getConnectedIntegration,
  getProviderAccessToken,
  providerJson,
} from "../services/providerApi.service.js";

function gmailHeader(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized || /[\r\n]/.test(normalized)) {
    throw new AppError(
      `${name} is required and must not contain line breaks.`,
      400,
      "INVALID_EMAIL_HEADER",
    );
  }
  return normalized;
}

function encodeSubject(value) {
  const subject = gmailHeader(value, "subject");
  return /[^\x20-\x7E]/.test(subject)
    ? `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`
    : subject;
}

async function googleRequest(workspaceId, provider, url, options = {}) {
  const token = await getProviderAccessToken(workspaceId, provider);
  return providerJson(
    url,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    },
    provider === "gmail" ? "Gmail" : "Google Calendar",
  );
}

export const sendGmailMessage = asyncHandler(async (req, res) => {
  const to = gmailHeader(req.body?.to, "to");
  const subject = encodeSubject(req.body?.subject);
  const bodyText = String(req.body?.text || req.body?.body || "");
  if (!bodyText.trim())
    throw new AppError("text is required.", 400, "EMAIL_BODY_REQUIRED");
  const cc = req.body?.cc ? gmailHeader(req.body.cc, "cc") : "";
  const bcc = req.body?.bcc ? gmailHeader(req.body.bcc, "bcc") : "";
  const integration = await getConnectedIntegration(req.workspaceId, "gmail");
  const from = integration.config?.email || integration.accountName;
  let conversation = null;
  if (req.body?.conversationId) {
    conversation = await Conversation.findOne({
      _id: req.body.conversationId,
      workspaceId: req.workspaceId,
    });
    if (!conversation)
      throw new AppError("Conversation not found.", 404, "NOT_FOUND");
  }

  const mime = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    ...(from ? [`From: ${gmailHeader(from, "from")}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(bodyText, "utf8").toString("base64"),
  ].join("\r\n");

  const result = await googleRequest(
    req.workspaceId,
    "gmail",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      body: JSON.stringify({
        raw: Buffer.from(mime, "utf8").toString("base64url"),
      }),
    },
  );

  let savedMessage = null;
  if (conversation) {
    savedMessage = await Message.create({
      workspaceId: req.workspaceId,
      conversationId: conversation._id,
      direction: "outbound",
      senderName: req.user.name,
      senderAddress: from || req.user.email,
      body: bodyText,
      status: "sent",
      metadata: {
        provider: "gmail",
        gmailMessageId: result.id,
        gmailThreadId: result.threadId,
        to,
        subject: req.body.subject,
      },
    });
    conversation.lastMessageAt = new Date();
    await conversation.save();
  }

  res
    .status(201)
    .json({
      success: true,
      data: {
        id: result.id,
        threadId: result.threadId,
        labelIds: result.labelIds || [],
        message: savedMessage,
      },
    });
});

function decodeGmailBody(data) {
  if (!data) return "";
  try {
    return Buffer.from(
      String(data).replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
  } catch {
    return "";
  }
}

function collectGmailBodies(payload, bodies = { plain: "", html: "" }) {
  if (!payload) return bodies;
  const decoded = decodeGmailBody(payload.body?.data);
  if (payload.mimeType === "text/plain" && decoded && !bodies.plain)
    bodies.plain = decoded;
  if (payload.mimeType === "text/html" && decoded && !bodies.html)
    bodies.html = decoded;
  for (const part of payload.parts || []) collectGmailBodies(part, bodies);
  return bodies;
}

function headerValue(message, name) {
  return (
    (message.payload?.headers || []).find(
      (header) => header.name?.toLowerCase() === name.toLowerCase(),
    )?.value || ""
  );
}

function parseEmailAddress(value) {
  const raw = String(value || "").trim();
  const bracket = raw.match(/<([^<>]+)>/);
  const email = (bracket?.[1] || raw).trim().replace(/^mailto:/i, "");
  return email.includes("@") ? email.toLowerCase() : "";
}

function parseDisplayName(value, fallback) {
  const raw = String(value || "").trim();
  const withoutAddress = raw
    .replace(/<[^<>]+>/g, "")
    .replace(/^"|"$/g, "")
    .trim();
  return (
    withoutAddress || fallback || parseEmailAddress(raw) || "Email contact"
  );
}

function plainTextFromHtml(html) {
  return String(html || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export const syncGmailInbox = asyncHandler(async (req, res) => {
  const integration = await getConnectedIntegration(req.workspaceId, "gmail");
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  const maxResults = Math.min(
    Math.max(Number(req.body?.maxResults) || 25, 1),
    100,
  );
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set(
    "q",
    String(req.body?.q || "newer_than:30d").slice(0, 500),
  );
  if (req.body?.pageToken)
    url.searchParams.set("pageToken", String(req.body.pageToken));
  const listing = await googleRequest(req.workspaceId, "gmail", url.toString());
  const references = listing.messages || [];
  let synced = 0;
  let skipped = 0;
  const connectedEmail = String(integration.config?.email || "").toLowerCase();

  for (let offset = 0; offset < references.length; offset += 5) {
    const batch = references.slice(offset, offset + 5);
    const messages = await Promise.all(
      batch.map((reference) =>
        googleRequest(
          req.workspaceId,
          "gmail",
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(reference.id)}?format=full`,
        ),
      ),
    );

    for (const message of messages) {
      if (
        !message.id ||
        (await Message.exists({
          "metadata.gmailMessageId": message.id,
          workspaceId: req.workspaceId,
        }))
      ) {
        skipped += 1;
        continue;
      }
      const fromHeader = headerValue(message, "From");
      const toHeader = headerValue(message, "To");
      const fromEmail = parseEmailAddress(fromHeader);
      const toEmail = parseEmailAddress(toHeader);
      const direction =
        connectedEmail && fromEmail === connectedEmail ? "outbound" : "inbound";
      const participantEmail =
        direction === "inbound" ? fromEmail : toEmail || fromEmail;
      const participantName =
        direction === "inbound"
          ? parseDisplayName(fromHeader, fromEmail)
          : parseDisplayName(toHeader, toEmail);
      const subject = headerValue(message, "Subject") || "(no subject)";
      const bodyParts = collectGmailBodies(message.payload);
      const body =
        bodyParts.plain ||
        plainTextFromHtml(bodyParts.html) ||
        "[Email message has no readable text body]";
      const sentAt = message.internalDate
        ? new Date(Number(message.internalDate))
        : new Date();
      const contact = participantEmail
        ? await Contact.findOne({
            workspaceId: req.workspaceId,
            email: participantEmail,
          })
        : null;
      const conversation = await Conversation.findOneAndUpdate(
        {
          workspaceId: req.workspaceId,
          channel: "email",
          externalThreadId: message.threadId || message.id,
        },
        {
          $setOnInsert: {
            workspaceId: req.workspaceId,
            channel: "email",
            externalThreadId: message.threadId || message.id,
            contactId: contact?._id,
            participantName,
            participantAddress: participantEmail || fromEmail,
            subject,
            status: "open",
          },
          $set: { lastMessageAt: sentAt, subject },
          ...(direction === "inbound" &&
          (message.labelIds || []).includes("UNREAD")
            ? { $inc: { unreadCount: 1 } }
            : {}),
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      await Message.create({
        workspaceId: req.workspaceId,
        conversationId: conversation._id,
        direction,
        senderName: parseDisplayName(fromHeader, fromEmail),
        senderAddress: fromEmail,
        body: String(body).slice(0, 10000),
        sentAt,
        status: direction === "inbound" ? "received" : "sent",
        metadata: {
          provider: "gmail",
          gmailMessageId: message.id,
          gmailThreadId: message.threadId || "",
          labelIds: message.labelIds || [],
          subject,
          to: toHeader,
        },
      });
      synced += 1;
    }
  }
  await Integration.updateOne(
    { workspaceId: req.workspaceId, provider: "gmail" },
    { $set: { lastSyncedAt: new Date() } },
  );
  res.json({
    success: true,
    data: {
      fetched: references.length,
      synced,
      skipped,
      nextPageToken: listing.nextPageToken || null,
    },
  });
});

export const listGmailMessages = asyncHandler(async (req, res) => {
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  const maxResults = Math.min(
    Math.max(Number(req.query.maxResults) || 25, 1),
    100,
  );
  url.searchParams.set("maxResults", String(maxResults));
  if (req.query.q) url.searchParams.set("q", String(req.query.q).slice(0, 500));
  if (req.query.pageToken)
    url.searchParams.set("pageToken", String(req.query.pageToken));
  if (req.query.labelIds)
    url.searchParams.set("labelIds", String(req.query.labelIds));
  const result = await googleRequest(req.workspaceId, "gmail", url.toString());
  res.json({ success: true, data: result });
});

export const getGmailMessage = asyncHandler(async (req, res) => {
  const messageId = String(req.params.messageId || "");
  if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) {
    throw new AppError("Invalid Gmail message ID.", 400, "INVALID_MESSAGE_ID");
  }
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;
  const result = await googleRequest(req.workspaceId, "gmail", url);
  res.json({ success: true, data: result });
});

function googleEventBody(event) {
  return {
    summary: event.title,
    description: event.notes || "",
    ...(event.location ? { location: event.location } : {}),
    start: {
      dateTime: new Date(event.startAt).toISOString(),
      timeZone: event.timezone || env.GOOGLE_CALENDAR_TIMEZONE || "UTC",
    },
    end: {
      dateTime: new Date(event.endAt).toISOString(),
      timeZone: event.timezone || env.GOOGLE_CALENDAR_TIMEZONE || "UTC",
    },
  };
}

function calendarEventsUrl(calendarId, params = {}) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "")
      url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export const listGoogleCalendarEvents = asyncHandler(async (req, res) => {
  const from = req.query.timeMin
    ? new Date(req.query.timeMin)
    : new Date(Date.now() - 30 * 86400000);
  const to = req.query.timeMax
    ? new Date(req.query.timeMax)
    : new Date(Date.now() + 180 * 86400000);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from >= to
  ) {
    throw new AppError(
      "Valid timeMin and timeMax values are required; timeMin must be before timeMax.",
      400,
      "INVALID_TIME_RANGE",
    );
  }
  const calendarId = env.GOOGLE_CALENDAR_ID || "primary";
  const url = calendarEventsUrl(calendarId, {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: Math.min(
      Math.max(Number(req.query.maxResults) || 100, 1),
      2500,
    ),
    pageToken: req.query.pageToken,
  });
  const result = await googleRequest(req.workspaceId, "google_calendar", url);
  await Integration.updateOne(
    { workspaceId: req.workspaceId, provider: "google_calendar" },
    { $set: { lastSyncedAt: new Date() } },
  );
  res.json({ success: true, data: result });
});

export const syncGoogleCalendarEvent = asyncHandler(async (req, res) => {
  const event = await CalendarEvent.findOne({
    _id: req.params.eventId,
    workspaceId: req.workspaceId,
  });
  if (!event) throw new AppError("Calendar event not found.", 404, "NOT_FOUND");
  const calendarId = env.GOOGLE_CALENDAR_ID || "primary";
  const externalId =
    event.externalProvider === "google_calendar" ? event.externalEventId : null;

  if (event.status === "cancelled") {
    if (externalId) {
      await googleRequest(
        req.workspaceId,
        "google_calendar",
        calendarEventsUrl(calendarId) + `/${encodeURIComponent(externalId)}`,
        { method: "DELETE" },
      );
    }
    event.externalProvider = "google_calendar";
    event.externalEventId = externalId || undefined;
    await event.save();
    return res.json({
      success: true,
      data: {
        eventId: event._id,
        externalEventId: externalId,
        status: "cancelled",
      },
    });
  }

  const url = externalId
    ? calendarEventsUrl(calendarId) + `/${encodeURIComponent(externalId)}`
    : calendarEventsUrl(calendarId);
  const result = await googleRequest(req.workspaceId, "google_calendar", url, {
    method: externalId ? "PUT" : "POST",
    body: JSON.stringify(googleEventBody(event)),
  });
  event.externalProvider = "google_calendar";
  event.externalEventId = result.id;
  event.metadata = {
    ...(event.metadata?.toObject
      ? event.metadata.toObject()
      : event.metadata || {}),
    googleCalendarId: calendarId,
    googleEventHtmlLink: result.htmlLink || "",
    googleSyncedAt: new Date(),
  };
  await event.save();
  await Integration.updateOne(
    { workspaceId: req.workspaceId, provider: "google_calendar" },
    { $set: { lastSyncedAt: new Date() } },
  );
  res.json({
    success: true,
    data: {
      eventId: event._id,
      externalEventId: result.id,
      htmlLink: result.htmlLink || null,
      status: result.status,
    },
  });
});
