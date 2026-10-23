import app from "./app.js";
import { connectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { runMembershipRenewalJobs } from "./services/membershipRenewalJobs.service.js";
import { pollGoogleCalendars } from "./services/googleCalendarPoller.service.js";
import { pollGmailInboxes } from "./services/gmailPoller.service.js";
import { runScheduledAutomations } from "./services/automation.service.js";
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
});
