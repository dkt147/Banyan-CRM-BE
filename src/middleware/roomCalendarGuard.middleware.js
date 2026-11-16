import mongoose from "mongoose";
import { CalendarEvent } from "../models/CalendarEvent.js";
import { assertCalendarEventWritable } from "../services/roomCalendar.service.js";

/** 409 for PATCH/PUT/DELETE of a CalendarEvent that belongs to a shared room calendar. */
export async function rejectRoomCalendarEventWrite(req, _res, next) {
  try {
    if (mongoose.isValidObjectId(req.params.id)) {
      const event = await CalendarEvent.findOne({ _id: req.params.id, workspaceId: req.workspaceId }).select("metadata").lean();
      await assertCalendarEventWritable(req.workspaceId, event);
    }
    next();
  } catch (error) {
    next(error);
  }
}
