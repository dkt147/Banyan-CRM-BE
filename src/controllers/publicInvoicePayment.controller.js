import crypto from "node:crypto";
import { Invoice } from "../models/Invoice.js";
import { Payment } from "../models/Payment.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";
import { providerJson, requireEnvironment } from "../services/providerApi.service.js";

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
  "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);
const THREE_DECIMAL_CURRENCIES = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

function toStripeMinorUnits(amount, currency) {
  const normalized = String(currency || "HKD").toLowerCase();
  const multiplier = ZERO_DECIMAL_CURRENCIES.has(normalized)
    ? 1
    : THREE_DECIMAL_CURRENCIES.has(normalized) ? 1000 : 100;
  return Math.round(Number(amount) * multiplier);
}

function safeInvoice(invoice) {
  return {
    _id: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    description: invoice.description,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    currency: invoice.currency || "HKD",
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt,
    status: invoice.status,
    createdAt: invoice.createdAt,
  };
}

function publicReturnUrl(token, outcome) {
  const url = new URL(`/pay/${encodeURIComponent(token)}`, env.CLIENT_URL);
  url.searchParams.set("payment", outcome);
  return url.toString();
}

function requirePayable(invoice) {
  if (invoice.status === "paid") {
    throw new AppError("This invoice has already been paid.", 409, "INVOICE_ALREADY_PAID");
  }
  if (["draft", "cancelled"].includes(invoice.status)) {
    throw new AppError("Only issued, unpaid invoices can be paid through Stripe.", 409, "INVOICE_NOT_PAYABLE");
  }
  const amount = toStripeMinorUnits(invoice.total, invoice.currency);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError("Invoice total must be greater than zero to start a payment.", 400, "INVALID_PAYMENT_AMOUNT");
  }
  return amount;
}

export const createInvoicePaymentLink = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, workspaceId: req.workspaceId }).select("+publicPaymentToken");
  if (!invoice) throw new AppError("Invoice not found.", 404, "NOT_FOUND");
  requirePayable(invoice);

  if (!invoice.publicPaymentToken) {
    invoice.publicPaymentToken = crypto.randomBytes(32).toString("base64url");
    await invoice.save();
  }

  res.status(200).json({
    success: true,
    data: {
      invoiceId: invoice._id,
      token: invoice.publicPaymentToken,
      status: invoice.status,
    },
  });
});

export const getPublicInvoice = asyncHandler(async (req, res) => {
  const token = String(req.params.token || "");
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    throw new AppError("This payment link is invalid or unavailable.", 404, "PUBLIC_INVOICE_NOT_FOUND");
  }
  const invoice = await Invoice.findOne({ publicPaymentToken: token }).select("+publicPaymentToken");
  if (!invoice) throw new AppError("This payment link is invalid or unavailable.", 404, "PUBLIC_INVOICE_NOT_FOUND");
  res.json({ success: true, data: safeInvoice(invoice) });
});

export const createPublicInvoiceCheckout = asyncHandler(async (req, res) => {
  requireEnvironment("STRIPE_SECRET_KEY");
  const token = String(req.params.token || "");
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    throw new AppError("This payment link is invalid or unavailable.", 404, "PUBLIC_INVOICE_NOT_FOUND");
  }

  const invoice = await Invoice.findOne({ publicPaymentToken: token }).select("+publicPaymentToken");
  if (!invoice) throw new AppError("This payment link is invalid or unavailable.", 404, "PUBLIC_INVOICE_NOT_FOUND");
  const amount = requirePayable(invoice);

  let payment = await Payment.findOne({
    workspaceId: invoice.workspaceId,
    invoiceId: invoice._id,
    provider: "stripe",
    status: "pending",
    "metadata.source": "banyan_public_invoice_payment_link",
  }).sort({ createdAt: -1 });

  if (payment?.metadata?.checkoutSessionId) {
    const existingSession = await providerJson(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(payment.metadata.checkoutSessionId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, Accept: "application/json" } },
      "Stripe",
    );
    if (existingSession.status === "open" && existingSession.url) {
      return res.json({ success: true, data: { checkoutUrl: existingSession.url, status: "pending", reused: true } });
    }
    if (existingSession.status === "expired") {
      payment.status = "failed";
      payment.metadata = { ...(payment.metadata || {}), checkoutExpiredAt: new Date().toISOString() };
      await payment.save();
      payment = null;
    } else {
      throw new AppError("A payment is already processing for this invoice. Please refresh the page shortly.", 409, "STRIPE_PAYMENT_ALREADY_PROCESSING");
    }
  }

  payment ||= await Payment.create({
    workspaceId: invoice.workspaceId,
    invoiceId: invoice._id,
    provider: "stripe",
    amount: Number(invoice.total),
    currency: invoice.currency || "HKD",
    status: "pending",
    metadata: { source: "banyan_public_invoice_payment_link", publicPaymentToken: token },
  });

  try {
    const invoiceLabel = invoice.invoiceNumber || String(invoice._id).slice(-8);
    const params = new URLSearchParams({
      mode: "payment",
      success_url: publicReturnUrl(token, "success"),
      cancel_url: publicReturnUrl(token, "cancelled"),
      client_reference_id: String(payment._id),
      "line_items[0][price_data][currency]": String(invoice.currency || "HKD").toLowerCase(),
      "line_items[0][price_data][product_data][name]": `Banyan Invoice ${invoiceLabel}`,
      "line_items[0][price_data][unit_amount]": String(amount),
      "line_items[0][quantity]": "1",
      "metadata[banyanPaymentId]": String(payment._id),
      "metadata[banyanInvoiceId]": String(invoice._id),
      "metadata[banyanWorkspaceId]": String(invoice.workspaceId),
      "payment_intent_data[metadata][banyanPaymentId]": String(payment._id),
      "payment_intent_data[metadata][banyanInvoiceId]": String(invoice._id),
      "payment_intent_data[metadata][banyanWorkspaceId]": String(invoice.workspaceId),
    });
    const session = await providerJson(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "Idempotency-Key": `banyan-public-invoice-${payment._id}`,
        },
        body: params,
      },
      "Stripe",
    );
    if (!session.id || !session.url) {
      throw new AppError("Stripe did not return a usable Checkout Session URL.", 502, "STRIPE_CHECKOUT_SESSION_INVALID");
    }
    payment.externalId = session.id;
    payment.metadata = {
      ...(payment.metadata?.toObject ? payment.metadata.toObject() : payment.metadata || {}),
      checkoutSessionId: session.id,
      stripeCheckoutStatus: session.status,
    };
    await payment.save();
    return res.status(201).json({ success: true, data: { checkoutUrl: session.url, status: "pending" } });
  } catch (error) {
    payment.metadata = {
      ...(payment.metadata?.toObject ? payment.metadata.toObject() : payment.metadata || {}),
      lastCheckoutAttemptAt: new Date().toISOString(),
      lastCheckoutAttemptError: String(error?.code || "STRIPE_CHECKOUT_CREATE_FAILED").slice(0, 100),
    };
    await payment.save().catch(() => {});
    throw error;
  }
});
