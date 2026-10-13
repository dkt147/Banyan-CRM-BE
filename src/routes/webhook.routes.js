import { Router } from "express";
import { receive } from "../controllers/webhook.controller.js";
import { receiveStripeWebhook } from "../controllers/providerWebhook.controller.js";
import {
  receiveWhatsAppWebhookAndSync,
  verifyWhatsAppWebhookAndRespond,
} from "../controllers/whatsappIntegration.controller.js";

const r = Router();

// Provider-specific routes must come before the generic webhook ingestion route.
r.post("/stripe", receiveStripeWebhook);
r.get("/whatsapp", verifyWhatsAppWebhookAndRespond);
r.post("/whatsapp", receiveWhatsAppWebhookAndSync);

// Preserve existing generic provider webhook behavior for other providers.
r.post("/:provider", receive);

export default r;
