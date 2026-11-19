import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { periodicReport } from "../services/reports.service.js";
import { breakdownReport } from "../services/reportsBreakdown.service.js";
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

// GET /reports/breakdown?by=revenue|leadSource|enquiryType&period=week|month&from=YYYY-MM-DD&to=YYYY-MM-DD
r.get(
  "/breakdown",
  asyncHandler(async (req, res) => {
    const { by, period = "month", from, to } = req.query;
    res.json({ success: true, data: await breakdownReport(req.workspaceId, { by, period, from, to }) });
  }),
);

export default r;
