import { Router } from "express";
import { receive } from "../controllers/webhook.controller.js";
import {
  receiveStripeWebhook,
  receiveWhatsAppWebhook,
  verifyWhatsAppWebhook,
} from "../controllers/providerWebhook.controller.js";

const r = Router();

// Provider-specific routes must come before the generic webhook ingestion route.
r.post("/stripe", receiveStripeWebhook);
r.get("/whatsapp", verifyWhatsAppWebhook);
r.post("/whatsapp", receiveWhatsAppWebhook);

// Preserve existing generic provider webhook behavior for other providers.
r.post("/:provider", receive);

export default r;
