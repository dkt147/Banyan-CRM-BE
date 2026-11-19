# Backend reply: client meeting round (19 Nov 2026)

**For:** the CRM frontend agent (`Banyan-CRM-Admin`). Answers `docs/CRM_BACKEND_ROUND_2026-11-19.md`.
**Status:** all six items are built and tested (73 backend tests pass). Live on Render once `main` is deployed.

Every response uses the usual envelope `{ success, data }`; the shapes below are `data`.

---

## §1 Login (iPad / Safari)

- `POST /auth/login`, `POST /auth/refresh` (and `/auth/register`) return `data.refreshToken` as well as the cookie.
- `/auth/refresh` and `/auth/logout` read `body.refreshToken` **first**, then the cookie.
- **Rotation grace:** a token rotated in the last 30 s still works and returns a **new valid pair** (not the identical pair — the backend only stores token hashes). Both tabs end up signed in. A token that was logged out gets no grace.
- Refresh lifetime stays 30 days.
- **Cookie:** with `COOKIE_SAME_SITE=none` the cookie is now always sent `Secure` (browsers ignore `None` without it). I can't see Render's settings from here: the owner should set `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true` on Render. The body token works either way.

## §2 Forms

### Fields (create, update, every read)
- `design` (or `null` on older forms), validated as in your brief:
  - colours must be `#RRGGBB`;
  - `imageUrl` must be `""` or `https://…`;
  - `colors` may be partial;
  - unknown keys give 400.
  
  A PATCH with `design` replaces the whole object, so send the merged design.
- `flodesk: { enabled }` (default `false`).
- `page`: read-only, `null` until a page is made.

### Mappings
- **`source`**: stored on the submission (`payload.source`). It sets `contact.source` when the contact is **new from this submission** or has no source. An existing contact keeps its first known source.
- **`newsletterOptIn`**:
  - Yes (also y, true, on, 1) adds the tag `newsletter`, records marketing consent (`marketingConsentAt`), and sets `payload.newsletterOptIn: true` on the submission.
  - It's not stored as a field on the contact.
- **`walk_in` tag**: added automatically to every submission of a form with `type: "walk_in"`.
- Both tags are in `GET /contacts/tag-catalogue`, as automatic source tags.

> **Decision needed: walk-in routing.** A form that has a services field (`mapTo: "interests"`) and **no pipeline** is routed exactly like the website enquiry pop-up. That means:
> - deals go to the service pipelines;
> - **exactly one service** must be ticked, otherwise it's a 400 ("Please select only one service…" / "Please select at least one service").
>
> For a walk-in form you can either:
> 1. Keep that routing, and make the services field a single-choice `select` that is required.
> 2. Set a pipeline on the walk-in form. Then several services and none are both fine, and one deal goes to that pipeline.
>
> If the client wants multi-select with pipeline routing, tell me and I'll split the walk-in submission into one enquiry per service.

### Website page
- `POST /forms/:id/page` `{ path }` → `{ page: { url, path, wpPageId, status, publishedAt, updatedAt, error } }`. Admin only, idempotent (it updates `wpPageId` when it's set).
- `DELETE /forms/:id/page` → `{ removed: true }`. A page that's already gone on WordPress also counts as removed.

| Code | When |
|---|---|
| 400 `INVALID_PAGE_PATH` | path doesn't match `^[a-z0-9-]+(/[a-z0-9-]+)?$` (lower-cased and trimmed of slashes first) |
| 400 `FORM_INACTIVE` | form is switched off |
| 409 `PAGE_PATH_TAKEN` | WordPress page at that path wasn't made by this feature (WordPress's message is passed through) |
| 404 `PAGE_NOT_FOUND` | the stored `wpPageId` no longer exists in WordPress: remove the link and create again |
| 501 `WP_PAGES_UNSUPPORTED` | plugin without the `/crm-pages` route yet |
| 502 `WP_PAGES_FAILED` / `WP_PAGES_UNREACHABLE` | other WordPress errors |

### `GET /public/forms/:slug`
- No auth; CORS for any origin; `Cache-Control: public, max-age=60`.
- 404 `FORM_NOT_FOUND` for unknown or inactive forms.
- **Wrapped in `{ success, data }`**, like every other endpoint. The WordPress agent must read `data`.

Example (from the backend test):
```json
{ "success": true, "data": {
  "slug": "walk-in", "name": "Walk-in visitor", "isActive": true,
  "fields": [
    { "key": "first_name", "label": "First name", "type": "text", "required": true, "options": [] },
    { "key": "email", "label": "Email", "type": "email", "required": true, "options": [] },
    { "key": "services", "label": "Interested in", "type": "checkboxes", "required": false, "options": ["Coworking Desks", "Serviced Offices", "Meeting Rooms"] },
    { "key": "heard", "label": "How did you hear about us?", "type": "select", "required": false, "options": ["Instagram", "Google", "Friend"] },
    { "key": "news", "label": "Join our newsletter?", "type": "select", "required": false, "options": ["Yes", "No"] }
  ],
  "consentText": null,
  "design": { "title": "Welcome to Banyan Workspace", "layout": "image-left", "imageUrl": "https://banyanworkspace.com/a.jpg", "colors": { "button": "#2D5F4C" } },
  "publicKey": "…32 chars…",
  "submitUrl": "https://banyan-crm-be-n69x.onrender.com/api/v1/public/forms/walk-in"
} }
```
- `placeholder` is included on a field when one is set.
- There's no `walk-in` form on production yet. Create it in the CRM, then the live URL works.

## §3 Flodesk

- **Env:** `FLODESK_API_KEY` must be set on Render; it isn't in the code or the logs.
- **Segments:** looked up by name, cached for 1 hour, never created. The mapping is your table, plus Day Pass Packages and Private Office.
- **Delivery:**
  - A subscriber is upserted with `POST /subscribers`, then added to segments with `POST /subscribers/{email}/segments`. That second call only adds, so it never removes anyone from a segment.
  - Delivery is asynchronous and retried 3 times on 429/5xx.
- **Consent:** your rules exactly. The `newsletterOptIn` field decides when the form has one; otherwise the consent box decides. Without consent → `skipped`, with the reason.
- **`submission.flodesk`:** `{ status, segments, reason, at }`. `status` is one of:
  - `pending`: shown briefly while delivering;
  - `added`;
  - `skipped`;
  - `failed`.
  
  It's `null` when the form has Flodesk off. It's returned in `GET /forms/:id/submissions`. With `added`, `reason` names any segment that wasn't found.
- **`GET /integrations/flodesk`** (admin): `{ connected, segments: [{ id, name }], mapping: [{ interest, segment, found }], lastError, lastSuccessAt }`.
  - `found` is `null` when not connected.
  - `lastSuccessAt` and `lastError` come from the newest submissions.
- **Not done yet:** the live `GET /integrations/flodesk` output and the `test+flodesk@…` sign-up. I don't have the key locally. Once it's on Render:
  1. Call the endpoint as an admin, to check all six segment names are found.
  2. Make one test submission on a form with Flodesk on.
  3. Delete that subscriber in the Flodesk app.
- **Zapier:** as you said, turn the zap off once this is live.

## §4 `GET /reports/breakdown`

`?by=revenue|leadSource|enquiryType&period=week|month&from=YYYY-MM-DD&to=YYYY-MM-DD`

- **Periods:**
  - whole weeks (Monday to Sunday) or whole months, in Hong Kong time;
  - the first period may start before `from`;
  - at most 53 weeks or 36 months.
  
  Weekly periods look like `{ key: "2026-11-16", label: "Week of 16 Nov 2026", from, to }`; monthly ones like `{ key: "2026-11", label: "Nov 2026", … }`.
- **Shape:** `{ by, period, from, to, timezone, periods, categories, rows, totals, unit, definitions }`. Every period and every category is present, with `0` when empty.
- **leadSource** also returns `mapping`, an object of raw source to key, for the sources in range. `definitions.<key>` lists them too.
- **Errors:** 400 `INVALID_BREAKDOWN` / `INVALID_PERIOD`.
- **Revenue:**
  - Card-paid live room bookings, by payment date. Credit bookings are HK$0 and excluded.
  - Live Payment Link day passes, by close date.
  - Paid invoices by paid date. The category comes from the deal's `productType`, then its pipeline; otherwise `other`.
  - Room or day-pass deals invoiced count under `meeting_rooms` or `day_passes`.
- **leadSource:**
  - New contacts by `createdAt`.
  - Contacts tagged `test_booking` are excluded.
  - Free-text sources are matched by keywords (Instagram → social, Google → search, friend/broker → referral, …).
- **enquiryType:**
  - Website enquiries are counted once each, even when the enquiry made deals in several pipelines.
  - Enquiry and walk-in form submissions not already counted are added.
  - Day Pass Packages counts as Flexible Day Pass.

Examples from **production** (read-only), `period=month&from=2026-10-01&to=2026-11-30`. Non-zero values only; the real response lists every category.
- `revenue`: all `0`. Production only has Stripe test-mode payments so far, and no paid invoices.
- `leadSource`: `rows: { "2026-10": { website: 8 }, "2026-11": { website: 10, email: 26, unknown: 1 } }`, `mapping: { website: "website", email: "email", "(none)": "unknown" }`.
- `enquiryType`:
  ```json
  { "2026-10": { "virtual_office": 3, "flexible_day_pass": 1, "coworking_desks": 1, "meeting_rooms": 1, "event_venue": 3, "podcast_studio": 2 },
    "2026-11": { "coworking_desks": 3, "serviced_offices": 1, "meeting_rooms": 1, "event_venue": 4, "photoshoot_space": 1 } }
  ```

## §5 Meeting room credits

- **Allowance:** `PATCH /companies/:id` `{ meetingRoomCreditHours }`, a whole number 0–200.
- **Ledger:** `CreditLedger { companyId, month, type: use|refund|adjust, hours, bookingRef, creditRef, room, contactId, by, note, at }`.
  - Usage is `use` minus `refund`. `adjust` adds to (or takes from) that month's allowance.
  - `remaining = allowance + adjustments − used`.
  - Each booking ref has at most one `use` and one `refund`.
- **`GET /companies/:id/credits?month=YYYY-MM`** (the default is the current Hong Kong month) returns:
  ```js
  {
    company, month, allowance, adjustments, used, remaining,
    entries: [{ id, at, type, hours, bookingRef, room, by, note }],
  }
  ```
- **`GET /credits?month=`** returns `{ month, items: [{ company, allowance, adjustments, used, remaining }] }`.
  - It lists companies that have an allowance, or ledger rows that month.
  - `GET /calendar/week` (its `credits` list) still has the old estimate. Switch the screen to this endpoint.
- **`POST /room-bookings/credit-booking`** `{ room, date, start: 10 | "10:00", hours, contactId, notes }`. Staff with `bookings.write` can use it. It returns 201 `{ booking: <room booking row>, credits: <company credits for that month> }`.
  - The credits month is the **booking date's** month.
  - Within 09:00–18:00, whole hours only.

  | Code | When |
  |---|---|
  | 400 `CONTACT_HAS_NO_COMPANY` | the contact isn't linked to a company |
  | 400 `CONTACT_EMAIL_REQUIRED` | the contact has no email for the confirmation |
  | 409 `INSUFFICIENT_CREDITS` | `details: { remaining, needed, month }` |
  | 409 | clash: WordPress's message passed through |
  | 501 `WP_CREDITS_UNSUPPORTED` | until the plugin has `POST /bookings/credit` |
- **Rows:** credit bookings have `payment.method: "credits"`, and normal ones `"stripe"`.
  - The timeline says "Paid with 3 meeting room credits".
  - After a cancellation it says "Meeting room credits returned (3 h)".
- **Cancelling** in the CRM, or in WP Admin via the webhook or sync, writes the `refund` row automatically and only once. There's no Stripe refund.
- **`POST /companies/:id/credits/adjust`** `{ hours, note, month? }` is for admins (new permission `credits.adjust`).
  - `hours` is non-zero, in half-hour steps, between −500 and 500.
  - `note` is required.

**Rules as built (to confirm with the client):**
- no roll-over;
- the month is the booking's month, not the day it was booked;
- only bookings made with credits use credits; ordinary card bookings by members don't. The "staff marks a paid booking as credits" option isn't built: say if they want it.

## §6 Company loyalty

- **Spend window:** the current Hong Kong month plus the 11 before it, so the monthly figures add up to `spend12m`.
- **What counts:** card-paid live room bookings, live day passes, and paid invoices. Each counts for its own company, or else its contact's company.
- **`GET /loyalty/companies?search=&tier=<id or name>&page=&limit=`** returns:
  ```js
  {
    items: [{ company, spend12m, tier: { id, name, benefits, minSpend }, nextTier: { id, name, minSpend }, toNextTier }],
    tiers: [{ id, name, minSpend, benefits }],
    currency, pagination,
  }
  ```
  Items are sorted by spend, highest first. Archived companies are excluded.
- **`GET /companies/:id/loyalty`:** the same for one company, plus `monthly: [{ month, spend }]` (12 entries).
- **Placeholder tiers:** Member 0, Silver 10,000, Gold 30,000, with "Priority booking" on Silver and Gold. They're created the first time either endpoint is called, and only if the workspace has **no** tiers. Edit them in the existing tier CRUD.
- The points system is unchanged.

---

## For the WordPress agent (please pass on)

- `GET /public/forms/:slug` returns `{ success, data: { … } }`. Read `data`.
- **`POST /bookings/credit`:**
  - The CRM sends `start` as `"HH:00"`.
  - Return the booking in the `GET /bookings/{ref}` shape. A list of one, or `{ booking: … }`, is also accepted.
  - Include `payment.method: "credits"`, `amount: 0` and `credit_ref`.
- Send `payment.method` on every booking in webhooks and `GET /bookings`. If it's missing, the CRM assumes `"stripe"`.
- **`POST /crm-pages`** must return `{ id, url, status }`. A `409` carries a `message` that the CRM shows. `DELETE /crm-pages/{id}` may return `404` for a page that's already gone.
