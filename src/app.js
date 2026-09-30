import express from "express";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { securityMiddleware } from "./middleware/security.middleware.js";
import {
  errorHandler,
  notFoundHandler,
} from "./middleware/error.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import healthRoutes from "./routes/health.routes.js";
import workspaceRoutes from "./routes/workspace.routes.js";
import memberRoutes from "./routes/member.routes.js";
import companyRoutes from "./routes/companies.routes.js";
import contactRoutes from "./routes/contacts.routes.js";
import pipelineRoutes from "./routes/pipeline.routes.js";
import dealRoutes from "./routes/deal.routes.js";
import activityRoutes from "./routes/activities.routes.js";
import taskRoutes from "./routes/tasks.routes.js";
import inboxRoutes from "./routes/inbox.routes.js";
import templateRoutes from "./routes/template.routes.js";
import calendarRoutes from "./routes/calendar.routes.js";
import calendarEventRoutes from "./routes/calendarEvents.routes.js";
import bookingRoutes from "./routes/bookings.routes.js";
import agreementRoutes from "./routes/agreements.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import paymentRoutes from "./routes/payments.routes.js";
import membershipPlanRoutes from "./routes/membershipPlans.routes.js";
import membershipRoutes from "./routes/memberships.routes.js";
import checkInRoutes from "./routes/checkIns.routes.js";
import loyaltyRoutes from "./routes/loyalty.routes.js";
import loyaltyTierRoutes from "./routes/loyaltyTiers.routes.js";
import loyaltyAccountRoutes from "./routes/loyaltyAccounts.routes.js";
import loyaltyLedgerRoutes from "./routes/loyaltyLedger.routes.js";
import loyaltyRedemptionRoutes from "./routes/loyaltyRedemptions.routes.js";
import automationRoutes from "./routes/automation.routes.js";
import integrationRoutes from "./routes/integrations.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import documentRoutes from "./routes/documents.routes.js";
import auditLogRoutes from "./routes/auditLogs.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";

const app = express();
app.disable("x-powered-by");
app.use(...securityMiddleware);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());
app.use(morgan("dev"));
app.get("/", (_req, res) =>
  res.json({
    success: true,
    service: "Banyan CRM API",
    version: "v1",
    message: "API is running.",
  }),
);
app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/workspace", workspaceRoutes);
app.use("/api/v1/members", memberRoutes);
app.use("/api/v1/companies", companyRoutes);
app.use("/api/v1/contacts", contactRoutes);
app.use("/api/v1/pipelines", pipelineRoutes);
app.use("/api/v1/deals", dealRoutes);
app.use("/api/v1/activities", activityRoutes);
app.use("/api/v1/tasks", taskRoutes);
app.use("/api/v1/inbox", inboxRoutes);
app.use("/api/v1/templates", templateRoutes);
app.use("/api/v1/calendar", calendarRoutes);
app.use("/api/v1/calendar-events", calendarEventRoutes);
app.use("/api/v1/bookings", bookingRoutes);
app.use("/api/v1/agreements", agreementRoutes);
app.use("/api/v1/invoices", invoiceRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/membership-plans", membershipPlanRoutes);
app.use("/api/v1/memberships", membershipRoutes);
app.use("/api/v1/check-ins", checkInRoutes);
app.use("/api/v1/loyalty", loyaltyRoutes);
app.use("/api/v1/loyalty-tiers", loyaltyTierRoutes);
app.use("/api/v1/loyalty-accounts", loyaltyAccountRoutes);
app.use("/api/v1/loyalty-ledger", loyaltyLedgerRoutes);
app.use("/api/v1/loyalty-redemptions", loyaltyRedemptionRoutes);
app.use("/api/v1/automations", automationRoutes);
app.use("/api/v1/integrations", integrationRoutes);
app.use("/api/v1/notifications", notificationRoutes);

app.use("/api/v1/documents", documentRoutes);
app.use("/api/v1/audit-logs", auditLogRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/webhooks", webhookRoutes);
app.use(notFoundHandler);
app.use(errorHandler);
export default app;
