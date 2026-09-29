import { LoyaltyAccount } from "../models/LoyaltyAccount.js";
import { LoyaltyLedger } from "../models/LoyaltyLedger.js";
import { LoyaltyTier } from "../models/LoyaltyTier.js";
import { LoyaltyRedemption } from "../models/LoyaltyRedemption.js";
import { Invoice } from "../models/Invoice.js";
import { AppError } from "../utils/AppError.js";
async function tierFor(workspaceId, spend) {
  return LoyaltyTier.findOne({
    workspaceId,
    minSpend: { $lte: spend },
    isActive: true,
  }).sort({ minSpend: -1 });
}
export async function ensureAccount(workspaceId, contactId) {
  let a = await LoyaltyAccount.findOne({ workspaceId, contactId });
  if (a) return a;
  return LoyaltyAccount.create({ workspaceId, contactId });
}
export async function listAccounts(workspaceId, q) {
  const page = Math.max(+q.page || 1, 1),
    limit = Math.min(Math.max(+q.limit || 25, 1), 100);
  const [items, total] = await Promise.all([
    LoyaltyAccount.find({ workspaceId })
      .populate("contactId tierId")
      .sort({ lifetimeSpend: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    LoyaltyAccount.countDocuments({ workspaceId }),
  ]);
  return {
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}
export async function earnFromPayment(workspaceId, userId, invoiceId, amount) {
  const invoice = await Invoice.findOne({
    _id: invoiceId,
    workspaceId,
  }).populate("contactId");
  if (!invoice || !invoice.contactId)
    throw new AppError("Invoice/contact not found", 404, "INVOICE_NOT_FOUND");
  const existing = await LoyaltyLedger.findOne({
    workspaceId,
    invoiceId,
    type: "earn",
  });
  if (existing) return LoyaltyAccount.findById(existing.accountId);
  const points = Math.floor(amount / 100);
  if (points <= 0) return null;
  const a = await ensureAccount(workspaceId, invoice.contactId._id);
  a.pointsBalance += points;
  a.lifetimeEarned += points;
  a.lifetimeSpend += amount;
  a.lastEventAt = new Date();
  a.tierId = (await tierFor(workspaceId, a.lifetimeSpend))?._id || a.tierId;
  await a.save();
  await LoyaltyLedger.create({
    workspaceId,
    accountId: a._id,
    contactId: a.contactId,
    type: "earn",
    points,
    balanceAfter: a.pointsBalance,
    invoiceId,
    createdBy: userId,
    reason: `Invoice paid ${amount}`,
  });
  return a;
}
export async function adjust(workspaceId, userId, contactId, points, reason) {
  const a = await ensureAccount(workspaceId, contactId);
  const next = a.pointsBalance + points;
  if (next < 0)
    throw new AppError(
      "Adjustment exceeds points balance",
      400,
      "INSUFFICIENT_POINTS",
    );
  a.pointsBalance = next;
  await a.save();
  return LoyaltyLedger.create({
    workspaceId,
    accountId: a._id,
    contactId,
    type: "adjust",
    points,
    balanceAfter: next,
    createdBy: userId,
    reason,
  });
}
export async function requestRedemption(
  workspaceId,
  contactId,
  points,
  dealId,
  rewardDescription,
) {
  const a = await ensureAccount(workspaceId, contactId);
  if (a.pointsBalance < points)
    throw new AppError("Insufficient points", 400, "INSUFFICIENT_POINTS");
  return LoyaltyRedemption.create({
    workspaceId,
    accountId: a._id,
    contactId,
    points,
    dealId,
    rewardDescription,
  });
}
export async function decideRedemption(
  workspaceId,
  userId,
  id,
  approve,
  reason,
) {
  const r = await LoyaltyRedemption.findOne({ _id: id, workspaceId });
  if (!r) throw new AppError("Redemption not found", 404, "NOT_FOUND");
  if (r.status !== "requested")
    throw new AppError("Redemption is already decided", 400, "INVALID_STATUS");
  r.status = approve ? "approved" : "declined";
  r.decidedAt = new Date();
  r.decidedBy = userId;
  r.reason = reason;
  await r.save();
  if (approve) {
    const a = await LoyaltyAccount.findOne({ _id: r.accountId, workspaceId });
    if (a.pointsBalance < r.points)
      throw new AppError("Insufficient points", 400, "INSUFFICIENT_POINTS");
    a.pointsBalance -= r.points;
    a.lifetimeRedeemed += r.points;
    await a.save();
    await LoyaltyLedger.create({
      workspaceId,
      accountId: a._id,
      contactId: a.contactId,
      type: "redeem",
      points: -r.points,
      balanceAfter: a.pointsBalance,
      redemptionId: r._id,
      createdBy: userId,
      reason,
    });
    r.status = "applied";
    await r.save();
  }
  return r;
}
