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



function stripeReturnUrl(invoiceId, outcome) {
  const url = new URL("/invoices", env.CLIENT_URL);
  url.searchParams.set("invoiceId", String(invoiceId));
  url.searchParams.set(
    outcome === "success" ? "stripe_success" : "stripe_cancelled",
    "1",
  );
  if (outcome === "success") {
    // Stripe replaces this literal placeholder with the completed Checkout Session ID.
    return `${url.toString()}&session_id={CHECKOUT_SESSION_ID}`;
  }
  return url.toString();
}

/**
 * Create a Stripe-hosted Checkout Session for an existing Banyan invoice.
 * The frontend redirects to the returned URL; the signed webhook remains the
 * source of truth for payment and invoice status.
 */
export const createStripeCheckoutSession = asyncHandler(async (req, res) => {
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
  if (["cancelled", "draft"].includes(invoice.status)) {
    throw new AppError(
      "Only issued, unpaid invoices can be paid through Stripe.",
      409,
      "INVOICE_NOT_PAYABLE",
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

  // Reuse an existing open Checkout Session for this invoice. This avoids
  // creating multiple payable sessions if the user clicks twice or retries.
  let pendingPayment = await Payment.findOne({
    workspaceId: req.workspaceId,
    invoiceId: invoice._id,
    provider: "stripe",
    status: "pending",
    "metadata.source": "banyan_stripe_checkout",
  }).sort({ createdAt: -1 });

  if (pendingPayment?.metadata?.checkoutSessionId) {
    const existingSession = await providerJson(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(pendingPayment.metadata.checkoutSessionId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          Accept: "application/json",
        },
      },
      "Stripe",
    );

    if (existingSession.status === "open" && existingSession.url) {
      return res.json({
        success: true,
        data: {
          paymentId: pendingPayment._id,
          invoiceId: invoice._id,
          checkoutSessionId: existingSession.id,
          checkoutUrl: existingSession.url,
          amount: invoice.total,
          currency: invoice.currency || "HKD",
          status: "pending",
          reused: true,
        },
      });
    }

    if (existingSession.status === "expired") {
      pendingPayment.status = "failed";
      pendingPayment.metadata = {
        ...(pendingPayment.metadata?.toObject
          ? pendingPayment.metadata.toObject()
          : pendingPayment.metadata || {}),
        checkoutExpiredAt: new Date().toISOString(),
      };
      await pendingPayment.save();
      pendingPayment = null;
    } else {
      throw new AppError(
        "A Stripe payment is already processing for this invoice. Refresh payment status before trying again.",
        409,
        "STRIPE_PAYMENT_ALREADY_PROCESSING",
      );
    }
  }

  // If a previous request timed out after Stripe accepted it, reuse the same
  // local payment/idempotency key. Stripe will return the original session.
  const payment = pendingPayment || await Payment.create({
    workspaceId: req.workspaceId,
    invoiceId: invoice._id,
    provider: "stripe",
    amount: Number(invoice.total),
    currency: invoice.currency || "HKD",
    status: "pending",
    metadata: { source: "banyan_stripe_checkout" },
  });

  try {
    const params = new URLSearchParams({
      mode: "payment",
      success_url: stripeReturnUrl(invoice._id, "success"),
      cancel_url: stripeReturnUrl(invoice._id, "cancel"),
      client_reference_id: String(payment._id),
      "line_items[0][price_data][currency]": String(
        invoice.currency || "HKD",
      ).toLowerCase(),
      "line_items[0][price_data][product_data][name]": `Invoice ${invoice.invoiceNumber || String(invoice._id).slice(-8)}`,
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][quantity]": "1",
      "metadata[banyanPaymentId]": String(payment._id),
      "metadata[banyanInvoiceId]": String(invoice._id),
      "metadata[banyanWorkspaceId]": String(req.workspaceId),
      "payment_intent_data[metadata][banyanPaymentId]": String(payment._id),
      "payment_intent_data[metadata][banyanInvoiceId]": String(invoice._id),
      "payment_intent_data[metadata][banyanWorkspaceId]": String(req.workspaceId),
    });

    const session = await providerJson(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "Idempotency-Key": `banyan-checkout-${payment._id}`,
        },
        body: params,
      },
      "Stripe",
    );

    if (!session.id || !session.url) {
      throw new AppError(
        "Stripe did not return a usable Checkout Session URL.",
        502,
        "STRIPE_CHECKOUT_SESSION_INVALID",
      );
    }
    payment.externalId = session.id;
    payment.metadata = {
      ...(payment.metadata?.toObject
        ? payment.metadata.toObject()
        : payment.metadata || {}),
      checkoutSessionId: session.id,
      stripeCheckoutStatus: session.status,
    };
    await payment.save();

    return res.status(201).json({
      success: true,
      data: {
        paymentId: payment._id,
        invoiceId: invoice._id,
        checkoutSessionId: session.id,
        checkoutUrl: session.url,
        amount: invoice.total,
        currency: invoice.currency || "HKD",
        status: "pending",
      },
    });
  } catch (error) {
    // Retain the pending payment and its stable idempotency key. A network
    // timeout can happen after Stripe creates the session but before we receive
    // its response; the next request can safely retry the same operation.
    payment.metadata = {
      ...(payment.metadata?.toObject
        ? payment.metadata.toObject()
        : payment.metadata || {}),
      lastCheckoutAttemptAt: new Date().toISOString(),
      lastCheckoutAttemptError: String(
        error?.code || "STRIPE_CHECKOUT_CREATE_FAILED",
      ).slice(0, 100),
    };
    await payment.save().catch(() => {});
    throw error;
  }
});

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
