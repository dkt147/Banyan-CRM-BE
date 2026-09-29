import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import * as c from "../controllers/notification.controller.js";
const r = Router();
r.use(requireAuth);
r.get("/", c.list);
r.patch("/read-all", c.readAll);
r.patch("/:id/read", c.read);
export default r;
