import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { makeResourceController } from "../controllers/resource.controller.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import { auditAfter } from "../utils/audit.js";

// Bookable rooms. Everyone can view; rooms, opening hours and pricing are Admin-only
// (brief section 7). Deactivate with isActive=false instead of deleting, so existing
// bookings keep a valid resourceId.
const c = makeResourceController(resourceRegistry.resources.service);
const r = Router();
r.use(requireAuth);
r.get("/", c.list);
r.get("/:id", c.get);
r.post("/", requirePermission("resources.manage"), auditAfter("resource.created", "resource"), c.create);
r.patch("/:id", requirePermission("resources.manage"), auditAfter("resource.updated", "resource"), c.update);
export default r;
