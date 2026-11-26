# Backend reply: round 27 Nov (b): Eventbrite, WhatsApp, stage tasks, booking check

**For:** the CRM frontend team, and the owner, who adds the settings on Render.
**From:** the backend, answering `CRM_BACKEND_ROUND_2026-11-27b.md`.

**Status:**
- A, B and C are built, and 97 tests pass. They're live once this backend is pushed and Render has deployed; the commit hash is in the user's message.
- D was investigated read-only. I didn't create, change or cancel anything, and fixed nothing.
- No token or secret appears in code, docs or logs.

## Settings the owner must add on Render (names only)

| Name | Needed for | Notes |
|---|---|---|
| `EVENTBRITE_PRIVATE_TOKEN` | A | Required for anything Eventbrite. |
| `EVENTBRITE_ORGANIZATION_ID` | A | Optional. Empty means the token's first organisation. |
| `EVENTBRITE_WEBHOOK_SECRET` | A | A long random string, part of the webhook URL. |
| `PUBLIC_API_URL` | A | Probably already set (forms use it). The webhook URL is built from it. |
| `WHATSAPP_ACCESS_TOKEN` | B | |
| `WHATSAPP_PHONE_NUMBER_ID` | B | |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | B | |
| `WHATSAPP_VERIFY_TOKEN` | B | Used once, when Meta verifies the webhook. |
| `META_APP_SECRET` | B | **Needed for inbound messages.** The webhook checks Meta's signature with it and answers 503 without it. |
| `WHATSAPP_WORKSPACE_ID` | B | Optional fallback when no WhatsApp integration record names the phone number. |

## Commands

1. **Migration.** It sets `followUp` on the existing stages and creates the Event and EventRegistration indexes:
   ```
   npm run migrate              # dry run: shows what it would do
   npm run migrate -- --apply
   ```
   The automation already treats a stage without `followUp` as the migration would ("Quote sent" on, 3 days; others off), so nothing breaks if the migration runs late.
2. **First Eventbrite sync and webhook,** once the settings are in and Render has redeployed. As an admin:
   - `POST /api/v1/integrations/eventbrite/sync` runs the full sync. On its first success it also registers the webhook, if `EVENTBRITE_WEBHOOK_SECRET` and `PUBLIC_API_URL` are set.
   - `POST /api/v1/integrations/eventbrite/webhook` registers or reuses the webhook on its own.
   - `GET /api/v1/integrations/eventbrite` shows `connected`, `webhookActive`, `lastSync` and `lastError`.

   The job also runs by itself 2 minutes after each start and then every 30 minutes.
3. **WhatsApp:** in Meta's app settings, set the webhook URL to `<public API base>/api/v1/webhooks/whatsapp`, with the verify token from `WHATSAPP_VERIFY_TOKEN`. Then check `GET /api/v1/integrations/whatsapp/status`.

## Shape changes from the brief

### All parts
- **Paths are under `/api/v1/`** (e.g. `/api/v1/webhooks/eventbrite/:secret`, `/api/v1/integrations/eventbrite`), like every other route. The brief wrote `/api/…`.

### A. Eventbrite
- **Activity fields:** the "event" activities keep `entityType: "contact"` inside `metadata` (`metadata: { entityType, eventId, registrationId, source }`), because the Activity model has no `entityType` field. They show in `/related` → activities.
- **Sync state** is kept on the `Integration` record (`provider: "eventbrite"`, a new allowed value) under `config`: `lastSyncAt`, `lastSync`, `lastError`, `webhookId`, `organizationId` and `organizationName`.
- **Status route extras:** `GET /integrations/eventbrite` also returns `syncRunning`.
- **Registration filter:** `status` on `/event-registrations` also accepts a comma list (`attending,checked_in`). An unknown status gives `400 VALIDATION_ERROR`.
- **Event sort:** `/events` sorts by `startAt`. The default order is ascending for `when=upcoming` and descending otherwise. Pass `order=asc|desc` to override.
- **Event statuses:** events in any Eventbrite status are stored, drafts included. The list shows all of them; filter on `status` in the frontend if needed.
- **Webhook replies:**
  - a wrong secret gives `404`;
  - an `api_url` on another host, or a repeat delivery, gets `200` with `data.ignored: "ignored" | "duplicate"`;
  - everything else gets `200`, and the work runs after the reply.

### B. WhatsApp
- **Status route extras:** `webhookVerifiedAt` (when the last verified webhook call arrived), alongside `webhookVerified`. The status also counts verification handshakes.
- **Send response:** now includes `conversationId`.
- **Activity:** the "WhatsApp sent: …" activity has `type: "whatsapp_sent"`.
- **Stored text:** if a template's body can't be read from Meta, the stored text is `[Template: <name>] <params>`.
- **`template.language`:** must look like `en` or `zh_HK`; otherwise `400 INVALID_WHATSAPP_TEMPLATE`.
- **Permission:** sending now requires `records.write`, as the brief says. Read-only users get 403.

### C. Stage follow-ups
- **Stage lists** always return the `followUp` the automation will use: the stored one, or the default for stages not migrated yet.

## A. Eventbrite (built)

- **Models:** `Event` and `EventRegistration`, as specified, with the indexes listed and a unique `externalId` per workspace and source.
- **Sync:**
  - one run at a time; an admin sync while a run is going gives `409 SYNC_RUNNING`;
  - events from 1 Jan 2026 onwards, plus all future ones;
  - attendees per event, with `changed_since` (last sync minus 1 hour) on later runs;
  - it backs off on 429, using `Retry-After` when Eventbrite sends it.
- **Contacts (by email only):**
  - **No match:** a contact is created with `source "Eventbrite"` and the `eventbrite` tag, and the registration gets `contactCreated: true`.
  - **Match:** only empty phone and job title are filled, and the tag is added; nothing is overwritten. Archived contacts count as a match and stay archived.
  - **Not set:** marketing consent.
  - **Company:** only linked when `profile.company` exactly matches an existing company and the contact has none. No companies are created.
  - **No email:** the registration is saved with `contactId: null`.
- **Activities:** written only when a registration is new or its status changes:
  - "Signed up for <event> (<ticket>)";
  - "Checked in at <event>";
  - "Cancelled <event>" or "Refunded <event>".
- **Counts:** `registrationCount` (attending and checked in) and `checkedInCount` are updated after each sync and webhook.
- **Tag:** the `eventbrite` source tag is in `TAG_CATALOGUE`. It's added to each workspace's ContactTag list automatically the next time the server starts.
- **Writes to Eventbrite:** the only one is creating the webhook. An existing webhook for the same URL is reused.

## B. WhatsApp (built)

- **Status route:** `GET /integrations/whatsapp/status` (admin) returns `configured`, `displayPhoneNumber`, `verifiedName`, `qualityRating`, `webhookVerified`, `lastInboundAt`, `templates[{ name, language, category, status, body, paramCount }]` and `error`.
  - It's cached for 5 minutes; `?fresh=true` bypasses the cache.
  - With no settings it returns `200 { configured: false, error: "Not set on the server: …" }`, listing the missing names.
- **Templates:** `POST /integrations/whatsapp/messages` accepts `{ to, contactId?, template: { name, language, params } }`.
  - The name must match `^[a-z0-9_]{1,512}$`; at most 10 params, each 1–1024 characters.
  - The Message stores the template body with `{{n}}` filled in.
- **`contactId` without a `conversationId`:**
  - the message goes into the existing WhatsApp thread for that number, so replies join it, or the contact's thread, or a new one with `participantAddress` set to the digits;
  - it's saved as an outbound Message, and the activity "WhatsApp sent: <first 80 characters>" is added.
- **Errors:**

  | Meta error | CRM response |
  |---|---|
  | 131047 (24-hour window closed) | `409 WHATSAPP_WINDOW_CLOSED`, with the message from the brief |
  | 131026 (not on WhatsApp) | `422 WHATSAPP_NOT_ON_WHATSAPP` |
  | anything else | `502 WHATSAPP_API_ERROR`, with Meta's message (never the token) |

- **Inbound:**
  - Messages are matched to a contact by the stored normalised digits, and by phone or WhatsApp, with and without the 852 prefix. Meta sends `852XXXXXXXX`, which now matches a contact saved as `9123 4567`.
  - `whatsapp_lead` contacts are still created as before.
  - A verified webhook handshake is recorded for `webhookVerified`.

## C. Follow-up task per stage (built)

- **Model:** `PipelineStage.followUp = { enabled, dueInDays (0–60), title (≤150) }`.
- **Routes:** it's accepted on `POST /pipelines/:id/stages` and `PATCH /pipelines/stages/:id`, and a bad value gives `400 INVALID_FOLLOW_UP`.
- **Automation:**
  - It creates one task, only when the stage's follow-up is on.
  - Title: `followUp.title` with `{deal}` filled in, or "Follow up: <deal> — <stage>" when the title is empty.
  - Due: `dueInDays` days later at 10:00 HK. With 0 days, today at the next full hour, or 18:00 HK if that's later.
  - The separate hard-coded "Quote follow-up" task is gone.
  - The "Deal moved to …" notification says "A follow-up task was created." only when one was.
- **Migration** `20261127b-stage-followups` (idempotent): stages whose name contains "quote sent" get on / 3 days / "Quote follow-up: {deal}"; every other stage gets off. Only stages without `followUp` are touched.

## D. Room booking flow: findings (read-only)

What I checked:
- the production database: bookings cache, AuditLog, WebhookEvent and Integration records;
- WordPress's `GET /bookings` (the token list the sync uses), month by month from 60 days back to 95 days ahead;
- the live API health endpoint;
- one unsigned, empty POST to the CRM's own booking webhook. It was rejected before any processing, which shows the WordPress token is set on Render.

Only booking refs appear below; there are no customer details.

### 1. Failed `checkout`, `credit-booking` and `sync` calls

- **Not countable from here.** These failures aren't stored in the database: no AuditLog or WebhookEvent rows are written for them. They're only in **Render's logs**, which I can't read from here.
- **AuditLog** for the last 30 days has nothing booking-related: one user created, one password changed and one user deactivated, all on 24 Nov.
- **No booking at all has reached WordPress since 25 Nov, 03:48 UTC** (11:48 HKT). That was `BNY-S6SBZY`, a CRM test booking that expired.
  - So if the client tried to book after that and it "didn't work", the attempt failed **before** WordPress created a hold: in the browser, on the website's booking form, or in the CRM's call to WordPress `/checkout`.
  - A hold that later failed at Stripe would still be listed, as `pending` and then `expired`.
- **All 23 bookings in the window are Stripe *test mode*.** If the client tried to pay with a real card, Stripe test mode declines it ("your request was in test mode, but used a non-test card"). That alone looks like "it doesn't work". **Please ask the client what they tried, and when.**

### 2. WordPress → CRM sync

- **The cache matches WordPress exactly:** 23 bookings on both sides, none missing, no status differences, none stuck at `pending` or `error`.
- **The last booking received** was `BNY-S6SBZY`, created 25 Nov 03:48 UTC; WordPress last updated it at 04:19 UTC.
- **Problem 1: the regular 2-minute sync job isn't running on Render.**
  - Its last run was **25 Nov 03:45 UTC**. Since then the cache has only been refreshed when someone opened the bookings page (the on-read sync).
  - I kept the API awake for several minutes: Gmail and Google Calendar polled on schedule, but the WordPress sync didn't run. The WordPress token *is* set.
  - So `BANYAN_BOOKING_SYNC_MINUTES` is probably `0` on Render, or the job is failing early. Render's logs would show `[wp-bookings] sync failed` in the second case.
- **Problem 2: WordPress's booking webhooks (`booking.paid` / `booking.cancelled`) almost never reach the CRM.**
  - Every delivered webhook is recorded, and there has been **one** in total (17 Nov), against about 20 paid and cancelled bookings in the period.
  - Likely cause: Render's free tier puts the API to sleep, and waking takes 30–60 s. WordPress's webhook call gives up well before that, so the delivery is lost. A token or signature mismatch would also be dropped without a record.
- **Effect of both problems:** new website bookings and their payments show in the CRM late, only once someone opens the bookings page. This doesn't stop customers booking on the website.

### 3. Google Calendar copies

- **No failures.** Six cancelled bookings were removed from the room calendars ("status_cancelled"), and the others never needed a copy: test or not paid.
- I didn't run a backfill.

### 4. Checkout response

- **The code** returns `session_id`, falling back to parsing `/c/pay/cs_…` from the URL.
- **The data agrees:** all 9 CRM card bookings in the cache have a Stripe session id, including the latest (`BNY-S6SBZY`, `BNY-8K8WZW`, `BNY-7R92L3`). So "Payment can't be tracked here" shouldn't appear for these.
- I didn't call `/checkout`, because that would create a hold.

### 5. Stripe webhook

- **The CRM has never received a Stripe webhook:** zero `provider: "stripe"` rows of any type. That includes `checkout.session.completed`, in test or live mode.
- **Room bookings are unaffected:** WordPress confirms room payments with its own Stripe webhook, and the 3 paid test bookings show that works.
- **But anything that relies on the *CRM's* Stripe webhook isn't working:**
  - website **day-pass purchases** through Stripe Payment Links, which become CRM deals;
  - **CRM invoice payment links**.
- **Likely cause:** no Stripe webhook endpoint points at `<public API base>/api/v1/webhooks/stripe`, or `STRIPE_WEBHOOK_SECRET` isn't set.

### What I think is broken, in order

1. **The CRM's Stripe webhook isn't set up.** Day passes and invoice payments never reach the CRM. To fix: add the endpoint in Stripe (test and live) and set the signing secret on Render.
2. **The 2-minute WordPress sync isn't running.** To fix: check `BANYAN_BOOKING_SYNC_MINUTES` and the logs on Render.
3. **WordPress's booking webhooks are lost while Render sleeps.** To fix: a paid Render instance that doesn't sleep, or WordPress retrying failed webhooks.
4. **The client's "doesn't work"** most likely happened before WordPress created a hold, or was a real card in test mode. We need what they tried; the tester's TEST booking (§11.4) will show the steps.

I've changed none of these. Tell us which to do.

## What I couldn't do

- **Render logs:** no access from here, so the failed `checkout`, `credit-booking` and `sync` calls (D1) can't be counted. Search the logs for `WP_CHECKOUT_FAILED`, `WP_BOOKING_UNREACHABLE`, `[wp-bookings]` and `INSUFFICIENT_CREDITS`.
- **Render environment:** I can't read it, so `BANYAN_BOOKING_SYNC_MINUTES` and the Stripe webhook secret are inferred from behaviour.
- **Live tests of Eventbrite and WhatsApp:** there are no credentials yet. Both are tested against fake APIs in `tests/round-2026-11-27b.test.js`.
