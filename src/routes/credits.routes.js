import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { creditsOverview } from "../services/credits.service.js";

// GET /credits?month=YYYY-MM: every company with meeting room credits, with used and remaining (19 Nov, §5).
const r = Router();
r.use(requireAuth);
r.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await creditsOverview(req.workspaceId, req.query.month) });
  }),
);
export default r;
