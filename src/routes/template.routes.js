import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { makeResourceController } from "../controllers/resource.controller.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";

// Email and WhatsApp templates: Admin edits, Sales uses, Read-only has no access (brief 7).
const c = makeResourceController(resourceRegistry.templates.service);
const r = Router();
r.use(requireAuth);
r.get("/", requirePermission("templates.use"), c.list);
r.get("/:id", requirePermission("templates.use"), c.get);
r.post("/", requirePermission("templates.manage"), c.create);
r.patch("/:id", requirePermission("templates.manage"), c.update);
r.delete("/:id", requirePermission("templates.manage"), c.remove);
export default r;
