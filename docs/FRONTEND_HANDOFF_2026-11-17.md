# Frontend handoff: backend changes live on 17 Nov 2026

**For:** the Claude agent working on `Banyan-CRM-Admin` (branch `redesign/brevo-style-guide`).
**Backend:** `Banyan-CRM-BE` `main`, live at `https://banyan-crm-be-n69x.onrender.com/api/v1`. WordPress plugin 1.1.1 is live too.
**This file supersedes** `CRM_FEEDBACK_BACKEND_DONE.md`, which lists every endpoint in detail; use it as the API reference.

Everything below is built, deployed and tested on the backend. What's left is frontend work, in priority order. Each item names the file it touches, as found in your repo on 12 Nov.

---

## P1: needed for the client's Library calendar setup (client is about to do this)

### 1. Room calendar settings: `src/roomBooking/RoomCalendarSettings.jsx`

`GET /room-bookings/google-calendars` returns:
```js
{ calendars: { small, medium, library }, includePending, showPartnerEvents,
  partnerBlocks: { enabled }, pushFrom: { small, medium, library },  // ISO; pushes start here
  saved, connected, lastSync, lastError }
```
`PUT` sends the same body, without the read-only fields. The response is the same shape plus `warnings: string[]`.

Add:
- **A "Block partner events in WordPress" toggle** → `partnerBlocks: { enabled }`. Explain it: "Meetings your partner adds in the room calendar block that time on the website within about 10 minutes."
- **Show `warnings`** after saving. One example: "Google Calendar isn't connected …".
- **Show `connected: false`** with a link to Settings → Integrations → Google.
- **Show 400 errors as they are:**
  - `ROOM_CALENDAR_NOT_ACCESSIBLE`: the calendar isn't shared with the connected account.
  - `ROOM_CALENDAR_READ_ONLY`: it's shared, but without "Make changes to events".
  - `INVALID_CALENDAR_ID`.
- **"Adding bookings since {pushFrom.library}"** under each room. The backend never backfills.
- **"Preview older bookings" button** → `GET /room-bookings/google-calendars/backfill-preview` → `{ dryRun: true, note, items: [{ ref, roomKey, calendarId, status, summary, startAt, endAt }] }`. Read-only list; show the `note`. No "add all" button: the client doesn't want backfill.
- `lastError`, if set, in red.

### 2. Partner blocks panel (new, on the Meeting rooms tab, next to the settings)

- `GET /room-bookings/partner-blocks`:
  ```js
  { enabled, supported /* true | false | null (not tried yet) */, blocks /* count */,
    clashes: [{ ref, status, room, date, partnerEventId, partnerEvent }],
    blockConflicts: [{ room, date, start, hours, reason, conflicts: ["BNY-…"], message }],
    lastRun, lastError }
  ```
- **Preview** button → `GET /room-bookings/partner-blocks/preview`:
  ```js
  { dryRun: true, create: [{ room, date, start, hours, reason }], remove: [{ ref, room, date, start, hours }],
    unchanged, clashes, skipped: [{ calendarId, reason }] }
  ```
- **Sync now** button (admin only, `workspace.manage`) → `POST /room-bookings/partner-blocks/sync`. It returns the preview shape plus `errors` and `blockConflicts`. Errors to handle:
  - 409 `PARTNER_BLOCKS_DISABLED`: point to the toggle.
  - 409 `INTEGRATION_NOT_CONNECTED`.
  - 501 `WP_BLOCKS_UNSUPPORTED`.
- **Show clashes prominently.** `blockConflicts` and `clashes` are partner meetings that overlap a paid booking or hold: real double bookings that a person must fix. Link each `BNY-…` ref to the booking side panel.
- It runs by itself every 10 minutes when enabled. Show `lastRun` as "Last checked 4 min ago".

### 3. Booking rows and side panel: `RoomBookingPanel.jsx`, bookings list, calendar

Rows from `GET /room-bookings` and `GET /room-bookings/:ref` have new fields:
- `partnerBlock: boolean` and `externalId`: a block made from a partner calendar event. Label it **"Partner (calendar)"**; `customer.notes` starts with `Partner: <meeting title>`.
- `googleCalendar: { calendarId, eventId, action, syncedAt, error, reason } | null`. In the side panel:
  - "In Library calendar" when `eventId` is set;
  - the `error` in red, with a **Retry** button → `POST /room-bookings/:ref/google-calendar-sync`.

### 4. Shared calendar events read-only: `src/pages/Calendar.jsx`

- Room-calendar events imported from Google have **`metadata.readOnly: true`**. Use that as well as your `googleCalendarId` check.
- The backend returns **409** "This event is in a shared room calendar and is read-only in the CRM" on PATCH/PUT/DELETE and on `/integrations/google/calendar/events/:id/sync`. Show that message if it happens.
- The CRM's own booking events are no longer imported from room calendars, so they don't appear twice.

---

## P2: switch the booking modal to the backend checkout

### 5. `src/roomBooking/RoomBookingModal.jsx`

**Now (line ~203):** `wpApi(C, "checkout", …)` from the browser, plus prefixing the notes and parsing the session ID from the URL.

**Change to:**
```js
const j = await request("/room-bookings/checkout", { method: "POST", body: {
  room, date, start, hours, first_name, last_name, email, phone,
  notes: d.notes.trim(),          // plain notes: the server adds "Booked via CRM by <staff>"
} });
// j = { url, ref, session_id }   → use j.session_id, drop sessionIdFromUrl()
```
- Why: the server sends the API token, so staff are **not** limited to 12 checkouts per 10 minutes, and the notes prefix can't be wrong or missing.
- `notesRoom`: allow `1000 - ("Booked via CRM by ".length + staffName.length + 3)` characters. `config.notesPrefix` is still in `GET /room-bookings/config`.
- **Errors keep WordPress's status and message:**
  - 400: show it;
  - **409**: back to step 1, reload `/availability`, clear the selection, show the message (same as before);
  - 429 / 502 / 503: show it.
- **Keep** `GET /availability` and `GET /session` polling from the browser (`wpApi`), as now.
- After `paid` (line ~256), call `request("/room-bookings/sync", { method: "POST", body: { ref: checkout.ref } })` instead of `{ from, to }`.
- The backend already syncs the pending hold right after checkout, so it shows in the list at once.

---

## P3: feedback items from your 17 Nov handoff

| # | File | Change |
|---|---|---|
| 1 | `src/components/RelatedRecords.jsx` | Remove `usePurchases` (line ~72). Purchases now come from `GET /related` with `kind: "purchase"`, `id: "deal-<id>"` and `dealId`. Bookings have `kind: "booking"`. |
| 3 | `src/utils/contactTags.js` + contacts list | Read `GET /contacts/tag-catalogue` → `{ pattern, maxPerContact, tags: [{ key, group, label, description, automatic }] }` (or keep your copy; it matches, plus `form_submission` and `test_booking`). The filter list comes from `GET /contacts/tags` → `{ tags: [{ key, count }] }`. Several tags: `?tag=a,b`. |
| 4 | `src/pages/Reports.jsx` | Remove the browser fallback and the "Estimated" notice. Use `data.definitions[metric]` as tooltips. 400 means a bad `from`/`to` (`YYYY-MM`, at most 120 months). |
| 5 | `src/pages/Forms.jsx` | **Embed snippet (line ~268): add a honeypot** `<input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">`. Add a **Submissions** tab → `GET /forms/:id/submissions` (`status`: processed/failed/spam). Add **Regenerate key** → `POST /forms/:id/rotate-key`, with a warning that existing embeds stop working. On the embed page, after a plain HTML post, the visitor returns with `?submitted=1` or `?form_error=<message>`; mention this in the embed guide. DELETE may return `{ deactivated: true }` (soft delete when submissions exist). |
| 6 | `src/pages/Templates.jsx` + email composer | Send with `POST /integrations/google/gmail/send` `{ to, templateId, contactId?, companyId?, dealId?, bookingId? }`; the server fills `{{variables}}` and sends HTML as multipart. You can also send `html` directly. Add category **`renewal_reminder`**: renewal emails use the newest active one, with extra variables `{{endDate}}` and `{{daysLeft}}`. Body limit 500 KB (413 above). |
| – | Meeting rooms header | `GET /room-bookings/config` has `lastSync: { at, mode, created, updated, failed, error }` and `syncIntervalMinutes` (2). Show "Synced 1 min ago" or the error. |

---

## Test checklist (live)

- [ ] Settings: save the Library calendar while it isn't shared → clear 400 message. After sharing → saved, `connected: true`.
- [ ] Toggle partner blocks → Preview lists a test partner meeting → Sync → block visible in WP Admin as "partner (CRM sync)" and in the CRM list as "Partner (calendar)".
- [ ] A partner meeting over a paid booking shows as a clash with the `BNY-` ref.
- [ ] New booking from the modal works through `/room-bookings/checkout`. The note in WP Admin reads "Booked via CRM by <you> – …". There's no 429 after more than 12 test checkouts.
- [ ] Editing a room-calendar event in the CRM calendar is blocked with the read-only message.
- [ ] Contact with a won day pass shows it once under Bookings & purchases (no duplicate after removing `usePurchases`).
- [ ] Reports show without the "Estimated" notice.
- [ ] Embed snippet includes the honeypot; a test post from banyanworkspace.com lands back on the page with `?submitted=1`.

## Known limits

- **Render free tier sleeps** after about 15 minutes idle. Background jobs (2-minute WordPress sync, 10-minute partner blocks) pause until a request wakes the server, and the first request after sleep can take about 30 seconds. Don't treat a slow first load as an error; consider a longer timeout or a "Waking server…" message.
- Cancel or refund from the CRM isn't available yet (WordPress §4e is not built). Keep "Cancel in WP Admin" wording.
- Meeting-room calendar IDs are still to come from the client. Leave those fields empty; only the Library is set up.
