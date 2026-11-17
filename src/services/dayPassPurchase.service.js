/*
 * Website day-pass purchases (Stripe Payment Links) → CRM purchases.
 *
 * The day-pass pages sell through Stripe Payment Links, outside WordPress. Their checkout events
 * reach the CRM's existing Stripe webhook, which used to ignore them (no CRM invoice). Now a paid
 * checkout whose payment_link is listed in STRIPE_PAYMENT_LINK_PRODUCTS becomes:
 *   - a contact (email, then phone, else created), tagged website_booking (test_booking in test mode);
 *   - a won deal in the transactional pipeline (productType day_pass | day_pass_package), idempotent
 *     by checkout session id; test-mode deals carry metadata.isTest and are left out of reports;
 *   - a timeline entry (live purchases only).
 * A full refund (charge.refunded) marks the deal lost ("Refunded in Stripe"); a partial one adds a note.
 */
import { env } from "../config/env.js";
import { Activity } from "../models/Activity.js";
import { Deal } from "../models/Deal.js";
import { Pipeline } from "../models/Pipeline.js";
import { PipelineStage } from "../models/PipelineStage.js";
import { findOrCreateContact } from "./contactMatching.service.js";
import { getIntakeContext } from "./publicEnquiry.service.js";

export const DAY_PASS_PRODUCTS = {
  half_day_pass: { label: "Half Day Pass", productType: "day_pass" },
  day_pass: { label: "Day Pass", productType: "day_pass" },
  day_pass_10: { label: "10-Day Package", productType: "day_pass_package" },
};

const linkId = (session) => (typeof session?.payment_link === "string" ? session.payment_link : session?.payment_link?.id) || null;
const intentId = (obj) => (typeof obj?.payment_intent === "string" ? obj.payment_intent : obj?.payment_intent?.id) || null;

/** Product for a Payment Link id, or null when the link isn't a configured day pass. */
export function productForLink(paymentLink, map = env.STRIPE_PAYMENT_LINK_PRODUCTS) {
  const key = paymentLink ? map[paymentLink] : null;
  return key && DAY_PASS_PRODUCTS[key] ? { key, ...DAY_PASS_PRODUCTS[key] } : null;
}

function splitName(name, email) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: email ? email.split("@")[0] : "Guest", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function wonStage(workspaceId, pipelineId) {
  const stages = await PipelineStage.find({ workspaceId, pipelineId, isActive: { $ne: false } }).sort({ sortOrder: 1 }).lean();
  return stages.find((s) => s.isClosedWon) || stages.find((s) => s.key === "confirmed") || stages.find((s) => s.key === "completed") || stages.at(-1) || null;
}

const money = (amount) => `HK$${Number(amount || 0).toLocaleString("en-HK", { maximumFractionDigits: 2 })}`;

/** Paid Checkout Session from a configured Payment Link → { deal, created }. */
async function recordPurchase(session, product, paidAt) {
  const { workspace, owner } = await getIntakeContext();
  const workspaceId = workspace._id;
  const existing = await Deal.findOne({ workspaceId, "metadata.stripeCheckoutSessionId": session.id });
  if (existing) return { deal: existing, created: false };

  const pipeline = await Pipeline.findOne({ workspaceId, key: "transactional", isActive: { $ne: false } });
  if (!pipeline) throw new Error('The "transactional" pipeline is missing. Run the website-enquiry setup script.');
  const stage = await wonStage(workspaceId, pipeline._id);
  if (!stage) throw new Error("The transactional pipeline has no stages.");

  const details = session.customer_details || {};
  const email = String(details.email || session.customer_email || "").trim().toLowerCase() || undefined;
  const { firstName, lastName } = splitName(details.name, email);
  const live = session.livemode === true;
  const { contact } = await findOrCreateContact(
    workspaceId,
    owner._id,
    { firstName, lastName, email, phone: details.phone || undefined },
    { source: "website", tags: [live ? "website_booking" : "test_booking"] },
  );

  const value = Number(session.amount_total || 0) / 100;
  const currency = String(session.currency || "hkd").toUpperCase();
  let deal;
  try {
    deal = await Deal.create({
      workspaceId,
      title: `${product.label} – ${[contact.firstName, contact.lastName].filter(Boolean).join(" ") || email || "website"}`.slice(0, 200),
      contactId: contact._id,
      companyId: contact.companyId,
      pipelineId: pipeline._id,
      stageId: stage._id,
      ownerId: contact.ownerId || owner._id,
      value,
      currency,
      productType: product.productType,
      source: "website",
      status: "won",
      closedAt: paidAt,
      stageChangedAt: paidAt,
      lastActivityAt: paidAt,
      description: `${product.label} bought on the website (Stripe Payment Link).`,
      metadata: {
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: intentId(session),
        paymentLink: linkId(session),
        productKey: product.key,
        livemode: live,
        ...(live ? {} : { isTest: true }),
        paymentReceivedConfirmed: true,
        paymentConfirmationSource: "stripe_payment_link",
        paymentConfirmedAt: paidAt,
      },
    });
  } catch (error) {
    // Two deliveries raced past the findOne: the unique index kept one deal.
    if (error?.code === 11000) return { deal: await Deal.findOne({ workspaceId, "metadata.stripeCheckoutSessionId": session.id }), created: false };
    throw error;
  }

  if (live)
    await Activity.create({
      workspaceId,
      userId: owner._id,
      type: "purchase",
      contactId: contact._id,
      dealId: deal._id,
      subject: `Bought a ${product.label} (${money(value)}) on the website`,
      occurredAt: paidAt,
      metadata: { stripeCheckoutSessionId: session.id, productKey: product.key },
    }).catch((error) => console.error("[day-pass] activity failed:", error.message));
  return { deal, created: true };
}

async function recordRefund(charge) {
  const pi = intentId(charge);
  if (!pi) return null;
  const deal = await Deal.findOne({ "metadata.stripePaymentIntentId": pi, "metadata.paymentConfirmationSource": "stripe_payment_link" });
  if (!deal) return null;
  const full = charge.refunded === true || (Number(charge.amount) > 0 && Number(charge.amount_refunded) >= Number(charge.amount));
  const refunded = money(Number(charge.amount_refunded || 0) / 100);
  if (full && deal.status !== "lost") {
    deal.status = "lost";
    deal.lostReason = "Refunded in Stripe";
  }
  deal.metadata = { ...(deal.metadata || {}), stripeRefundedAmountMinor: charge.amount_refunded, refundedAt: new Date() };
  deal.markModified("metadata");
  await deal.save();
  if (!deal.metadata.isTest)
    await Activity.create({
      workspaceId: deal.workspaceId,
      userId: deal.ownerId,
      type: "purchase_refunded",
      contactId: deal.contactId,
      dealId: deal._id,
      subject: full ? `Day pass refunded in Stripe (${refunded})` : `Partial refund in Stripe (${refunded})`,
      occurredAt: new Date(),
    }).catch(() => {});
  return { deal, full };
}

/**
 * Called by the Stripe webhook when no CRM invoice payment matches the event.
 * Returns a result object when the event was a day-pass event, else null (caller ignores it).
 */
export async function handleDayPassStripeEvent(event, eventRecord) {
  const object = event.data?.object || {};
  const done = async (result, note) => {
    eventRecord.status = result.ignored ? "ignored" : "processed";
    eventRecord.processedAt = new Date();
    eventRecord.error = note;
    await eventRecord.save();
    return { handled: !result.ignored, ...result };
  };

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const link = linkId(object);
    if (!link) return null;
    const product = productForLink(link);
    if (!product) return done({ ignored: true, reason: "unknown_payment_link" }, `Payment Link ${link} is not a configured day pass.`);
    if (event.type === "checkout.session.completed" && object.payment_status !== "paid")
      return done({ pending: true, reason: "day_pass_payment_pending" }, "Checkout completed; waiting for the payment to settle.");
    const paidAt = event.created ? new Date(event.created * 1000) : new Date();
    const { deal, created } = await recordPurchase(object, product, paidAt);
    if (deal?.workspaceId) eventRecord.workspaceId = deal.workspaceId;
    return done({ dayPass: product.key, dealId: String(deal._id), created }, created ? undefined : "Day pass already recorded.");
  }
  if (event.type === "charge.refunded") {
    const r = await recordRefund(object);
    if (!r) return null;
    eventRecord.workspaceId = r.deal.workspaceId;
    return done({ dayPassRefund: true, dealId: String(r.deal._id), full: r.full });
  }
  if (event.type === "payment_intent.succeeded") {
    // The checkout.session event creates the deal; this one only confirms it if already there.
    const deal = await Deal.findOne({ "metadata.stripePaymentIntentId": object.id, "metadata.paymentConfirmationSource": "stripe_payment_link" }).select("_id workspaceId");
    if (!deal) return null;
    eventRecord.workspaceId = deal.workspaceId;
    return done({ dayPass: true, dealId: String(deal._id), created: false }, "Day pass already recorded.");
  }
  return null;
}
