import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import { rejectRoomCalendarEventWrite } from "../middleware/roomCalendarGuard.middleware.js";

// Events imported from a shared room calendar are read-only (feedback 17 Nov, #7).
const r = Router();
r.use(requireAuth);
r.patch("/:id", rejectRoomCalendarEventWrite);
r.put("/:id", rejectRoomCalendarEventWrite);
r.delete("/:id", rejectRoomCalendarEventWrite);
r.use(resourceRouter(resourceRegistry.calendar.service));
export default r;
