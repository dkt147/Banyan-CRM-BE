import { Router } from "express";
import { receive } from "../controllers/webhook.controller.js";
import { receiveStripeWebhook } from "../controllers/providerWebhook.controller.js";
import {
  receiveWhatsAppWebhookAndSync,
  verifyWhatsAppWebhookAndRespond,
} from "../controllers/whatsappIntegration.controller.js";
import { receiveWpBookingWebhook } from "../controllers/wpRoomBookingWebhook.controller.js";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { asyncHandler } from "../utils/asyncHandler.js";
import { acceptEventbriteWebhook, webhookSecretMatches } from "../services/eventbriteSync.service.js";

// Eventbrite webhooks aren't signed: the secret in the URL is checked (timing-safe; 404 when wrong).
const eventbriteWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (req) => `eb:${ipKeyGenerator(req.ip)}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, code: "RATE_LIMITED", message: "Too many requests." }),
});

const r = Router();

// Provider-specific routes must come before the generic webhook ingestion route.
r.post("/stripe", receiveStripeWebhook);
r.get("/whatsapp", verifyWhatsAppWebhookAndRespond);
r.post("/whatsapp", receiveWhatsAppWebhookAndSync);
// WordPress room bookings (booking.paid / booking.cancelled), HMAC-signed with BANYAN_CRM_TOKEN.
r.post("/banyan-bookings", receiveWpBookingWebhook);
// Eventbrite (27 Nov b, A): answers 200 straight away; the work runs after the response.
r.post(
  "/eventbrite/:secret",
  eventbriteWebhookLimiter,
  asyncHandler(async (req, res) => {
    if (!webhookSecretMatches(req.params.secret)) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Not found." });
    const { accepted, reason } = await acceptEventbriteWebhook(req.body || {});
    res.status(200).json({ success: true, data: { received: true, ...(accepted ? {} : { ignored: reason }) } });
  }),
);

// Preserve existing generic provider webhook behavior for other providers.
r.post("/:provider", receive);

export default r;
