# CRM feedback round (17 Nov 2026): backend handoff

**For:** the backend agent or developer working in `Banyan-CRM-BE`.
**Frontend:** done on branch `redesign/brevo-style-guide` in `Banyan-CRM-Admin`. Each frontend feature works with today's API where it can. Where it needs something new it either falls back (and says so on screen) or shows "needs the backend update". This file lists what the backend has to add.

| # | Client feedback | Frontend (done) | Backend needed | Priority |
|---|---|---|---|---|
| 1 | Day passes should appear under the contact's **Bookings** | "Bookings & purchases" tab merges transactional deals into bookings | Return purchases from `GET /related` | Medium |
| 2 | Create a **Company** from the Contact and Deal pages | "New company" on both pages, and Company is editable on deals | Nothing (uses `POST /companies` and `PATCH companyId`) | Done |
| 3 | **Tags** differ between the contact page and the contacts list | One tag list with descriptions, multiple tags per contact, a guide | `GET /contacts/tags`, tag validation | Medium |
| 4 | **Monthly and yearly reports** | Reports page with Monthly/Yearly, 10 metrics, CSV export, browser fallback | `GET /reports/periodic`, `Deal.closedAt` | High |
| 5 | **Forms**: copy the website enquiry form | Form builder, preset copied from the website, preview, embed code | Forms CRUD and a public submit endpoint | High |
| 6 | **Templates**: how to design | Editor with variables, preview, HTML import, guide | Fill in `{{variables}}` when sending; send HTML email | Medium |
| 7 | **Google Calendar**: Library bookings into the partner calendar | Settings card on the Meeting rooms tab; room-calendar events read-only in the CRM | Room-booking → Google Calendar push, plus safety guards | High |
| – | Automations, invoices | No change (the client will come back to these) | – | Later |

---

## 1. Purchases in "Bookings & purchases" (`GET /related/:type/:id`)

**Now:** the frontend calls `GET /deals?contactId=…&limit=100` (or `companyId`) and merges deals where `productType ∈ {day_pass, day_pass_package, transactional, meeting_room, venue_hire, studio, event_space, photoshoot, podcast}`, or where the deal's pipeline key is `transactional`, into the bookings tab. See `src/components/RelatedRecords.jsx` → `usePurchases`.

**Please:** in `src/services/related.service.js`, add those deals to the `bookings` section for `contact` and `company`, in the same shape the frontend uses:

```js
{ id: `deal-${d._id}`, kind: "purchase", dealId: String(d._id), title: d.title,
  subtitle: "Day pass · HK$150 · Won", status: d.status === "won" ? "purchased" : d.status,
  date: d.closedAt || d.updatedAt }
```

The frontend skips items whose `id` it already has, so after this change you can remove `usePurchases`. Also consider adding paid invoices and memberships here later. The client asked for "every transactional product purchased in one place".

Also: `deal.validators.js` `productTypes` doesn't include `day_pass_package`, but `publicEnquiry.service.js` creates deals with it. Add it to the enum, plus `event_space`, `photoshoot` and `podcast` if those are used.

## 2. New company from Contact and Deal pages

No backend work. The frontend uses `POST /companies` (`createCompanySchema`), then `PATCH /contacts/:id { companyId }` or `PATCH /deals/:id { companyId }`. On the deal page, the deal's contact also gets the new company if it had none. Please just confirm `PATCH /deals/:id` accepts `companyId: null` to unlink. It should, via `updateDealSchema`.

## 3. One tag list

**Cause of the client's confusion:** the contact page offered only the 7 staff tags (and saving replaced *all* tags with one), while the list showed whatever is stored. That includes the automatic tags added by the backend: `website_enquiry`, `website_booking`, `room_booking`, `email_lead` and `whatsapp_lead`.

**Frontend now:** `src/utils/contactTags.js` is the single catalogue.
- **Segments** (set by staff): `prospect, active_member, past_member, event_client, broker_agent, ngo, vip`.
- **Sources** (added automatically): `website_enquiry, website_booking, room_booking, email_lead, whatsapp_lead`.
- Staff can add custom tags as snake_case keys. The contact page saves the full `tags` array.

**Please:**
1. `GET /contacts/tags` returns `{ tags: [{ key, count }] }`: the distinct tags used in the workspace, with counts. It will feed the filter so old or custom tags can be found.
2. Validate tags on create and update: lowercase `^[a-z0-9_]{1,50}$`, at most 30 per contact. Normalise legacy values with a one-off migration (lowercase, spaces → `_`).
3. If any backend code adds a new automatic tag, add it to `contactTags.js` too (or expose the catalogue at `GET /contacts/tag-catalogue` and the frontend will read it).
4. Optional: let the contacts list filter take several tags (`tag=a,b` → `$all`).

## 4. Reports: `GET /reports/periodic`

**Frontend now:** `src/pages/Reports.jsx` calls this endpoint first. On 404 it calculates the figures in the browser from at most 500 records of each kind and shows an "Estimated" notice.

```
GET /api/v1/reports/periodic?period=month&from=2022-01&to=2026-12
→ { success: true, data: { periods: [ {
    key: "2026-11",          // YYYY-MM, Hong Kong time
    revenue: 12345,          // paid invoices, sum(total), by paidAt
    roomRevenue: 1740,       // WordPress room bookings, status paid, payment.mode = live only (HKD major units)
    roomHours: 3,            // paid room booking hours (live only)
    bookings: 12,            // Booking rows starting in the month, status not cancelled/expired
    dayPasses: 4,            // won deals with productType day_pass | day_pass_package, by closedAt
    newContacts: 20,         // contacts createdAt
    newDeals: 9,             // deals createdAt
    dealsWon: 3, dealsWonValue: 45000, dealsLost: 1   // by closedAt
} ] } }
```

- Use one `$facet` or a few `$group` aggregations, all with `timezone: "Asia/Hong_Kong"`.
- Return every month in `from..to`, with zeros where there's no data. The frontend builds the yearly view by summing months.
- Require auth. Every role can view.
- **Add `Deal.closedAt`**: set it when `status` changes to `won` or `lost`, and clear it when the deal is reopened. Backfill it from `stageChangedAt || updatedAt` for existing won and lost deals. The browser fallback uses `stageChangedAt || updatedAt` today.

## 5. Forms: create/edit and public submissions

**Frontend now:** `src/pages/Forms.jsx` has a builder. "Copy website enquiry form" fills in the same fields as banyanworkspace.com/contact-us:
- "Interested in" checkboxes: Virtual Office, Flexible Day Pass, Coworking Desks, Serviced Offices, Meeting Rooms, Event Venue, Photoshoot Space, Podcast Studio;
- first name*, last name*, email*, phone, additional notes.

It calls `POST /forms`, `PATCH /forms/:id` and `DELETE /forms/:id`. `forms.routes.js` is read-only today, so these return 404 and the UI says the backend update is needed.

**Payload sent by the frontend:**

```js
{ name, slug, type: "enquiry"|"contact"|"walk_in"|"newsletter", description,
  fields: [{ key, label, type: "text"|"email"|"tel"|"textarea"|"checkboxes"|"select",
             mapTo: null|"firstName"|"lastName"|"email"|"phone"|"company"|"interests"|"notes",
             required: boolean, options: string[] }],
  consentText, tagsToApply: string[], pipelineId|null, stageId|null, createTask: boolean,
  notifyEmails: string[], allowedOrigins: string[], isActive: boolean }
```

**Please:**
1. Add `POST /forms`, `PATCH /forms/:id` and `DELETE /forms/:id` behind a new permission, **`forms.manage`** (admin). The frontend already has it in `src/utils/permissions.js`.
   - Validate with zod: unique slug per workspace; at least one field mapped to `email` or `phone`; options required for `checkboxes`/`select`; unique field keys.
   - Generate `publicKey` (random, 24+ characters) on create and never let clients set it. Return it in GET.
   - DELETE should be a soft delete (`isActive: false`) if submissions exist.
2. Add a public submission endpoint: **`POST /api/v1/public/forms/:slug`**. Accept JSON and `application/x-www-form-urlencoded`; the embed snippet posts a normal HTML form with `field[]` for checkboxes.
   - Check `publicKey` and that `Origin` is in `allowedOrigins`. Rate-limit it like `/public-enquiries`. Add a honeypot field.
   - Validate against the form's `fields` (required, email format, allowed options).
   - Store a `FormSubmission` record.
   - Find or create the contact by email, then phone (`contactMatching.service.js`), map the `mapTo` fields, and add `tagsToApply`.
   - Record consent (`marketingConsentAt` and `consentSource: form.slug`) when consent is ticked.
   - Create a deal in `pipelineId`/`stageId` if set. **If the form has an `interests` field and no pipeline, route it the way `publicEnquiry.service.js` already does** (`SERVICE_ROUTING`), so the copied enquiry form behaves exactly like today's website form.
   - Create a task if `createTask` is set, email `notifyEmails`, and add a timeline activity.
   - For a plain HTML post, redirect back to `Referer` with `?submitted=1`; return JSON for JSON requests.
3. Optionally seed a "Website enquiry" form record that matches the current `/public-enquiries` behaviour, so it appears in the list.

## 6. Templates: variables and HTML

**Frontend now:** `src/pages/Templates.jsx`:
- staff write subject and body with `{{variable}}` placeholders (buttons insert them), or import an `.html` file exported from Brevo, Mailchimp or Canva;
- the preview fills in sample data and renders HTML in a sandboxed iframe;
- `variables` is saved as the list of placeholders actually used.

Supported variables: `firstName, lastName, fullName, email, companyName, dealTitle, bookingDate, bookingTime, roomName, staffName, staffEmail`.

**Please:**
1. **Fill in variables when sending** (Gmail send, automations, renewal jobs). Add a `renderTemplate(template, { contact, company, deal, booking, user })` helper that replaces `{{key}}` and leaves unknown keys as they are. Dates should be in Hong Kong time, formatted like "Fri, 13 Nov 2026".
2. **Send HTML properly.** `googleIntegration.controller.js` (line ~114) and `membershipRenewalJobs.service.js` send `text/plain` only. When the body is HTML, send `multipart/alternative` with a text version (strip tags) plus the HTML part.
3. Allow bodies up to about 500 KB. The frontend blocks larger imports. Don't run scripts; the content is stored and sent as given.

## 7. Google Calendar for room bookings

**What the client asked for:**
- Put **Library** bookings on `c_682acafdb6beb189d861f1a728b9c5bff9bf1d584e82cbf9d44f602ebecd952b@group.calendar.google.com`.
- Meeting room bookings go to **another calendar**. Its ID is still to come from the client, so ask for it.
- **Never change existing meetings or delete test events** (it's a shared calendar with a partner).
- **No invitations.**
- Hong Kong time.

**Frontend now:**
- `src/roomBooking/RoomCalendarSettings.jsx` (Meeting rooms tab) reads and saves the room → calendar mapping. It defaults the Library to the ID above and shows the rules.
- `src/pages/Calendar.jsx` hides Edit/Cancel for any calendar event whose `metadata.googleCalendarId` is a room calendar, and shows "Read-only".

**Please:**
1. **Settings API**, stored in the workspace's Google Calendar `Integration.config.roomCalendars`, or a `wordpress` integration:
   - `GET /room-bookings/google-calendars` → `{ calendars: { small, medium, library }, includePending: false, showPartnerEvents: true, connected: boolean, lastSync: ISO|null }`.
   - `PUT /room-bookings/google-calendars`, same body without `connected`/`lastSync`, requiring `workspace.manage`.
   - Validate IDs with `^[^\s@]+@(group\.calendar\.google\.com|…)$`.
   - On save, check the connected Google account can write to each calendar (`GET calendars/{id}` with the OAuth token). Return a clear 400 if not.
   - Also add `googleCalendars: { small, medium, library }` to `GET /room-bookings/config`. The calendar's read-only check uses it.
2. **Push bookings** from `upsertWpBooking` in `wpRoomBooking.service.js` (webhook and sync), asynchronously and never blocking the webhook response:
   - **paid** → `events.insert` on the room's calendar:
     - `?sendUpdates=none`, **no `attendees`**, `start/end.dateTime = start_iso/end_iso`, `timeZone: "Asia/Hong_Kong"`.
     - `summary: "<Room> – <First Last> (<BNY-REF>)"`; for blocked bookings, `"<Room> – Blocked: <notes>"`.
     - `description`: ref, email, phone, notes, and "Created by Banyan CRM, don't edit".
     - `extendedProperties.private = { banyanRef: ref, banyanSource: "crm-room-booking" }`.
     - **A deterministic event id**: Google allows only the characters `a-v` and `0-9`, so use `"b" + Buffer.from(ref).toString("hex")` (for example `BNY-7K3Q9P` → `b424e592d…`). A retry then gets 409 instead of making a duplicate. On 409, patch that event (it's ours).
     - Save the `googleEventId` on the Booking (`metadata.wp.googleEventId`).
   - **pending** → the same, but only if `includePending`. Use `transparency: "opaque"` and the summary prefix "Awaiting payment –".
   - **cancelled / expired / error** → delete the event **only if** `extendedProperties.private.banyanSource === "crm-room-booking"` **and** `banyanRef === ref`. GET the event and check before deleting.
   - Room or date changed → patch our own event the same way, after the same check.
   - Blocked (admin) bookings → add them too, so the partner sees the time as taken.
3. **Safety guards. This is the client's main concern:**
   - Never call `events.update`, `patch` or `delete` on an event without the `banyanSource` private property. Put that check in one helper and use it for every write.
   - The existing two-way Google Calendar sync (`GOOGLE_CALENDAR_ID`/`GOOGLE_CALENDAR_IDS`, `googleCalendarPoller.service.js`, `/integrations/google/calendar/events/:id/sync`, `removeEvent` in the calendar UI) must **refuse to write** to any room calendar. Return 409 "This event is in a shared room calendar and is read-only in the CRM". If a room calendar is added to `GOOGLE_CALENDAR_IDS` to *show* partner events, import them as read-only `CalendarEvent`s (`metadata.googleCalendarId` set, `metadata.readOnly: true`).
   - Never add attendees. Always use `sendUpdates=none`.
   - **No automatic backfill into the partner calendar.** Only push bookings paid *after* the setting is saved, or offer a dry-run "Preview backfill" that lists what would be added. The partner may already have entered some of these bookings by hand, so a backfill would create duplicates.
4. **Partner meetings and double bookings.** Events the partner adds directly in the Library calendar are **not** known to WordPress, which is the source of truth for availability. So a website customer could book a slot the partner already uses. Options, in order of preference:
   1. The partner blocks time in WP Admin → Room Bookings → Block time (no code).
   2. The CRM reads busy times from the room calendars (`freeBusy`) and shows clashes on the Meeting rooms tab (warning only).
   3. A WordPress plugin addition (`POST /blocks`, token-protected) so the CRM can turn partner events into WordPress blocks automatically. This needs the WP plugin maintainer (see `CRM_BOOKING_FRONTEND_AND_API_SPEC.md` §8).

   Please agree the option with the client before building 2 or 3.
5. The OAuth scope already includes Calendar (`/integrations/google/connect`). The connected Google account must have **"Make changes to events"** on both calendars. The client has to share them with that account.

## 8. Test checklist

- [ ] Contact with a won "Flexible Day Pass" deal shows it under Bookings & purchases, with a link to the deal.
- [ ] New company from a contact and from a deal creates it once and links it; the deal's contact gets it if it had none.
- [ ] `GET /contacts/tags` lists system tags with counts; tags outside the pattern are rejected.
- [ ] `/reports/periodic` totals for a month match the bookings/deals/invoices lists for that month (HK time boundaries).
- [ ] Copy website enquiry form → save → embed snippet posted from banyanworkspace.com creates a contact, deal and task exactly like `/public-enquiries`. A wrong origin gets 403.
- [ ] A template with `{{firstName}}` and imported HTML is sent as multipart and renders in Gmail with the name filled in.
- [ ] Paid Library booking → event in the partner calendar, HK time, no guests, nobody emailed. Cancel in WP → only that event is removed.
- [ ] A partner event and a test event in the same calendar are never changed or deleted. Trying to edit one through the CRM API returns 409.
- [ ] Resending the same webhook doesn't create a second event.
