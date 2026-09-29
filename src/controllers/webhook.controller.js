import { asyncHandler } from "../utils/asyncHandler.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
export const receive = asyncHandler(async (req, res) => {
  const provider = req.params.provider;
  const externalEventId =
    req.get("x-event-id") ||
    req.body?.id ||
    `${provider}:${Date.now()}:${Math.random()}`;
  let event = await WebhookEvent.findOne({ provider, externalEventId });
  if (event)
    return res.json({
      success: true,
      data: { received: true, duplicate: true },
    });
  event = await WebhookEvent.create({
    provider,
    eventType: req.body?.type || req.body?.eventType || "unknown",
    externalEventId,
    payload: req.body,
    status: "received",
  });
  event.status = "processed";
  event.processedAt = new Date();
  await event.save();
  res
    .status(202)
    .json({ success: true, data: { received: true, eventId: event._id } });
});
