import { Invoice } from "../models/Invoice.js";
import { Payment } from "../models/Payment.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";
import {
  providerJson,
  requireEnvironment,
} from "../services/providerApi.service.js";

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);
const THREE_DECIMAL_CURRENCIES = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

function toStripeMinorUnits(amount, currency) {
  const normalized = String(currency || "HKD").toLowerCase();
  const multiplier = ZERO_DECIMAL_CURRENCIES.has(normalized)
    ? 1
    : THREE_DECIMAL_CURRENCIES.has(normalized)
      ? 1000
      : 100;
  return Math.round(Number(amount) * multiplier);
}

export const createStripePaymentIntent = asyncHandler(async (req, res) => {
  requireEnvironment("STRIPE_SECRET_KEY");
  const { invoiceId } = req.body || {};
  if (!invoiceId) {
    throw new AppError("invoiceId is required.", 400, "INVOICE_ID_REQUIRED");
  }

  const invoice = await Invoice.findOne({
    _id: invoiceId,
    workspaceId: req.workspaceId,
  });
  if (!invoice) throw new AppError("Invoice not found.", 404, "NOT_FOUND");
  if (invoice.status === "paid") {
    throw new AppError(
      "This invoice has already been paid.",
      409,
      "INVOICE_ALREADY_PAID",
    );
  }
  if (invoice.status === "cancelled") {
    throw new AppError(
      "Cancelled invoices cannot be paid.",
      409,
      "INVOICE_CANCELLED",
    );
  }

  const amount = toStripeMinorUnits(invoice.total, invoice.currency);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError(
      "Invoice total must be greater than zero to start a payment.",
      400,
      "INVALID_PAYMENT_AMOUNT",
    );
  }

  const payment = await Payment.create({
    workspaceId: req.workspaceId,
    invoiceId: invoice._id,
    provider: "stripe",
    amount: Number(invoice.total),
    currency: invoice.currency || "HKD",
    status: "pending",
    metadata: { source: "banyan_payment_intent" },
  });

  try {
    const params = new URLSearchParams({
      amount: String(amount),
      currency: String(invoice.currency || "HKD").toLowerCase(),
      "automatic_payment_methods[enabled]": "true",
      description:
        invoice.description ||
        `Banyan invoice ${invoice.invoiceNumber || invoice._id}`,
      "metadata[banyanPaymentId]": String(payment._id),
      "metadata[banyanInvoiceId]": String(invoice._id),
      "metadata[banyanWorkspaceId]": String(req.workspaceId),
    });

    const intent = await providerJson(
      "https://api.stripe.com/v1/payment_intents",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "Idempotency-Key": `banyan-payment-${payment._id}`,
        },
        body: params,
      },
      "Stripe",
    );

    if (!intent.id || !intent.client_secret) {
      throw new AppError(
        "Stripe did not return a usable PaymentIntent.",
        502,
        "STRIPE_PAYMENT_INTENT_INVALID",
      );
    }

    payment.externalId = intent.id;
    payment.metadata = {
      ...(payment.metadata?.toObject
        ? payment.metadata.toObject()
        : payment.metadata || {}),
      stripePaymentIntentId: intent.id,
      stripeStatus: intent.status,
    };
    await payment.save();

    return res.status(201).json({
      success: true,
      data: {
        paymentId: payment._id,
        invoiceId: invoice._id,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY || null,
        amount: invoice.total,
        currency: invoice.currency || "HKD",
        status: intent.status,
      },
    });
  } catch (error) {
    await Payment.deleteOne({ _id: payment._id }).catch(() => {});
    throw error;
  }
});
