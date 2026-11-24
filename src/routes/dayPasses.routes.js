import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  adjustDayPasses, emailDayPassBalance, getDayPasses, listDayPasses, purchaseDayPasses, redeemDayPass,
} from "../services/dayPass.service.js";

// Day pass credits (client meeting 25 Nov, §3).

/** Mounted at /api/v1/contacts/:id/day-passes */
export const contactDayPassRoutes = Router({ mergeParams: true });
contactDayPassRoutes.use(requireAuth);
contactDayPassRoutes.get("/", asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getDayPasses(req.workspaceId, req.params.id) });
}));
contactDayPassRoutes.post("/purchase", requirePermission("records.write"), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await purchaseDayPasses(req.workspaceId, req.params.id, req.body || {}, req.user) });
}));
contactDayPassRoutes.post("/redeem", requirePermission("records.write"), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await redeemDayPass(req.workspaceId, req.params.id, req.body || {}, req.user) });
}));
contactDayPassRoutes.post("/adjust", requirePermission("credits.adjust"), asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await adjustDayPasses(req.workspaceId, req.params.id, req.body || {}, req.user) });
}));
contactDayPassRoutes.post("/email-balance", requirePermission("records.write"), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await emailDayPassBalance(req.workspaceId, req.params.id, req.user) });
}));

/** Mounted at /api/v1/day-passes (front desk list). */
export const dayPassListRoutes = Router();
dayPassListRoutes.use(requireAuth);
dayPassListRoutes.get("/", asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listDayPasses(req.workspaceId, req.query) });
}));
