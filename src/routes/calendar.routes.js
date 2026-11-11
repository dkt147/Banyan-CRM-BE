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
  week,
} from "../controllers/calendar.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assertNotWpManaged, rejectWpRoomForCrmBooking } from "../services/wpRoomBooking.service.js";

const r = Router();
r.use(requireAuth);

// Specialized calendar/booking operations must be declared before the generic
// /:id CRUD route so they cannot be captured as resource IDs.
r.get("/availability", availability);
r.get("/events", events);
r.get("/week", week);
// Meeting rooms owned by WordPress are booked through WordPress only (no CRM-only holds).
r.post("/hold", rejectWpRoomForCrmBooking, hold);
// Bookings mirrored from WordPress are confirmed/cancelled in WordPress only.
const notWpManaged = asyncHandler(async (req, _res, next) => {
  await assertNotWpManaged(req.workspaceId, req.params.id);
  next();
});
r.patch("/:id/confirm", notWpManaged, confirm);
r.patch("/:id/cancel", notWpManaged, cancel);

// Standard CalendarEvent CRUD remains available under /calendar.
r.use(resourceRouter(resourceRegistry.calendar.service));

export default r;
