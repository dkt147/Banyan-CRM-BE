# CRM feedback round (17 Nov 2026): backend done

**For:** the frontend agent working in `Banyan-CRM-Admin`, in reply to `CRM_FEEDBACK_BACKEND_HANDOFF.md`.
**Backend:** `Banyan-CRM-BE` `main`. After deploying, run `npm run migrate -- --apply` once. It normalises existing tags and backfills `Deal.closedAt`.

| # | Backend now | Frontend to do |
|---|---|---|
| 1 | `GET /related/contact|company/:id` → `sections.bookings.items` contains purchases in the agreed shape (`id: "deal-<id>"`, `kind: "purchase"`, `dealId`, `subtitle: "Day pass · HK$150 · Won"`, `status: "purchased"`, `date: closedAt||updatedAt`). Bookings carry `kind: "booking"`. `sections.bookings.purchasesTotal` is the purchase count. `productType` accepts `day_pass_package, event_space, photoshoot, podcast`. `PATCH /deals/:id { companyId: null }` unlinks. | Remove `usePurchases`. |
| 2 | Nothing new. | – |
| 3 | `GET /contacts/tags` → `{ tags: [{ key, count }] }` (non-archived contacts). `GET /contacts/tag-catalogue` → `{ pattern, maxPerContact: 30, tags: [{ key, group, label, description, automatic? }] }`. Tags are normalised server-side (`"Active Member"` → `active_member`) and must match `^[a-z0-9_]{1,50}$`, at most 30. `GET /contacts?tag=a,b` = has all of them. New automatic tags: `form_submission`, `test_booking` (was `test-booking`). | Optionally read the catalogue endpoint instead of the hard-coded copy. |
| 4 | `GET /reports/periodic?period=month|year&from=YYYY-MM&to=YYYY-MM` returns the agreed shape, plus `definitions` (one sentence per metric), `timezone` and `currency`. Max 120 months. Every role can read it. `Deal.closedAt` is maintained automatically and backfilled by the migration. `roomRevenue`/`roomHours` are by **booking date**, live payments only. | Drop the "Estimated" fallback once deployed. |
| 5 | `POST /forms`, `PATCH /forms/:id`, `DELETE /forms/:id` (soft delete if submissions exist → `{ deactivated: true }`), `POST /forms/:id/rotate-key`, `GET /forms/:id/submissions` (all need `forms.manage` except GET). `publicKey` is generated and can't be set by clients. `POST /public/forms/:slug` takes JSON or urlencoded (`key[]` for checkboxes). It checks `publicKey`, `Origin` against `allowedOrigins` (empty list = banyanworkspace.com and the CRM), a honeypot and a rate limit. A form with an `interests` field and no pipeline is routed exactly like `/public/enquiries`. HTML posts get **303** back to the page with `?submitted=1`, or `?form_error=<message>` on validation errors. Notification emails go through the connected Gmail account. | **Add a honeypot to the embed snippet:** `<input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">`. Optionally show `?form_error=`. |
| 6 | `POST /integrations/google/gmail/send` accepts `templateId` plus `contactId`/`companyId`/`dealId`/`bookingId`, and `html`. `{{variables}}` are filled in subject, text and HTML (HTML-escaped values, unknown keys kept). HTML goes out as `multipart/alternative`. Bodies up to 500 KB (413 above). Renewal reminders use the newest active template with `category: "renewal_reminder"` if there is one; it also gets `{{endDate}}` and `{{daysLeft}}`. Automations don't send email today, so nothing changed there. | Send `templateId` + record ids rather than pre-rendered text. Offer the `renewal_reminder` category. |
| 7 | See below. | See below. |

## 7. Google Calendar for room bookings

- `GET /room-bookings/google-calendars` → `{ calendars: { small, medium, library }, includePending, showPartnerEvents, partnerBlocks: { enabled }, pushFrom, saved, connected, lastSync, lastError }`. Before the first save, `library` defaults to the partner calendar and `saved: false`. **Nothing is pushed until the settings are saved.**
- `PUT /room-bookings/google-calendars` (`workspace.manage`) with `{ calendars, includePending, showPartnerEvents, partnerBlocks: { enabled } }`.
  - 400 `ROOM_CALENDAR_NOT_ACCESSIBLE` / `ROOM_CALENDAR_READ_ONLY` if the connected Google account can't write to a calendar.
  - If Google isn't connected, the save succeeds, the response has `connected: false`, and `warnings[]` explains it.
- `GET /room-bookings/config` → `googleCalendars: { small, medium, library }`.
- Push: paid and blocked bookings (pending if `includePending`) go to the room's calendar with no guests, `sendUpdates=none`, HK time and a deterministic event id. Cancelled, expired and moved bookings remove **only our own event**. Each write first checks the event's private `banyanSource`/`banyanRef`.
  - **No backfill:** only bookings paid after a room's calendar was saved are pushed.
  - `GET /room-bookings/google-calendars/backfill-preview` lists the older ones and writes nothing.
  - Each booking row has `googleCalendar: { calendarId, eventId, action, syncedAt, error, reason }`.
  - `POST /room-bookings/:ref/google-calendar-sync` retries one booking.
- Read-only: `PATCH`/`PUT`/`DELETE` on `/calendar-events/:id` and `/calendar/:id`, plus `/integrations/google/calendar/events/:id/sync`, return **409** "This event is in a shared room calendar and is read-only in the CRM" for room-calendar events. Imports from a room calendar set `metadata.readOnly: true` and skip our own booking events. If `showPartnerEvents` is false, room calendars aren't imported.
- **Partner events → WordPress blocks** (option 3, chosen by the client): `GET /room-bookings/partner-blocks` (status), `GET /room-bookings/partner-blocks/preview` (dry run: `create`, `remove`, `clashes` with paid/pending bookings), `POST /room-bookings/partner-blocks/sync`.
  - Applying needs `partnerBlocks.enabled` (409 `PARTNER_BLOCKS_DISABLED`) and the new WordPress endpoint in `docs/WP_PARTNER_BLOCKS_SPEC.md` (501 `WP_BLOCKS_UNSUPPORTED` until it exists).
  - A background job runs every 10 minutes when enabled.

**Frontend to do for #7:**
1. Add a "Block partner events in WordPress" toggle (`partnerBlocks.enabled`) and show `warnings`.
2. Add a "Preview backfill" list and a partner-blocks preview showing **clashes**: the double bookings the client worries about.
3. Show `googleCalendar.error` on a booking, with a retry button.
4. The meeting-room calendar IDs are still to come from the client; leave them empty for now.
