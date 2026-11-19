import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import * as c from "../controllers/loyalty.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { companyLoyaltyList } from "../services/companyLoyalty.service.js";
const r = Router();
r.use(requireAuth);
r.get("/accounts", c.accounts);
// Company tiers by 12-month spend (19 Nov, §6): ?search=&tier=<id or name>&page=&limit=
r.get(
  "/companies",
  asyncHandler(async (req, res) => {
    const { search, tier, page, limit } = req.query;
    res.json({ success: true, data: await companyLoyaltyList(req.workspaceId, { search, tier, page, limit }) });
  }),
);
r.post("/adjust", c.adjust);
r.post("/redemptions", c.redeem);
r.patch("/redemptions/:id/decision", c.decide);
export default r;
