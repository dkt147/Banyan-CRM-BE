import { asyncHandler } from "../utils/asyncHandler.js";
import * as s from "../services/loyalty.service.js";
export const accounts = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await s.listAccounts(req.workspaceId, req.query),
  }),
);
export const adjust = asyncHandler(async (req, res) =>
  res.status(201).json({
    success: true,
    data: await s.adjust(
      req.workspaceId,
      req.user._id,
      req.body.contactId,
      req.body.points,
      req.body.reason,
    ),
  }),
);
export const redeem = asyncHandler(async (req, res) =>
  res.status(201).json({
    success: true,
    data: await s.requestRedemption(
      req.workspaceId,
      req.body.contactId,
      req.body.points,
      req.body.dealId,
      req.body.rewardDescription,
    ),
  }),
);
export const decide = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await s.decideRedemption(
      req.workspaceId,
      req.user._id,
      req.params.id,
      req.body.approve,
      req.body.reason,
    ),
  }),
);
