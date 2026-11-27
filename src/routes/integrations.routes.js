import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { flodeskStatus } from "../services/flodesk.service.js";
import { syncXeroInvoices } from "../services/xeroInvoiceSync.service.js";
import { whatsappStatus } from "../services/whatsapp.service.js";
import { gmailDiagnostics } from "../services/gmailDiagnostics.service.js";
import { ensureEventbriteWebhook, eventbriteStatus, syncEventbrite } from "../services/eventbriteSync.service.js";
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
// Pull invoices made in Xero into the CRM (26 Nov, E). Read-only towards Xero.
r.post(
  "/xero/sync-invoices",
  requireAuth,
  requirePermission("workspace.manage"),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await syncXeroInvoices(req.workspaceId) });
  }),
);
r.post("/xero/invoices/:invoiceId/sync", requireAuth, syncXeroInvoice);
r.get("/xero/invoices/:invoiceId", requireAuth, getXeroInvoice);
r.post("/google/gmail/send", requireAuth, sendGmailMessage);
r.post("/google/gmail/sync", requireAuth, syncGmailInbox);
r.get("/google/gmail/messages", requireAuth, listGmailMessages);
// Read-only delivery check (focused test 27 Nov, F1): ?ids=<gmail id>,<gmail id>&days=7
r.get(
  "/google/gmail/diagnostics",
  requireAuth,
  requirePermission("workspace.manage"),
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || "").split(",").filter(Boolean);
    res.json({ success: true, data: await gmailDiagnostics(req.workspaceId, { ids, days: req.query.days }) });
  }),
);
r.get("/google/gmail/messages/:messageId", requireAuth, getGmailMessage);
r.get("/google/calendar/events", requireAuth, listGoogleCalendarEvents);
r.post("/google/calendar/sync", requireAuth, syncGoogleCalendarEvents);
r.post(
  "/google/calendar/events/:eventId/sync",
  requireAuth,
  syncGoogleCalendarEvent,
);
r.post("/whatsapp/messages", requireAuth, requirePermission("records.write"), sendWhatsAppMessage);
// Eventbrite (27 Nov b, A). Admin only. Nothing is written to Eventbrite except creating the webhook.
r.get(
  "/eventbrite",
  requireAuth,
  requirePermission("workspace.manage"),
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await eventbriteStatus() });
  }),
);
r.post(
  "/eventbrite/sync",
  requireAuth,
  requirePermission("workspace.manage"),
  asyncHandler(async (_req, res) => {
    await syncEventbrite({ ifRunning: "throw" });
    res.json({ success: true, data: await eventbriteStatus() });
  }),
);
r.post(
  "/eventbrite/webhook",
  requireAuth,
  requirePermission("workspace.manage"),
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await ensureEventbriteWebhook() });
  }),
);
// WhatsApp set-up check for the team (27 Nov b, B1). Never 503: not set up -> configured false.
r.get(
  "/whatsapp/status",
  requireAuth,
  requirePermission("workspace.manage"),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await whatsappStatus(req.workspaceId, { fresh: String(req.query.fresh) === "true" }) });
  }),
);
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

// Flodesk newsletter sign-ups: connection, segments found, interest -> segment mapping (admin).
r.get(
  "/flodesk",
  requireAuth,
  requirePermission("workspace.manage"),
  asyncHandler(async (req, res) => res.json({ success: true, data: await flodeskStatus(req.workspaceId) })),
);

// Preserve the existing integration record CRUD endpoints.
r.use(resourceRouter(resourceRegistry["integrations"].service));

export default r;
