import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import * as c from "../controllers/invoice.controller.js";

const r = Router();
r.use(requireAuth);

// Specialized actions must be declared before generic /:id CRUD routes.
r.patch("/:id/pay", c.markPaid);
r.post("/mark-overdue", c.overdue);

r.use(resourceRouter(resourceRegistry.invoices.service));

export default r;
