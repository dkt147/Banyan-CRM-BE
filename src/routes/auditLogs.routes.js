import { Router } from "express";
import { requireAuth, requireRoles } from "../middleware/auth.middleware.js";
import { AuditLog } from "../models/AuditLog.js";
const r = Router();
r.use(requireAuth, requireRoles("admin", "manager"));
r.get("/", async (req, res, next) => {
  try {
    const filter = { workspaceId: req.workspaceId };
    for (const k of ["actorId", "action", "entityType", "entityId"])
      if (req.query[k]) filter[k] = req.query[k];
    const data = await AuditLog.find(filter)
      .populate("actorId")
      .sort({ createdAt: -1 })
      .limit(Math.min(+req.query.limit || 100, 200));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});
export default r;
