# Backend round 27 Nov (b): Eventbrite, WhatsApp, stage tasks, booking check

**For:** the backend agent (Express/Mongo, `E:\Projects\Banyan-CRM-BE`, Render).
**Do this after** `CRM_BACKEND_ROUND_2026-11-27.md` (A–F). It doesn't change anything from that round.
**Frontend:** built. Every new screen shows "needs the latest server update" on a 404, so you can deploy in any order.

The client left four things open. We've decided them so we don't wait; the client can still ask for changes:

| # | Decision | What's needed | Size |
|---|---|---|---|
| A | **Eventbrite: connect it** (the client's option 1). Eventbrite stays where events are created and tickets sold. The CRM reads events and sign-ups and creates or updates a contact for each attendee. | Sync job, webhook, two models, three read routes, one status route | M–L |
| B | **WhatsApp: Meta WhatsApp Cloud API** (what's already built). Add what the team needs to test it: a status check, template messages, and linking a sent message to the contact. | Status route, template sending, clearer errors | S–M |
| C | **Stage tasks: off by default, set per stage.** Only "Quote sent" keeps a follow-up task (3 days). Staff are already asked "What's next?" after each move. | `PipelineStage.followUp`, migration, use it in `runStageFollowUpAutomation` | S |
| D | **Booking flow: find the failure from the logs** (no call needed first). | Read-only investigation and a report | S |

General rules (unchanged):
- Responses use the `{ success, data }` envelope, and errors use `AppError(message, status, CODE)`.
- Scope everything by `workspaceId`. Lists return `{ items, pagination }`.
- **Never put tokens or secrets in code, docs, logs or replies.** New settings go in Render's environment only.
- **Room bookings:** don't create, change or cancel any booking. Never touch the Library. Don't send meeting invites. Use HK time (Asia/Hong_Kong).

---

## A. Eventbrite

### Settings (Render environment; the owner adds the values)

| Name | What |
|---|---|
| `EVENTBRITE_PRIVATE_TOKEN` | Eventbrite → Account settings → Developer links → API keys → **Private token**. |
| `EVENTBRITE_ORGANIZATION_ID` | Optional. If empty, use the first organisation from `GET /v3/users/me/organizations/`. |
| `EVENTBRITE_WEBHOOK_SECRET` | A long random string, used in the webhook URL (Eventbrite webhooks aren't signed). |

If the token is missing, everything below still answers: the status route returns `connected: false`, the sync returns 503 `INTEGRATION_NOT_CONFIGURED` (`requireEnvironment`), and the list routes return empty lists.

### Models

**`Event`**
```
workspaceId, source: "eventbrite", externalId (unique per workspace+source),
name, description (plain text, max 5000), url, status (draft|live|started|ended|completed|canceled),
startAt, endAt (Date, from start.utc/end.utc), timezone, venue (string: venue name + address line),
capacity, isFree, currency,
registrationCount, checkedInCount        // kept up to date by the sync, for the list page
lastSyncedAt, metadata
```
Index: `{ workspaceId: 1, startAt: -1 }`.

**`EventRegistration`** (one per Eventbrite *attendee*, i.e. per ticket)
```
workspaceId, eventId (ref Event), contactId (ref Contact), companyId (copied from the contact, for the company tab),
externalId (attendee id, unique per workspace), orderId,
name, email (lowercased), phone,
ticketClass, amount (major units, e.g. 150), currency,
status: attending | checked_in | cancelled | refunded | not_attending,
registeredAt (attendee.created), checkedInAt, cancelledAt,
contactCreated: Boolean     // true when this sign-up created the contact
answers: [{ question, answer }]   // custom questions, max 20, strings max 500
```
Indexes: `{ workspaceId, eventId, registeredAt }`, `{ workspaceId, contactId, registeredAt: -1 }`, `{ workspaceId, companyId, registeredAt: -1 }`.

Status mapping from the attendee: `refunded` → refunded; `cancelled` → cancelled; `checked_in` → checked_in; `status === "Not Attending"` → not_attending; otherwise attending.

### Sync (`eventbriteSync.service.js`)

Follow the poller pattern of `gmailPoller.service.js` / `googleCalendarPoller.service.js`, with a single run at a time.

1. Organisation: `GET https://www.eventbriteapi.com/v3/users/me/organizations/`, with the header `Authorization: Bearer <token>`.
2. Events: `GET /v3/organizations/{org}/events/?status=all&order_by=start_desc&page_size=50`, following `pagination.continuation`. Keep events that **start on or after 1 Jan 2026**, plus every future event. Stop paging once events start before 1 Jan 2026. Upsert by `externalId`.
3. Attendees, per event: `GET /v3/events/{id}/attendees/?page_size=50`. On later runs, add `changed_since=<lastSyncAt minus 1 hour, ISO UTC>`. Upsert by attendee id.
4. **The contact, for each attendee**, by email:
   - Lowercase and trim the email. Match an existing contact with `contactMatching.service.js`, by email only; don't match on names. Archived contacts count as a match, but don't unarchive them.
   - **No match:** create the contact from `profile.first_name`, `last_name`, `email`, `cell_phone`, `job_title`. Set `source: "Eventbrite"`, tag `eventbrite`, and `contactCreated: true` on the registration.
   - **Match:** fill **empty** fields only (phone, job title). Never overwrite. Add the `eventbrite` tag if it's missing (max 30 tags).
   - **Marketing consent:** don't set it. Buying a ticket isn't consent to the newsletter.
   - **Company:** if `profile.company` matches an existing company name exactly (case-insensitive) and the contact has no company, link it. Never create companies.
   - **No email** (redacted, or the attendee is hidden): store the registration with `contactId: null` and don't create a contact.
5. **Activity on the contact**, only when the registration is new or its status changes:
   - Type `event`. Title: "Signed up for <event> (<ticket>)", "Checked in at <event>", or "Cancelled <event>" / "Refunded <event>".
   - Set `entityType: "contact"`, `contactId` and `companyId`, and `metadata: { eventId, registrationId }`.
   - It should show in `/related` → activities.
6. Update `registrationCount` (everything except cancelled, refunded and not_attending) and `checkedInCount` on the event.
7. Save the result on the `Integration` record (`provider: "eventbrite"`): `lastSyncAt`, `lastSync: { events, registrations, contactsCreated, contactsUpdated, errors }`, and `lastError` (a message only, no token).
8. **Schedule:** every 30 minutes, plus once at start-up 2 minutes after boot. Respect Eventbrite's rate limit of 2,000 calls an hour; back off on a 429.
9. **Tag catalogue:** add the `eventbrite` source tag to `TAG_CATALOGUE` and to the `ContactTag` seed (group `source`, label "Eventbrite", description "Signed up for a Banyan event on Eventbrite.", `isSystem: true`).

### Webhook (new sign-ups straight away)

- **Route:** `POST /api/webhooks/eventbrite/:secret`. Compare `:secret` with `EVENTBRITE_WEBHOOK_SECRET` using a timing-safe compare; on a mismatch return 404. Rate limit it like the other webhooks.
- **Body:** `{ config: { action, webhook_id }, api_url }`. **Only fetch `api_url` if its host is `www.eventbriteapi.com`.** Otherwise answer 200 and ignore it.
  - Fetch it with the token, then upsert the attendee or event as in the sync.
  - For `order.placed` / `order.updated` / `order.refunded`, the URL is an order: fetch `…/orders/{id}/?expand=attendees` and process each attendee.
  - Handle `attendee.updated`, `attendee.checked_in`, `attendee.checked_out`, `event.published` and `event.updated`.
- Answer 200 quickly. Do the work after the response or in a queue, and record it in `WebhookEvent` (idempotent on `webhook_id + api_url`).
- **Registering the webhook:** `POST /api/integrations/eventbrite/webhook` (admin) creates it with `POST /v3/organizations/{org}/webhooks/`, body:
  ```
  {
    "endpoint_url": "<public API base>/api/webhooks/eventbrite/<secret>",
    "actions": "order.placed,order.updated,order.refunded,attendee.updated,attendee.checked_in,attendee.checked_out,event.published,event.updated"
  }
  ```
  Store the `webhook_id`. If one already exists for this URL, reuse it. Also do this automatically on the first successful sync.

### Routes

| Method | Path | Who | Returns |
|---|---|---|---|
| GET | `/api/integrations/eventbrite` | admin | `{ connected, organizationName, webhookActive, lastSyncAt, lastSync, lastError }`. `connected` means the token works (`/users/me/organizations/` answers 200); cache this check for 5 minutes. |
| POST | `/api/integrations/eventbrite/sync` | admin | Runs a full sync now and returns the same shape. If a sync is already running, return 409 `SYNC_RUNNING`. |
| POST | `/api/integrations/eventbrite/webhook` | admin | `{ webhookActive, webhookId }` |
| GET | `/api/events` | anyone who can read contacts | Query: `when=upcoming\|past\|all` (by `endAt`/`startAt` against now; upcoming = not ended), `search` (on the name), `sort=startAt`, `order`, `page`, `limit`. Each item includes `registrationCount`, `checkedInCount`, `capacity`, `venue`, `status`, `url`. |
| GET | `/api/events/:id` | same | The event |
| GET | `/api/event-registrations` | same | Filters `eventId`, `contactId`, `companyId`, `status`. Sort fields `registeredAt` and `createdAt`; `limit` up to 200. Populate `eventId` (name, startAt, url) and `contactId` (firstName, lastName, email). |

The generic resource registry (`resourceRegistry.js`) can serve the two read lists if that's simpler, as long as `when` and the populates work.

**Nothing writes to Eventbrite** except creating the webhook.

---

## B. WhatsApp (Meta Cloud API)

The existing code (`whatsappIntegration.controller.js`, with the env vars `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` and `WHATSAPP_VERIFY_TOKEN`) stays.

### B1. `GET /api/integrations/whatsapp/status` (admin)

```
{
  configured,          // all four env vars set AND the phone-number call below answers 200
  displayPhoneNumber, verifiedName, qualityRating,   // GET /{PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating
  webhookVerified,     // true once a verified webhook call has been received (store the time when one arrives)
  lastInboundAt,       // latest inbound WhatsApp Message.createdAt
  templates: [{ name, language, category, status, body, paramCount }],
                       // GET /{WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?fields=name,language,category,status,components&limit=100
                       // body = the BODY component's text; paramCount = the highest {{n}} in it
  error                // Meta's error message if a call failed (never the token)
}
```
Cache it for 5 minutes. With no env vars set, return `configured: false` (status 200), not 503.

### B2. `POST /api/integrations/whatsapp/messages`: template messages and the contact link

New body shapes, alongside the existing `{ to, text, conversationId }`:
```
{ to, contactId?, text }
{ to, contactId?, template: { name, language, params: ["Jane", "3 Dec"] } }
```
- **Template:** send `type: "template"` with `template: { name, language: { code: language }, components: [{ type: "body", parameters: params.map(t => ({ type: "text", text: t })) }] }`. Validate: `name` must match `^[a-z0-9_]{1,512}$`, at most 10 params, each 1–1024 characters.
  - The text stored on the Message is the template body with `{{n}}` filled in.
- **`contactId`, with no `conversationId`:** find the contact's WhatsApp `Conversation` (by contact and channel `whatsapp`), or create one with `participantAddress` set to the digits of `to`.
  - Save the outbound `Message` in it, so the message shows in the contact's WhatsApp tab and in the Inbox.
  - Also add an activity "WhatsApp sent: <first 80 characters>".
- **Errors:**
  - When Meta returns error **131047** (more than 24 hours since the customer's last message), throw 409 `WHATSAPP_WINDOW_CLOSED` with the message "This person hasn't messaged in the last 24 hours. Use an approved template."
  - When Meta returns 131026 (the number isn't on WhatsApp), throw 422 `WHATSAPP_NOT_ON_WHATSAPP`.
  - Pass other Meta errors through as 502, with Meta's message.
- Permission: the same as today (signed-in staff with `records.write`).

### B3. Inbound

Check that the webhook flow (`receiveWhatsAppWebhookAndSync`) links an inbound message to the contact by phone (digits, also matching with or without the 852 prefix), and creates the `whatsapp_lead` contact as today. Set `webhookVerified` / `lastInboundAt` for B1.

---

## C. Follow-up task per pipeline stage

**Today:** `runStageFollowUpAutomation` (in `deal.service.js`) creates a "Follow up: … — <stage>" task on **every** stage change, plus a "Quote follow-up" on "Quote sent".

**New:**
- **Model:** `PipelineStage.followUp = { enabled: Boolean (default false), dueInDays: Number 0–60 (default 1), title: String max 150 (default "") }`.
- **Validation:**
  - Accept `followUp` on `POST /pipelines/:id/stages` and `PATCH /pipelines/stages/:id`.
  - Return it on the stage lists.
  - If `dueInDays` is out of range, return 400 `INVALID_FOLLOW_UP`.
- **Migration** (`20261127b-stage-followups.js`, idempotent):
  - Stages whose name matches `/quote sent/i` get `{ enabled: true, dueInDays: 3, title: "Quote follow-up: {deal}" }`.
  - All other stages get `{ enabled: false, dueInDays: 1, title: "" }`.
  - Only set `followUp` where it doesn't exist yet.
- **`runStageFollowUpAutomation`:**
  - If `stage.followUp?.enabled`, create **one** task.
    - Title: `followUp.title` with `{deal}` replaced by the deal title. If the title is empty, use `Follow up: <deal> — <stage>`.
    - Due `dueInDays` days later, at 10:00 HK time. With 0 days, due today at the next full hour, or 18:00 if that's later.
    - Keep the idempotency check, and the same owner, links, priority and metadata as today.
  - Remove the separate hard-coded "Quote sent" task (the migration covers it).
  - Keep the "Deal moved to …" notification. Its body should say "A follow-up task was created." only when a task was actually created.
- Configured automations (`fireDealTrigger`) are unchanged.

---

## D. Room booking flow: find what fails (read only)

The client says the meeting room booking flow "doesn't seem to work", and gave no details. The public WordPress endpoints answer normally: `availability` returned 200 for the small room for Dec 2026 and Jan 2027, and the booking page loads `booking.js` 1.3.2.

Please look, **without creating, changing or cancelling anything**, at the last 30 days:
1. Every failed `POST /room-bookings/checkout`, `/room-bookings/credit-booking` and `/room-bookings/sync`: the error codes, the messages, and how many of each. Use the Render logs and any `AuditLog` / `WebhookEvent` rows.
2. **WordPress → CRM sync:**
   - When was the last booking received?
   - Are there bookings on WordPress (`GET …/wp-json/banyan/v1/…`, the admin list the sync already uses) that are missing from the CRM cache, or are stuck at `pending` / `error`?
   - List refs only, no customer details.
3. **Google Calendar copies:** any bookings with a failed calendar sync. Don't run a backfill.
4. **Checkout response:** confirm the response includes `session_id`, or a `url` containing `/c/pay/cs_…`. Without it, the CRM can't track payment and staff see "Payment can't be tracked here".
5. **Stripe webhook:** in test mode, the latest `checkout.session.completed` received and whether it was processed.

Put the answers in section D of your reply, with what you think is broken. **Don't fix anything in this round without telling us first.** The browser tester will also make one TEST booking of the small room (§11.4 of the test handoff) and report every step.

---

## Reply

Write `docs/CRM_BACKEND_REPLY_2026-11-27b.md` with:
- **A–C:** what you built, any change to the shapes above, and the env vars the owner must add. Give their names only, never the values.
- **The commands** to run: the migration, and the first Eventbrite sync and webhook.
- **D:** your findings.
- **What you couldn't do**, and why.
