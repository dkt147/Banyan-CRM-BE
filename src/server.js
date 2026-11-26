import app from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { runMembershipRenewalJobs } from "./services/membershipRenewalJobs.service.js";
import { onRoomCalendarChange, pollGoogleCalendars } from "./services/googleCalendarPoller.service.js";
import { pollGmailInboxes } from "./services/gmailPoller.service.js";
import { runScheduledAutomations } from "./services/automation.service.js";
import { getWpBookingContext, runWpBookingSyncJob } from "./services/wpRoomBooking.service.js";
import { runPartnerBlocksJob } from "./services/partnerBlocks.service.js";
import { relabelTestEvents } from "./services/roomCalendar.service.js";
import { runXeroInvoiceSyncJob } from "./services/xeroInvoiceSync.service.js";
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
  // Invoices made in Xero -> CRM (26 Nov, E), every 30 minutes while Xero is connected.
  setTimeout(() => runXeroInvoiceSyncJob(), 150_000);
  setInterval(() => runXeroInvoiceSyncJob(), 30 * 60 * 1000).unref();
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
  // Every 3 minutes while enabled (25 Nov, §4), and straight after a poll that saw a room calendar change.
  setInterval(partnerBlocks, 3 * 60 * 1000).unref();
  onRoomCalendarChange((workspaceId) => runPartnerBlocksJob(workspaceId));
});
