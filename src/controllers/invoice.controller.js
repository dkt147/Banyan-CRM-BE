import { asyncHandler } from "../utils/asyncHandler.js";
import { Invoice } from "../models/Invoice.js";
import { Payment } from "../models/Payment.js";
import { AppError } from "../utils/AppError.js";
import { earnFromPayment } from "../services/loyalty.service.js";
import { Deal } from "../models/Deal.js";
export const markPaid = asyncHandler(async (req, res) => {
  const inv = await Invoice.findOne({
    _id: req.params.id,
    workspaceId: req.workspaceId,
  });
  if (!inv) throw new AppError("Invoice not found", 404, "NOT_FOUND");
  const provider = String(req.body.provider || inv.provider || "manual").toLowerCase();
  const stripePaymentInProgress = await Payment.exists({
    workspaceId: req.workspaceId,
    invoiceId: inv._id,
    provider: "stripe",
    status: { $in: ["pending", "succeeded"] },
  });
  if (provider === "stripe" || stripePaymentInProgress) {
    throw new AppError(
      "Stripe payments must be completed through Checkout and confirmed by the Stripe webhook.",
      409,
      "STRIPE_PAYMENT_WEBHOOK_MANAGED",
    );
  }
  if (inv.status === "paid") return res.json({ success: true, data: inv });
  const amount = req.body.amount ?? inv.total;
  const payment = await Payment.create({
    workspaceId: req.workspaceId,
    invoiceId: inv._id,
    provider: req.body.provider || inv.provider || "manual",
    externalId: req.body.externalId,
    amount,
    currency: inv.currency,
    status: "succeeded",
    paidAt: new Date(),
  });
  inv.status = "paid";
  inv.paidAt = new Date();
  await inv.save();
  if (inv.dealId) await Deal.updateOne({ _id: inv.dealId, workspaceId: req.workspaceId }, { $set: { status: "won", "metadata.paymentReceivedConfirmed": true, "metadata.paymentConfirmationSource": "manual", "metadata.paymentConfirmedAt": inv.paidAt } });
  const loyalty = await earnFromPayment(
    req.workspaceId,
    req.user._id,
    inv._id,
    amount,
  );
  res.json({ success: true, data: { invoice: inv, payment, loyalty } });
});
export const overdue = asyncHandler(async (req, res) => {
  const now = new Date();
  const r = await Invoice.updateMany(
    { workspaceId: req.workspaceId, status: "awaiting", dueAt: { $lt: now } },
    { $set: { status: "overdue" } },
  );
  res.json({ success: true, data: { updated: r.modifiedCount } });
});
