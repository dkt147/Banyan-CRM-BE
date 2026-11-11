/*
 * POST /api/v1/webhooks/banyan-bookings
 * Push from the WordPress "Banyan Room Booking" plugin (booking.paid / booking.cancelled).
 * Enter the full URL in WP Admin > Room Bookings > Settings > CRM API URL.
 *
 * Auth: X-Banyan-Token must equal BANYAN_CRM_TOKEN and X-Banyan-Signature must be the hex
 * HMAC-SHA256 of the raw body (req.rawBody, kept by express.json in app.js), keyed with the token.
 * Any 2xx marks the booking "sent" in WordPress; anything else lets staff "Resend to CRM".
 */
import { env } from "../config/env.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { getWpBookingContext, upsertWpBooking, verifyWpSignature } from "../services/wpRoomBooking.service.js";

const PROVIDER = "banyan_wordpress";

export async function receiveWpBookingWebhook(req, res) {
  if (!env.BANYAN_CRM_TOKEN)
    return res.status(503).json({ ok: false, message: "BANYAN_CRM_TOKEN is not configured." });
  if (!verifyWpSignature(req.rawBody, req.get("x-banyan-signature"), req.get("x-banyan-token")))
    return res.status(401).json({ ok: false, message: "Invalid token or signature." });

  let payload;
  try {
    // Parse the verified bytes, never the re-serialised body.
    payload = JSON.parse(req.rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ ok: false, message: "Body is not valid JSON." });
  }
  const event = String(req.get("x-banyan-event") || payload?.event || "").slice(0, 60);
  const ref = payload?.booking?.ref || null;

  let context = null;
  try {
    context = await getWpBookingContext();
    const { booking, created, skipped } = await upsertWpBooking(payload, { origin: "webhook", event, context });
    await WebhookEvent.create({
      workspaceId: context.workspaceId,
      provider: PROVIDER,
      eventType: event,
      payload,
      status: skipped ? "ignored" : "processed",
      error: skipped || undefined,
      processedAt: new Date(),
    }).catch(() => {});
    return res.json({ ok: true, id: String(booking._id), ref, created, ...(skipped ? { skipped } : {}) });
  } catch (error) {
    await WebhookEvent.create({
      workspaceId: context?.workspaceId,
      provider: PROVIDER,
      eventType: event,
      payload,
      status: "failed",
      error: String(error.message).slice(0, 500),
    }).catch(() => {});
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    return res.status(status).json({ ok: false, ref, message: error.message });
  }
}
