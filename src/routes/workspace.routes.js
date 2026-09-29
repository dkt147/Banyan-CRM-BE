import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import * as c from "../controllers/workspace.controller.js";
const r = Router();
r.use(requireAuth);
r.get("/", c.get);
r.patch("/", c.update);
export default r;
