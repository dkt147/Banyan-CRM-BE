import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import {
  availability,
  hold,
  confirm,
  cancel,
  events,
} from "../controllers/calendar.controller.js";

const r = Router();
r.use(requireAuth);

// Specialized calendar/booking operations must be declared before the generic
// /:id CRUD route so they cannot be captured as resource IDs.
r.get("/availability", availability);
r.get("/events", events);
r.post("/hold", hold);
r.patch("/:id/confirm", confirm);
r.patch("/:id/cancel", cancel);

// Standard CalendarEvent CRUD remains available under /calendar.
r.use(resourceRouter(resourceRegistry.calendar.service));

export default r;
