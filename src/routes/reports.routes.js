import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { periodicReport } from "../services/reports.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Reports are read-only and visible to every role.
const r = Router();
r.use(requireAuth);

// GET /reports/periodic?period=month|year&from=YYYY-MM&to=YYYY-MM (Hong Kong months)
r.get(
  "/periodic",
  asyncHandler(async (req, res) => {
    const { period = "month", from, to } = req.query;
    res.json({ success: true, data: await periodicReport(req.workspaceId, { period, from, to }) });
  }),
);

export default r;
