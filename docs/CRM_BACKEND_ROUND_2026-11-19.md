# Backend round: client meeting 19 Nov 2026

**For:** the CRM backend agent (`Banyan-CRM-BE`).
**From:** the CRM frontend (`Banyan-CRM-Admin`), after the client meeting on 19 Nov 2026.

The frontend for §1–§3 is built (not deployed yet) and sends/reads exactly the fields below. §4–§6 need these endpoints before the frontend screens are built.

The WordPress side of §2 and §5 is in `docs/WP_FORMS_PAGES_CREDITS_HANDOFF.md`.

## Summary

| # | Change | Size | Frontend |
|---|---|---|---|
| 1 | Login lasts days on iPad/Safari: return `refreshToken` in the body | Small | Built |
| 2 | Forms: store `design`, `flodesk`, new field mappings; public form definition; publish a WordPress page | Medium | Built |
| 3 | Flodesk: add subscribers to interest segments | Medium | Built (form option) |
| 4 | Reports: revenue by category, lead source, enquiry type (by week or month) | Medium | After this |
| 5 | Meeting room credits per company per month | Medium–large | After this |
| 6 | Loyalty tiers per company, by spend | Medium | After this |

## House rules

- Don't change or delete existing meetings in the shared Google calendars (`info@banyanworkspace.com`); they're used by Banyan's partner.
- Any test event or booking must have a title starting "TEST".
- Don't send meeting invites.
- All dates and periods are Hong Kong time (weeks start Monday).

---

## 1. Login: stop the 15-minute sign-out on iPad

**Cause:** the access token lasts 15 minutes, and renewing it relies on the `banyan_refresh_token` cookie. The CRM (`banyan-crm-admin.vercel.app`) and the API (`onrender.com`) are different sites, so Safari blocks that cookie. The client is signed out every 15 minutes on her iPad. Also check `COOKIE_SAME_SITE` on Render: if it isn't `none`, every browser has the same problem.

**Change:**
- `POST /auth/login` and `POST /auth/refresh` also return `data.refreshToken`. Keep setting the cookie as well.
- `/auth/refresh` and `/auth/logout` already accept `body.refreshToken`. Keep that.
- **Rotation grace:** the frontend now makes only one refresh at a time per tab. Two tabs can still refresh at once with the same token. If a just-rotated token is used again within ~30 seconds, return the same new pair instead of treating it as reuse and revoking the family.
- **Lifetime:** keep a 30-day refresh lifetime. The client asked for "a couple of days", and 30 days with rotation covers that.

The frontend stores the token in `localStorage` (`banyan_refresh_token`), next to the access token, and sends it in the body on refresh and logout.

## 2. Forms: design, Flodesk option, new mappings, website pages

### 2.1 New fields on `Form`, accepted by create/update and returned everywhere

```js
design: {
  title, intro,                      // ≤ 160 / ≤ 1000 chars
  buttonText,                        // ≤ 40
  successMessage,                    // ≤ 300
  layout: "centered" | "image-left",
  imageUrl,                          // "" or an https URL, ≤ 500
  headingFont: "Playfair Display",   // free text ≤ 60 (Google font name)
  bodyFont: "Instrument Sans",
  colors: { text, button, buttonHover, buttonText, background, page },   // each /^#[0-9A-Fa-f]{6}$/
},
flodesk: { enabled: Boolean },
page: { url, path, wpPageId, status, publishedAt, error } | null       // read-only, set by §2.3
```

Old forms have no `design`. The frontend merges the stored value over the Banyan defaults, so return what's stored, or `null`.

### 2.2 New field mappings (`fields[].mapTo`)

- **`source`:** "How did you hear about us?". Set `contact.source` **only if it's empty** (don't overwrite the first known origin). Always keep the value on the submission. Reports use it (§4).
- **`newsletterOptIn`:** a Yes/No question. `"Yes"` (case-insensitive) means the person agreed to marketing emails (§3). Don't store it on the contact as a field; add the tag `newsletter` when Yes.

Two new tags, both added to the catalogue (`src/utils/contactTags.js`, `GET /contacts/tag-catalogue`) as source tags:

| Tag | Meaning |
|---|---|
| `newsletter` | Signed up for the newsletter (also added to Flodesk). |
| `walk_in` | Filled in the walk-in form at reception. |

### 2.3 Website pages for a form

The client wants "Create page" to make a real page on banyanworkspace.com and give back the link (iPad at reception, event sign-ups, the Instagram newsletter link).

- **`POST /forms/:id/page`** with body `{ path }`, where `path` matches `^[a-z0-9-]+(/[a-z0-9-]+)?$` (e.g. `forms/walk-in`). Admin (`forms.manage`) only.
  1. The CRM calls the WordPress plugin (WP handoff §1) to create or update a published page at that path. The page contains `[banyan_crm_form slug="<slug>"]` and its title is `design.title || name`.
  2. Store `form.page = { url, path, wpPageId, status: "publish", publishedAt, error: null }`.
  3. Return `{ page }`.
  - It's idempotent: if `form.page.wpPageId` exists, update that page (title, path).
  - **Errors:**

    | Situation | Response |
    |---|---|
    | WordPress returns 409 (path taken by another page) | `409 PAGE_PATH_TAKEN` |
    | Plugin route missing | `501 WP_PAGES_UNSUPPORTED` |
    | Form inactive | `400 FORM_INACTIVE` |
- **`DELETE /forms/:id/page`:** WordPress moves the page to the bin (not a permanent delete). Clear `form.page`. Return `{ removed: true }`.
- **`GET /public/forms/:slug`** (no auth; CORS like the POST; cache 60 s): this is the form definition, so the WordPress shortcode can render the current fields and design. It returns:
  ```json
  {
    "slug": "walk-in", "name": "Walk-in visitor", "isActive": true,
    "fields": [{ "key", "label", "type", "required", "options" }],
    "consentText": "…", "design": { … }, "publicKey": "…",
    "submitUrl": "https://banyan-crm-be-n69x.onrender.com/api/v1/public/forms/walk-in"
  }
  ```
  `publicKey` is already in the public embed code, so returning it is fine. Return `404` for an unknown or inactive slug.

## 3. Flodesk

### Setup

- **Env:** `FLODESK_API_KEY`. The client has created a key; the developer sets it on Render. Don't log it, and don't commit it.
- **Flodesk API:** `https://api.flodesk.com/v1`, HTTP Basic auth (key as username, empty password).
  - `GET /segments` lists segments.
  - `POST /subscribers` upserts a subscriber by email: `{ email, first_name, last_name, segment_ids: [...] }`.
  - Check the current docs for exact field names.

### Segment mapping

The client chose these existing segments ("keep it simple"). The CRM interest goes in, the Flodesk segment name comes out:

| CRM interest (newsletter form option, or enquiry/walk-in service) | Flodesk segment |
|---|---|
| Coworking, Coworking Desks, Flexible Day Pass | `Coworking [Automated]` |
| Serviced Office, Serviced Offices | `Serviced Office [Automated]` |
| Virtual Office | `Misc Products (Virtual Office) [Automated]` |
| Event Space / Venue Hire, Event Venue, Photoshoot Space | `Event Space / Venue Hire [Automated]` |
| Podcast Services, Podcast Studio | `Podcast Services [Automated]` |
| anything else / none (e.g. Meeting Rooms) | `No Product [Automated]` |

- Look up segment IDs **by name** with `GET /segments`, cached for 1 hour.
- If a name isn't found, report it in the status and fall back to no segment. Don't create segments.
- Several interests mean several segments.

### When to add someone

On a processed form submission where `form.flodesk.enabled` is true **and** the person agreed:
- the form has a `newsletterOptIn` field and the answer is Yes; otherwise
- the form has `consentText` and the consent box was ticked.

Without consent, don't add them. Show the reason in the submission's Flodesk status.

### Delivery and status

- **Async:** don't block the form response. Retry 3 times with backoff on 429 or 5xx.
- **On the submission**, store `flodesk: { status: "added" | "skipped" | "failed", segments: [names], reason, at }`, and return it in `GET /forms/:id/submissions`.
- **`GET /integrations/flodesk`** (admin) returns:
  ```js
  {
    connected,                        // key set and GET /segments works
    segments: [{ id, name }],
    mapping: [{ interest, segment, found }],
    lastError, lastSuccessAt,
  }
  ```

### Zapier

Today a Zapier zap adds website sign-ups to Flodesk (and HubSpot). Once this is live, the client should turn that zap off. Flodesk upserts by email, so an overlap won't create duplicates, but segments could double up.

**Question for the client (I'll ask):** should **website enquiries** (the existing pop-up) also go to Flodesk by interest, as Zapier does now? The enquiry consent text is about the enquiry, not marketing. For now, leave `flodesk.enabled` off on the enquiry form; the client can switch it on.

## 4. Reports

The client wants three things, by **week or month**, over a chosen range:
- revenue by category;
- where leads come from;
- how many enquiries per product type (e.g. private office vs dedicated desk).

Add `GET /reports/breakdown?by=revenue|leadSource|enquiryType&period=week|month&from=YYYY-MM-DD&to=YYYY-MM-DD`. Use Hong Kong dates; weeks start Monday; maximum 53 weeks or 36 months.

```json
{
  "by": "revenue", "period": "month",
  "periods": [{ "key": "2026-11", "label": "Nov 2026", "from": "2026-11-01", "to": "2026-11-30" }],
  "categories": [{ "key": "meeting_rooms", "label": "Meeting rooms" }],
  "rows": { "2026-11": { "meeting_rooms": 12340, "day_passes": 500 } },
  "totals": { "meeting_rooms": 12340 },
  "unit": "HKD",
  "definitions": { "meeting_rooms": "Paid live room bookings from the website, by booking date." }
}
```

Every period and every category is always present, with `0` when empty.

### Categories

- **`revenue`** (HKD, paid, **live mode only**):
  - `meeting_rooms`: WordPress room bookings, as `roomRevenue` now.
  - `day_passes`: Stripe Payment Link purchases.
  - Paid invoices, grouped by the linked deal's `productType` (or pipeline when it's missing): `coworking`, `private_office` (serviced office), `virtual_office`, `events`, `podcast`, `other`.
  - Say in `definitions` which date is used (paid date).
- **`leadSource`** (count of **new contacts** by `createdAt`, grouped by `contact.source` normalised):

  | Key | Includes |
  |---|---|
  | `website` | website enquiry, website booking, forms |
  | `walk_in` | |
  | `newsletter` | |
  | `email` | |
  | `whatsapp` | |
  | `phone` | |
  | `referral` | including broker and partner |
  | `social` | organic and paid |
  | `search` | |
  | `event` | |
  | `other` | |
  | `unknown` | no source |

  Return the raw-to-key mapping in `definitions`, so it's visible.
- **`enquiryType`** (count of **enquiries** by received date): website enquiry form submissions plus walk-in form submissions, by service ticked. A submission with two services counts once in each. Categories are the service options: Virtual Office, Flexible Day Pass, Coworking Desks, Serviced Offices, Meeting Rooms, Event Venue, Photoshoot Space, Podcast Studio, and Other.

**Test-mode payments never count.** CSV export can come later.

## 5. Meeting room credits (per company, per month)

### Rules from the client

- **Allowance:** credits come with coworking memberships (dedicated desk, private office). They're allocated **per company per month**, and anyone at the company can use them. 1 credit = 1 hour.
- **Defaults to confirm with the client:**
  - unused credits don't roll over;
  - credits reset on the 1st of each month, Hong Kong time;
  - over the allowance, the normal price applies.

### Backend

1. **Allowance.** `Company.meetingRoomCreditHours` exists. Accept it on `PATCH /companies/:id` (integer 0–200). It's set by staff for now. Later it can come from the membership plan.
2. **Usage:** the sum of hours for that month across:
   - room bookings (WordPress and CRM) whose contact belongs to the company and that were **paid with credits** (below);
   - optionally, paid bookings marked by staff as "use credits".
   Keep a ledger, `CreditLedger { companyId, month: "YYYY-MM", bookingRef, hours, type: "use" | "refund" | "adjust", by, note, at }`, so usage is auditable and cancellations give hours back.
3. **`GET /companies/:id/credits?month=YYYY-MM`** returns:
   ```js
   {
     allowance, used, remaining,
     entries: [{ at, bookingRef, room, hours, type, by, note }],
   }
   ```
4. **`GET /credits?month=YYYY-MM`** is the overview: companies with an allowance, plus used and remaining. It replaces the calendar controller's current approximation.
5. **Booking with credits (staff, from the CRM):** `POST /room-bookings/credit-booking { room, date, start, hours, contactId, notes }`.
   1. Check that the contact has a company with enough remaining credits. If not, return `409 INSUFFICIENT_CREDITS` with `{ remaining }`.
   2. Ask WordPress to create a **confirmed, no-payment** booking (WP handoff §2). It must still block the website slot and pass the same clash checks (`409`).
   3. Write a ledger `use` entry and sync the row. Return the row.

   **Cancelling** a credit booking (`/room-bookings/:ref/cancel`) writes a `refund` ledger entry. There's no Stripe refund for these.
6. **Adjust:** `POST /companies/:id/credits/adjust { hours, note }` (admin) for one-off top-ups or corrections. `hours` can be negative.

**Website customers paying with credits** need a member login on the website, so that's out of scope for now. Staff book for members from the CRM.

## 6. Loyalty tiers (per company, by spend)

The client wants spend-based tiers per **company**, separate from memberships, to encourage repeat spending, with perks like priority booking. `LoyaltyTier` already has `minSpend`, `maxSpend` and `benefits`. Accounts are per contact today.

- **Spend:** a company's spend over the **last 12 months** of paid, live revenue: room bookings, day passes and invoices, via its contacts or `companyId`.
- **`GET /loyalty/companies?search=&tier=`** returns:
  ```js
  {
    items: [{
      company: { id, name },
      spend12m,
      tier: { id, name, benefits },
      nextTier: { name, minSpend },
      toNextTier,
    }],
    pagination,
  }
  ```
  Sort by `spend12m` descending.
- **`GET /companies/:id/loyalty`:** the same for one company, plus monthly spend for the last 12 months.
- **Tiers:** CRUD for tiers stays as it is (admin). **Thresholds and names are still to be agreed with the client.** Seed placeholders only if none exist:

  | Tier | Spend from |
  |---|---|
  | Member | HK$0 |
  | Silver | HK$10,000 |
  | Gold | HK$30,000 |

  Benefits are text for now, e.g. "Priority booking".
- Keep the existing points system as it is. The frontend will show company tiers as the main view.

---

## Reply needed

- §1: confirm the body token, rotation grace and the `COOKIE_SAME_SITE` value on Render.
- §2: deployed fields, plus an example `GET /public/forms/walk-in` response.
- §3:
  - the `GET /integrations/flodesk` output (segments found);
  - one test sign-up with an address like `test+flodesk@…`, then remove it from Flodesk.
- §4: an example response for each `by`.
- §5–§6: the endpoints as built, and anything you'd change in the rules.
