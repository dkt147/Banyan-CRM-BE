import { asyncHandler } from "../utils/asyncHandler.js";
import * as s from "../services/deal.service.js";
export const listDeals = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await s.listDeals(req.workspaceId, req.query),
  }),
);
export const getDeal = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await s.getDeal(req.workspaceId, req.params.id),
  }),
);
export const createDeal = asyncHandler(async (req, res) =>
  res.status(201).json({
    success: true,
    data: await s.createDeal(req.workspaceId, req.user._id, req.body),
  }),
);
export const updateDeal = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await s.updateDeal(
      req.workspaceId,
      req.user._id,
      req.params.id,
      req.body,
    ),
  }),
);
export const moveDeal = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await s.moveDeal(
      req.workspaceId,
      req.user._id,
      req.params.id,
      req.body.stageId,
    ),
  }),
);
export const deleteDeal = asyncHandler(async (req, res) =>
  res.json({
    success: true,
    data: await s.deleteDeal(req.workspaceId, req.params.id),
  }),
);
