import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { globalSearch } from "../services/search.service.js";

const r = Router();
r.use(requireAuth);
// GET /search?q=  — global search across contacts, companies, deals and bookings.
r.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await globalSearch(req.workspaceId, req.query.q, Math.min(Number(req.query.limit) || 5, 20)) });
  }),
);
export default r;
