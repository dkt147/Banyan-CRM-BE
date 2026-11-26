import { writeAudit } from "./audit.js";

/*
 * Failed room booking calls (27 Nov, after round b): checkout, credit-booking and sync failures are
 * recorded in AuditLog as "room_booking.failed", so they can be counted without Render's logs.
 * Recorded: endpoint, HTTP status, error code, message, room, date and the staff user (AuditLog.actorId).
 * Never the customer's name, email, phone or notes. Nothing is sent to WordPress.
 */
export const FAILURE_PATHS = ["/checkout", "/credit-booking", "/sync"];

const EMAIL_RX = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi;
const PHONE_RX = /\+?\d[\d\s().-]{6,}\d/g;
/** Error text without anything that looks like an email address or phone number. */
export function scrubMessage(message) {
  return String(message || "")
    .replace(EMAIL_RX, "[email]")
    .replace(PHONE_RX, "[number]")
    .slice(0, 300);
}

const short = (v, max = 40) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : null);

function failureDetails(err, req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const endpoint = FAILURE_PATHS.find((p) => req.path === p || req.path.startsWith(`${p}/`)) || req.path;
  const date = endpoint === "/sync" ? (body.from || body.to ? `${short(body.from, 10) || ""}..${short(body.to, 10) || ""}` : null) : short(body.date, 10);
  return {
    endpoint: endpoint.slice(1),
    status: Number(err?.statusCode || err?.status) || 500,
    code: err?.name === "ZodError" ? "VALIDATION_ERROR" : short(err?.code, 60) || "INTERNAL_ERROR",
    message: scrubMessage(err?.name === "ZodError" ? (err.issues || []).map((i) => `${(i.path || []).join(".")}: ${i.message}`).join("; ") : err?.message),
    room: short(body.room, 30),
    date,
  };
}

/** Error middleware for the room bookings router: records, then passes the error on unchanged. */
export function recordRoomBookingFailure(err, req, _res, next) {
  if (req.method === "POST" && FAILURE_PATHS.some((p) => req.path === p)) {
    writeAudit(req, { action: "room_booking.failed", entityType: "room_booking", after: failureDetails(err, req) }).catch(() => {});
  }
  next(err);
}
