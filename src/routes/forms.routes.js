import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { makeResourceController } from "../controllers/resource.controller.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";

// Read-only for now: form configuration (admin-only create/edit) and the public
// submission endpoint arrive with the Forms feature (brief 6.5, N7).
const c = makeResourceController(resourceRegistry.forms.service);
const r = Router();
r.use(requireAuth);
r.get("/", c.list);
r.get("/:id", c.get);
export default r;
