import crypto from "node:crypto";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  providerJson,
  requireEnvironment,
} from "../services/providerApi.service.js";
import { Contact } from "../models/Contact.js";
import { Conversation } from "../models/Conversation.js";
import { Integration } from "../models/Integration.js";
import { Message } from "../models/Message.js";
import { WebhookEvent } from "../models/WebhookEvent.js";

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyMetaSignature(rawBody, signature, secret) {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(String(signature || ""));
  if (!match || !Buffer.isBuffer(rawBody) || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(match[1], "hex");
  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

export const sendWhatsAppMessage = asyncHandler(async (req, res) => {
  requireEnvironment("WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID");
  const to = digits(req.body?.to);
  const text = String(req.body?.text || "").trim();
  if (to.length < 8 || to.length > 15) {
    throw new AppError(
      "to must be a phone number in international format.",
      400,
      "INVALID_WHATSAPP_RECIPIENT",
    );
  }
  if (!text)
    throw new AppError("text is required.", 400, "WHATSAPP_TEXT_REQUIRED");
  if (text.length > 4096)
    throw new AppError(
      "WhatsApp text messages must not exceed 4096 characters.",
      400,
      "WHATSAPP_TEXT_TOO_LONG",
    );
  let conversation = null;
  if (req.body?.conversationId) {
    conversation = await Conversation.findOne({
      _id: req.body.conversationId,
      workspaceId: req.workspaceId,
    });
    if (!conversation)
      throw new AppError("Conversation not found.", 404, "NOT_FOUND");
  }

  const version = String(env.META_GRAPH_API_VERSION || "v26.0").replace(
    /^v?/,
    "v",
  );
  const result = await providerJson(
    `https://graph.facebook.com/${version}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    },
    "WhatsApp Business",
  );
  const providerMessageId = result?.messages?.[0]?.id;
  if (!providerMessageId)
    throw new AppError(
      "WhatsApp did not return a message ID.",
      502,
      "WHATSAPP_MESSAGE_ID_MISSING",
    );

  let savedMessage = null;
  if (conversation) {
    savedMessage = await Message.create({
      workspaceId: req.workspaceId,
      conversationId: conversation._id,
      direction: "outbound",
      senderName: req.user.name,
      senderAddress: req.user.phone || req.user.email,
      body: text,
      status: "sent",
      metadata: {
        provider: "whatsapp",
        whatsappMessageId: providerMessageId,
        recipient: to,
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
        messageId: providerMessageId,
        recipient: to,
        status: "sent",
        message: savedMessage,
      },
    });
});

export const receiveWhatsAppWebhookAndSync = asyncHandler(async (req, res) => {
  if (!env.META_APP_SECRET) {
    return res
      .status(503)
      .json({
        success: false,
        code: "WHATSAPP_WEBHOOK_NOT_CONFIGURED",
        message: "META_APP_SECRET is not configured.",
      });
  }
  if (
    !verifyMetaSignature(
      req.rawBody,
      req.get("x-hub-signature-256"),
      env.META_APP_SECRET,
    )
  ) {
    return res
      .status(400)
      .json({
        success: false,
        code: "INVALID_WHATSAPP_SIGNATURE",
        message: "WhatsApp webhook signature verification failed.",
      });
  }

  const externalEventId = crypto
    .createHash("sha256")
    .update(req.rawBody)
    .digest("hex");
  let eventRecord;
  try {
    eventRecord = await WebhookEvent.create({
      provider: "whatsapp",
      eventType: req.body?.object || "whatsapp.event",
      externalEventId,
      payload: req.body,
      status: "received",
    });
  } catch (error) {
    if (error?.code === 11000)
      return res
        .status(200)
        .json({ success: true, data: { received: true, duplicate: true } });
    throw error;
  }

  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        const value = change?.value || {};
        const phoneNumberId = value?.metadata?.phone_number_id;
        const configuredIntegration = phoneNumberId
          ? await Integration.findOne({
              provider: "whatsapp",
              externalAccountId: String(phoneNumberId),
              status: "connected",
            })
          : null;
        const fallbackWorkspace =
          env.WHATSAPP_WORKSPACE_ID &&
          mongoose.Types.ObjectId.isValid(env.WHATSAPP_WORKSPACE_ID)
            ? env.WHATSAPP_WORKSPACE_ID
            : null;

        for (const status of value.statuses || []) {
          const providerMessageId = status?.id;
          if (!providerMessageId) continue;
          const mappedStatus =
            status.status === "read"
              ? "read"
              : status.status === "delivered"
                ? "delivered"
                : status.status === "failed"
                  ? "failed"
                  : status.status === "sent"
                    ? "sent"
                    : null;
          if (!mappedStatus) continue;
          const filter = { "metadata.whatsappMessageId": providerMessageId };
          if (configuredIntegration?.workspaceId)
            filter.workspaceId = configuredIntegration.workspaceId;
          await Message.updateOne(filter, {
            $set: {
              status: mappedStatus,
              ...(status.timestamp
                ? {
                    "metadata.whatsappStatusUpdatedAt": new Date(
                      Number(status.timestamp) * 1000,
                    ),
                  }
                : {}),
              ...(status.errors?.length
                ? {
                    "metadata.whatsappLastError": String(
                      status.errors[0].title ||
                        status.errors[0].code ||
                        "delivery_failed",
                    ),
                  }
                : {}),
            },
          });
        }

        for (const incoming of value.messages || []) {
          const from = digits(incoming?.from);
          const providerMessageId = incoming?.id;
          if (!from || !providerMessageId) continue;
          const existingMessage = await Message.findOne({
            "metadata.whatsappMessageId": providerMessageId,
          });
          if (existingMessage) continue;

          const contactQueries = [
            { whatsapp: { $in: [from, `+${from}`] } },
            { phone: { $in: [from, `+${from}`] } },
          ];
          if (configuredIntegration?.workspaceId) {
            contactQueries.forEach((query) => {
              query.workspaceId = configuredIntegration.workspaceId;
            });
          }
          let possibleContacts = await Contact.find({
            $or: contactQueries,
          }).limit(3);
          if (!possibleContacts.length) {
            // Match common formatting variants such as +1 (555) 123-4567 without storing provider numbers as plain duplicates.
            const suffix = from.slice(-8);
            const flexiblePattern = suffix.split("").join("\\D*") + "$";
            const formattedQueries = [
              { whatsapp: { $regex: flexiblePattern } },
              { phone: { $regex: flexiblePattern } },
            ];
            if (configuredIntegration?.workspaceId) {
              formattedQueries.forEach((query) => {
                query.workspaceId = configuredIntegration.workspaceId;
              });
            }
            possibleContacts = await Contact.find({
              $or: formattedQueries,
            }).limit(3);
          }
          const contact =
            possibleContacts.length === 1 ? possibleContacts[0] : null;
          const workspaceId =
            configuredIntegration?.workspaceId ||
            contact?.workspaceId ||
            fallbackWorkspace;
          if (!workspaceId) {
            eventRecord.error =
              "WhatsApp event received but no Banyan workspace could be resolved; configure a connected WhatsApp integration with the provider phone number ID or WHATSAPP_WORKSPACE_ID.";
            continue;
          }

          const actualContact =
            contact && String(contact.workspaceId) === String(workspaceId)
              ? contact
              : null;
          const profileName =
            value.contacts?.find((item) => digits(item?.wa_id) === from)
              ?.profile?.name || from;
          const conversation = await Conversation.findOneAndUpdate(
            { workspaceId, channel: "whatsapp", externalThreadId: from },
            {
              $setOnInsert: {
                workspaceId,
                channel: "whatsapp",
                externalThreadId: from,
                contactId: actualContact?._id,
                participantName: profileName,
                participantAddress: from,
                status: "open",
              },
              $set: { lastMessageAt: new Date() },
              $inc: { unreadCount: 1 },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true },
          );

          let body =
            incoming?.text?.body ||
            incoming?.button?.text ||
            incoming?.interactive?.button_reply?.title ||
            incoming?.interactive?.list_reply?.title;
          if (!body) body = `[${String(incoming?.type || "WhatsApp message")}]`;
          await Message.create({
            workspaceId,
            conversationId: conversation._id,
            direction: "inbound",
            senderName: profileName,
            senderAddress: from,
            body: String(body).slice(0, 10000),
            status: "received",
            metadata: {
              provider: "whatsapp",
              whatsappMessageId: providerMessageId,
              whatsappMessageType: incoming?.type || "unknown",
              timestamp: incoming?.timestamp || null,
            },
            sentAt: incoming?.timestamp
              ? new Date(Number(incoming.timestamp) * 1000)
              : new Date(),
          });
        }
      }
    }

    eventRecord.status = "processed";
    eventRecord.processedAt = new Date();
    await eventRecord.save();
    res
      .status(200)
      .json({
        success: true,
        data: { received: true, eventId: eventRecord._id },
      });
  } catch (error) {
    eventRecord.status = "failed";
    eventRecord.error = "WhatsApp event synchronization failed.";
    await eventRecord.save().catch(() => {});
    throw error;
  }
});

export const verifyWhatsAppWebhookAndRespond = (req, res) => {
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return res
      .status(503)
      .json({
        success: false,
        code: "WHATSAPP_WEBHOOK_NOT_CONFIGURED",
        message: "WHATSAPP_VERIFY_TOKEN is not configured.",
      });
  }
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (
    mode === "subscribe" &&
    token &&
    safeEqual(token, verifyToken) &&
    challenge
  ) {
    return res.status(200).type("text/plain").send(String(challenge));
  }
  return res
    .status(403)
    .json({
      success: false,
      code: "WHATSAPP_WEBHOOK_VERIFICATION_FAILED",
      message: "Webhook verification failed.",
    });
};
