import { Router } from "express";

import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { adjustCredits, companyCredits } from "../services/credits.service.js";
import { companyLoyalty } from "../services/companyLoyalty.service.js";

import {
  createCompanyController,
  getCompaniesController,
  getCompanyController,
  updateCompanyController,
  archiveCompanyController,
  deleteCompanyController,
} from "../controllers/company.controller.js";

const router = Router();

router.use(requireAuth);

router.post("/", createCompanyController);

router.get("/", getCompaniesController);

router.get("/:companyId", getCompanyController);

router.patch("/:companyId", updateCompanyController);

router.patch("/:companyId/archive", archiveCompanyController);

// Meeting room credits (19 Nov, §5): GET ?month=YYYY-MM; adjust { hours, note, month? } (admin).
router.get(
  "/:companyId/credits",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await companyCredits(req.workspaceId, req.params.companyId, req.query.month) });
  }),
);
router.post(
  "/:companyId/credits/adjust",
  requirePermission("credits.adjust"),
  asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await adjustCredits(req.workspaceId, req.params.companyId, req.body || {}, req.user) });
  }),
);

// Loyalty tier by spend over the last 12 months (19 Nov, §6), with monthly spend.
router.get(
  "/:companyId/loyalty",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await companyLoyalty(req.workspaceId, req.params.companyId) });
  }),
);

router.delete("/:companyId", deleteCompanyController);

export default router;
