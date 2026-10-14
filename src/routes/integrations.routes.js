import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import {
  callbackUrls,
  docusignCallback,
  googleCallback,
  startGoogleConnect,
  startXeroConnect,
  xeroCallback,
} from "../controllers/integrationOAuth.controller.js";
import {
  sendGmailMessage,
  syncGmailInbox,
  listGmailMessages,
  getGmailMessage,
  listGoogleCalendarEvents,
  syncGoogleCalendarEvent,
  syncGoogleCalendarEvents,
} from "../controllers/googleIntegration.controller.js";
import {
  syncXeroInvoice,
  getXeroInvoice,
  getXeroStatus,
} from "../controllers/xero.controller.js";
import { sendWhatsAppMessage } from "../controllers/whatsappIntegration.controller.js";
import {
  getDocuSignConsentUrl,
  sendDocuSignAgreement,
  getDocuSignAgreementStatus,
} from "../controllers/docusign.controller.js";

const r = Router();

// Public provider callbacks must be registered before the generic authenticated CRUD router.
r.get("/callback-urls", callbackUrls);
r.get("/xero/connect", requireAuth, startXeroConnect);
r.get("/xero/callback", xeroCallback);
r.get("/google/connect", requireAuth, startGoogleConnect);
r.get("/google/callback", googleCallback);
r.get("/docusign/callback", docusignCallback);

// Provider operational APIs are kept separate from the generic integration CRUD endpoints.
r.get("/xero/status", requireAuth, getXeroStatus);
r.post("/xero/invoices/:invoiceId/sync", requireAuth, syncXeroInvoice);
r.get("/xero/invoices/:invoiceId", requireAuth, getXeroInvoice);
r.post("/google/gmail/send", requireAuth, sendGmailMessage);
r.post("/google/gmail/sync", requireAuth, syncGmailInbox);
r.get("/google/gmail/messages", requireAuth, listGmailMessages);
r.get("/google/gmail/messages/:messageId", requireAuth, getGmailMessage);
r.get("/google/calendar/events", requireAuth, listGoogleCalendarEvents);
r.post("/google/calendar/sync", requireAuth, syncGoogleCalendarEvents);
r.post(
  "/google/calendar/events/:eventId/sync",
  requireAuth,
  syncGoogleCalendarEvent,
);
r.post("/whatsapp/messages", requireAuth, sendWhatsAppMessage);
r.get("/docusign/consent-url", requireAuth, getDocuSignConsentUrl);
r.post(
  "/docusign/agreements/:agreementId/send",
  requireAuth,
  sendDocuSignAgreement,
);
r.get(
  "/docusign/agreements/:agreementId/status",
  requireAuth,
  getDocuSignAgreementStatus,
);

// Preserve the existing integration record CRUD endpoints.
r.use(resourceRouter(resourceRegistry["integrations"].service));

export default r;
