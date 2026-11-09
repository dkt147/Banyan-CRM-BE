import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import * as c from "../controllers/member.controller.js";
const r = Router();
r.use(requireAuth);
r.get("/", c.list);
r.get("/:id", c.get);
// Users and roles: Admin only (brief section 7). Managers could previously create
// admins or change any user's role.
r.post("/", requirePermission("users.manage"), c.create);
r.patch("/:id", requirePermission("users.manage"), c.update);
r.delete("/:id", requirePermission("users.manage"), c.remove);
export default r;
