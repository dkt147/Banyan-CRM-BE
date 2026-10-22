import { Integration } from "../models/Integration.js";
import { CalendarEvent } from "../models/CalendarEvent.js";
import { getProviderAccessToken, providerJson } from "./providerApi.service.js";

let running = false;
function eventsUrl(calendarId, timeMin, timeMax, pageToken) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("timeMin", timeMin.toISOString()); url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true"); url.searchParams.set("orderBy", "startTime"); url.searchParams.set("showDeleted", "true"); url.searchParams.set("maxResults", "2500");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return url.toString();
}
export async function pollGoogleCalendars() {
  if (running) return;
  running = true;
  try {
    const integrations = await Integration.find({ provider: "google_calendar", status: "connected" }).select("workspaceId").lean();
    for (const integration of integrations) {
      try {
        const token = await getProviderAccessToken(integration.workspaceId, "google_calendar");
        const ids = [...new Set(String(process.env.GOOGLE_CALENDAR_IDS || process.env.GOOGLE_CALENDAR_ID || "primary").split(",").map((x) => x.trim()).filter(Boolean))];
        const timeMin = new Date(Date.now() - 30 * 86400000); const timeMax = new Date(Date.now() + 180 * 86400000);
        for (const calendarId of ids) {
          let pageToken = null; let pages = 0;
          do {
            const result = await providerJson(eventsUrl(calendarId, timeMin, timeMax, pageToken), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, "Google Calendar background sync");
            for (const external of result.items || []) {
              if (!external.id) continue;
              const filter = { workspaceId: integration.workspaceId, externalProvider: "google_calendar", externalEventId: external.id };
              if (external.status === "cancelled") {
                await CalendarEvent.updateOne(filter, { $set: { status: "cancelled", "metadata.googleEventStatus": "cancelled", "metadata.googleSyncedAt": new Date() } });
                continue;
              }
              const start = external.start?.dateTime || (external.start?.date ? `${external.start.date}T00:00:00.000Z` : null);
              const end = external.end?.dateTime || (external.end?.date ? `${external.end.date}T00:00:00.000Z` : null);
              const startAt = start ? new Date(start) : null; const endAt = end ? new Date(end) : null;
              if (!startAt || !endAt || !Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) continue;
              await CalendarEvent.findOneAndUpdate(filter, { $set: { title: String(external.summary || "(No title)").slice(0, 250), type: "meeting", startAt, endAt, timezone: external.start?.timeZone || process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Hong_Kong", location: String(external.location || "").slice(0, 1000), status: "scheduled", notes: String(external.description || "").slice(0, 10000), externalProvider: "google_calendar", externalEventId: external.id, metadata: { googleCalendarId: calendarId, googleEventHtmlLink: external.htmlLink || "", googleEventStatus: external.status || "confirmed", googleUpdatedAt: external.updated || null, googleSyncedAt: new Date(), googleAllDay: Boolean(external.start?.date) } }, $setOnInsert: { workspaceId: integration.workspaceId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
            }
            pageToken = result.nextPageToken || null; pages += 1;
          } while (pageToken && pages < 10);
        }
        await Integration.updateOne({ workspaceId: integration.workspaceId, provider: "google_calendar" }, { $set: { lastSyncedAt: new Date() } });
      } catch (error) { console.error("[google-calendar-poller] workspace sync failed:", error.message); }
    }
  } catch (error) { console.error("[google-calendar-poller] failed:", error.message); }
  finally { running = false; }
}
