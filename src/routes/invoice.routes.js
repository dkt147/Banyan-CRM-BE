import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import * as c from "../controllers/invoice.controller.js";
import { createInvoicePaymentLink } from "../controllers/publicInvoicePayment.controller.js";
import { Invoice } from "../models/Invoice.js";
import { Payment } from "../models/Payment.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const r = Router();
r.use(requireAuth);

// Specialized actions must be declared before generic /:id CRUD routes.
r.post("/:id/payment-link", createInvoicePaymentLink);
r.patch("/:id/pay", c.markPaid);
r.post("/mark-overdue", c.overdue);

// Only the verified payment webhook may transition an unpaid invoice to paid.
r.post(
  "/",
  asyncHandler(async (req, _res, next) => {
    if (req.body?.status === "paid") {
      throw new AppError(
        "Create the invoice as unpaid; payment status is confirmed by the payment workflow.",
        409,
        "INVOICE_PAYMENT_WEBHOOK_MANAGED",
      );
    }
    next();
  }),
);
r.patch(
  "/:id",
  asyncHandler(async (req, _res, next) => {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      workspaceId: req.workspaceId,
    }).select("status");
    if (!invoice) return next();

    const stripePaymentPending = await Payment.exists({
      workspaceId: req.workspaceId,
      invoiceId: invoice._id,
      provider: "stripe",
      status: "pending",
    });
    if (stripePaymentPending) {
      throw new AppError(
        "This invoice cannot be edited while a Stripe payment is pending. Complete or let the Checkout Session expire first.",
        409,
        "INVOICE_STRIPE_PAYMENT_PENDING",
      );
    }

    if (req.body?.status === undefined) return next();
    if (req.body.status === "paid" && invoice.status !== "paid") {
      throw new AppError(
        "Invoice payment status is managed by the verified payment workflow.",
        409,
        "INVOICE_PAYMENT_WEBHOOK_MANAGED",
      );
    }
    if (invoice.status === "paid" && req.body.status !== "paid") {
      throw new AppError(
        "A paid invoice cannot be reopened by editing its status.",
        409,
        "PAID_INVOICE_STATUS_LOCKED",
      );
    }
    next();
  }),
);

r.delete(
  "/:id",
  asyncHandler(async (req, _res, next) => {
    const stripePaymentPending = await Payment.exists({
      workspaceId: req.workspaceId,
      invoiceId: req.params.id,
      provider: "stripe",
      status: "pending",
    });
    if (stripePaymentPending) {
      throw new AppError(
        "This invoice cannot be deleted while a Stripe payment is pending. Complete or let the Checkout Session expire first.",
        409,
        "INVOICE_STRIPE_PAYMENT_PENDING",
      );
    }
    next();
  }),
);

r.use(resourceRouter(resourceRegistry.invoices.service));

export default r;
