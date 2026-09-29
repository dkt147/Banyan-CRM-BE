import { asyncHandler } from "../utils/asyncHandler.js";
import { Invoice } from "../models/Invoice.js";
import { Payment } from "../models/Payment.js";
import { AppError } from "../utils/AppError.js";
import { earnFromPayment } from "../services/loyalty.service.js";
export const markPaid = asyncHandler(async (req, res) => {
  const inv = await Invoice.findOne({
    _id: req.params.id,
    workspaceId: req.workspaceId,
  });
  if (!inv) throw new AppError("Invoice not found", 404, "NOT_FOUND");
  if (inv.status === "paid") return res.json({ success: true, data: inv });
  const amount = req.body.amount ?? inv.total;
  const payment = await Payment.create({
    workspaceId: req.workspaceId,
    invoiceId: inv._id,
    provider: req.body.provider || "stripe",
    externalId: req.body.externalId,
    amount,
    currency: inv.currency,
    status: "succeeded",
    paidAt: new Date(),
  });
  inv.status = "paid";
  inv.paidAt = new Date();
  await inv.save();
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
