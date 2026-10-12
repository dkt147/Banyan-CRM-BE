import crypto from "node:crypto";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Invoice } from "../models/Invoice.js";
import { Payment } from "../models/Payment.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { earnFromPayment } from "../services/loyalty.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyStripeSignature } from "../utils/providerSignatures.js";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (["client_secret", "clientsecret", "access_token", "accesstoken", "refresh_token", "refreshtoken", "authorization", "api_key", "apikey"].includes(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactSecrets(child);
    }
  }
  return result;
}

async function findLocalPayment(object) {
  const ids = [];
  if (typeof object?.id === "string" && object.id.startsWith("pi_")) ids.push(object.id);
  if (typeof object?.payment_intent === "string") ids.push(object.payment_intent);
  if (typeof object?.payment_intent?.id === "string") ids.push(object.payment_intent.id);

  const alternatives = ids.map((externalId) => ({ externalId }));
  const localPaymentId = object?.metadata?.banyanPaymentId || object?.metadata?.paymentId;
  if (localPaymentId && mongoose.Types.ObjectId.isValid(localPaymentId)) {
    alternatives.push({ _id: localPaymentId });
  }
  if (!alternatives.length) return null;
  return Payment.findOne({ provider: "stripe", $or: alternatives });
}

async function processStripeEvent(event, eventRecord) {
  const supported = new Set([
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "charge.refunded",
  ]);
  if (!supported.has(event.type)) {
    eventRecord.status = "ignored";
    eventRecord.error = "Event type is not handled by Banyan.";
    await eventRecord.save();
    return { handled: false, reason: "unsupported_event_type" };
  }

  const object = event.data?.object;
  const payment = await findLocalPayment(object);
  if (!payment) {
    eventRecord.status = "ignored";
    eventRecord.error = "No matching Banyan payment record was found for this Stripe event.";
    await eventRecord.save();
    return { handled: false, reason: "local_payment_not_found" };
  }

  if (event.type === "payment_intent.succeeded") {
    const wasPaid = payment.status === "succeeded";
    payment.status = "succeeded";
    payment.paidAt = payment.paidAt || (event.created ? new Date(event.created * 1000) : new Date());
    payment.metadata = {
      ...(payment.metadata?.toObject ? payment.metadata.toObject() : payment.metadata || {}),
      stripePaymentIntentId: object.id,
      stripeEventId: event.id,
    };
    await payment.save();

    const invoice = await Invoice.findOne({ _id: payment.invoiceId, workspaceId: payment.workspaceId });
    if (invoice && invoice.status !== "paid") {
      invoice.status = "paid";
      invoice.paidAt = payment.paidAt;
      await invoice.save();
      if (!wasPaid && invoice.contactId) {
        try {
          await earnFromPayment(payment.workspaceId, invoice.createdBy, invoice._id, payment.amount);
        } catch (error) {
          // Payment acknowledgement must not be retried just because loyalty data is unavailable.
          eventRecord.error = "Payment was applied, but the loyalty reward could not be recorded.";
          console.error("Banyan loyalty reward could not be recorded for a Stripe payment.", error?.message || "unknown error");
        }
      }
    }
  } else if (event.type === "payment_intent.payment_failed") {
    payment.status = "failed";
    payment.metadata = {
      ...(payment.metadata?.toObject ? payment.metadata.toObject() : payment.metadata || {}),
      stripePaymentIntentId: object.id,
      stripeEventId: event.id,
      lastPaymentError: object.last_payment_error?.code || object.last_payment_error?.type || "payment_failed",
    };
    await payment.save();
  } else if (event.type === "charge.refunded") {
    payment.status = "refunded";
    payment.metadata = {
      ...(payment.metadata?.toObject ? payment.metadata.toObject() : payment.metadata || {}),
      stripeChargeId: object.id,
      stripeEventId: event.id,
    };
    await payment.save();
  }

  eventRecord.status = "processed";
  eventRecord.processedAt = new Date();
  await eventRecord.save();
  return { handled: true };
}

export const receiveStripeWebhook = asyncHandler(async (req, res) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({
      success: false,
      code: "STRIPE_WEBHOOK_NOT_CONFIGURED",
      message: "STRIPE_WEBHOOK_SECRET is not configured on the server.",
    });
  }

  const signature = req.get("stripe-signature");
  if (!verifyStripeSignature(req.rawBody, signature, env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_STRIPE_SIGNATURE",
      message: "Stripe webhook signature verification failed.",
    });
  }

  const event = req.body;
  if (!event?.id || !event?.type || !event?.data?.object) {
    return res.status(400).json({
      success: false,
      code: "INVALID_STRIPE_EVENT",
      message: "The request is not a valid Stripe event.",
    });
  }

  let eventRecord = await WebhookEvent.findOne({ provider: "stripe", externalEventId: event.id });
  if (eventRecord && eventRecord.status !== "failed") {
    return res.json({ success: true, data: { received: true, duplicate: true } });
  }
  if (!eventRecord) {
    try {
      eventRecord = await WebhookEvent.create({
        provider: "stripe",
        eventType: event.type,
        externalEventId: event.id,
        payload: redactSecrets(event),
        status: "received",
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.json({ success: true, data: { received: true, duplicate: true } });
      }
      throw error;
    }
  } else {
    eventRecord.status = "received";
    eventRecord.error = undefined;
    await eventRecord.save();
  }

  try {
    const result = await processStripeEvent(event, eventRecord);
    return res.json({ success: true, data: { received: true, eventId: eventRecord._id, ...result } });
  } catch (error) {
    eventRecord.status = "failed";
    eventRecord.error = "Stripe event processing failed.";
    await eventRecord.save().catch(() => {});
    throw error;
  }
});

export const verifyWhatsAppWebhook = (req, res) => {
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return res.status(503).json({
      success: false,
      code: "WHATSAPP_WEBHOOK_NOT_CONFIGURED",
      message: "WHATSAPP_VERIFY_TOKEN is not configured on the server.",
    });
  }

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token && safeEqual(token, verifyToken) && challenge) {
    return res.status(200).type("text/plain").send(String(challenge));
  }
  return res.status(403).json({ success: false, code: "WHATSAPP_WEBHOOK_VERIFICATION_FAILED", message: "Webhook verification failed." });
};

export const receiveWhatsAppWebhook = asyncHandler(async (req, res) => {
  if (!env.META_APP_SECRET) {
    return res.status(503).json({
      success: false,
      code: "WHATSAPP_WEBHOOK_NOT_CONFIGURED",
      message: "META_APP_SECRET is not configured on the server.",
    });
  }
  const header = req.get("x-hub-signature-256") || "";
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header);
  if (!match || !Buffer.isBuffer(req.rawBody)) {
    return res.status(400).json({ success: false, code: "INVALID_WHATSAPP_SIGNATURE", message: "WhatsApp webhook signature verification failed." });
  }
  const expected = crypto.createHmac("sha256", env.META_APP_SECRET).update(req.rawBody).digest();
  const actual = Buffer.from(match[1], "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return res.status(400).json({ success: false, code: "INVALID_WHATSAPP_SIGNATURE", message: "WhatsApp webhook signature verification failed." });
  }

  const externalEventId = crypto.createHash("sha256").update(req.rawBody).digest("hex");
  try {
    const eventRecord = await WebhookEvent.create({
      provider: "whatsapp",
      eventType: req.body?.object || "whatsapp.event",
      externalEventId,
      payload: req.body,
      status: "received",
    });
    return res.status(200).json({ success: true, data: { received: true, eventId: eventRecord._id } });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(200).json({ success: true, data: { received: true, duplicate: true } });
    }
    throw error;
  }
});
