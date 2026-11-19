import app from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { runMembershipRenewalJobs } from "./services/membershipRenewalJobs.service.js";
import { pollGoogleCalendars } from "./services/googleCalendarPoller.service.js";
import { pollGmailInboxes } from "./services/gmailPoller.service.js";
import { runScheduledAutomations } from "./services/automation.service.js";
import { getWpBookingContext, runWpBookingSyncJob } from "./services/wpRoomBooking.service.js";
import { runPartnerBlocksJob } from "./services/partnerBlocks.service.js";
import { relabelTestEvents } from "./services/roomCalendar.service.js";
await connectDatabase();
app.listen(env.PORT, () => {
  console.log(`Banyan API listening on ${env.PORT}`);
  // Check renewal reminders hourly; metadata markers make the job idempotent.
  setTimeout(() => runMembershipRenewalJobs(), 15_000);
  setInterval(() => runMembershipRenewalJobs(), 60 * 60 * 1000).unref();
  // Google Calendar sync runs every 5 minutes when an authorized integration exists.
  setTimeout(() => pollGoogleCalendars(), 30_000);
  setInterval(() => pollGoogleCalendars(), 5 * 60 * 1000).unref();
  // Gmail inbox polling is enabled only for a connected OAuth integration.
  setTimeout(() => pollGmailInboxes(), 45_000);
  setInterval(() => pollGmailInboxes(), 5 * 60 * 1000).unref();
  // Time-based automation rules (e.g. "deal inactive for 5 days") are checked every 15 minutes.
  setTimeout(() => runScheduledAutomations(), 60_000);
  setInterval(() => runScheduledAutomations(), 15 * 60 * 1000).unref();
  // WordPress room bookings: updated_since reconciliation (first run backfills). Needs BANYAN_CRM_TOKEN.
  if (env.BANYAN_BOOKING_SYNC_MINUTES > 0) {
    setTimeout(() => runWpBookingSyncJob(), 20_000);
    setInterval(() => runWpBookingSyncJob(), env.BANYAN_BOOKING_SYNC_MINUTES * 60 * 1000).unref();
  }
  // Partner room-calendar events → WordPress blocks. Does nothing unless switched on in the room
  // calendar settings and WordPress has POST /blocks (docs/WP_PARTNER_BLOCKS_SPEC.md).
  const partnerBlocks = () =>
    getWpBookingContext().then(({ workspaceId }) => runPartnerBlocksJob(workspaceId)).catch(() => {});
  setTimeout(partnerBlocks, 90_000);
  // Label test bookings already in the room calendars "TEST – " (no-op once done).
  setTimeout(() => relabelTestEvents().catch((e) => console.error("[room-calendar] relabel:", e.message)), 120_000);
  setInterval(partnerBlocks, 10 * 60 * 1000).unref();
});
