import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import * as c from "../controllers/member.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAudit } from "../utils/audit.js";
import { adminSetPassword } from "../services/password.service.js";
const r = Router();
r.use(requireAuth);
r.get("/", c.list);
r.get("/:id", c.get);
// Users and roles: Admin only (brief section 7). Managers could previously create
// admins or change any user's role.
r.post("/", requirePermission("users.manage"), c.create);
r.patch("/:id", requirePermission("users.manage"), c.update);
r.delete("/:id", requirePermission("users.manage"), c.remove);
// Admin sets a member's password (25 Nov, §2a). Signs that member out everywhere.
r.post(
  "/:id/password",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const data = await adminSetPassword(req.user, req.params.id, req.body?.password);
    await writeAudit(req, { action: "user.password_set", entityType: "user", entityId: data.id });
    res.json({ success: true, data });
  }),
);
export default r;
