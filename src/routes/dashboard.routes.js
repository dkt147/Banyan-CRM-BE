import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import * as c from "../controllers/dashboard.controller.js";
const r = Router();
r.use(requireAuth);
r.get("/overview", c.overview);
r.get("/pipeline", c.pipeline);
r.get("/revenue", c.revenue);
export default r;
