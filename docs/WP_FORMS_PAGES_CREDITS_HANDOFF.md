# WordPress plugin: form pages, Banyan form design, credit bookings

**For:** the WordPress agent (Banyan room-booking plugin, currently 1.2.1).
**From:** the CRM team, 19 Nov 2026, after the client meeting.

**Backend counterpart:** `docs/CRM_BACKEND_ROUND_2026-11-19.md`, §2 (forms) and §5 (credits).

## Summary

| # | Change | Size |
|---|---|---|
| 1 | Create, update and bin a page for a CRM form, on request from the CRM | Small–medium |
| 2 | `[banyan_crm_form]` renders the form in the Banyan design from the CRM's definition | Medium |
| 3 | Confirmed booking without payment ("paid with meeting room credits"), on request from the CRM | Medium |

## House rules

- The existing website enquiry pop-up stays exactly as it is.
- Don't change existing pages other than ones this feature created.
- Don't change existing bookings. Test bookings and pages must have a title starting "TEST".
- Stripe stays on test keys until launch.

All new routes use the same CRM-to-WordPress authentication as the existing cancel endpoint.

---

## 1. Pages for CRM forms

The client wants to click "Create page" on a form in the CRM and get a link to a real banyanworkspace.com page. Uses: the iPad at reception for walk-ins, event sign-ups, and the newsletter link on Instagram.

### `POST /wp-json/banyan/v1/crm-pages`

Request body:

```json
{ "form_slug": "walk-in", "path": "forms/walk-in", "title": "Welcome to Banyan Workspace", "wp_page_id": null }
```

**Behaviour:**
- **New page:** if `wp_page_id` is null, create a **published** page.
  - Content: just `[banyan_crm_form slug="walk-in" page="1"]`.
  - Template: the normal site header and footer.
  - Path: `path`. If it has two segments, make the first one a parent page (e.g. `forms`), created if missing, with no content and set to noindex.
- **Existing page:** if `wp_page_id` is set, update that page's title, slug and parent instead.
- **Marker:** mark these pages with post meta `_banyan_crm_form = <slug>`. Only pages with this meta may be updated or binned through this API.
- **Return:**
  ```json
  { "id": 123, "url": "https://banyanworkspace.com/forms/walk-in/", "status": "publish" }
  ```

**Errors:**

| Status | When |
|---|---|
| `409` | The path is used by a page this feature didn't create |
| `404` | `wp_page_id` is not one of these pages |
| `400` | Bad path (allowed: `^[a-z0-9-]+(/[a-z0-9-]+)?$`) |

### `DELETE /wp-json/banyan/v1/crm-pages/{id}`

Moves the page to the bin (not a permanent delete). Only pages with `_banyan_crm_form` can be binned.

These pages should be excluded from search engines (noindex), since they're for direct links. Ask the client if they want any indexed later.

## 2. `[banyan_crm_form]` in the Banyan design

The shortcode already posts to the CRM with fetch + JSON and an HTML fallback, using `_return_url`. Change it to:

1. **Fetch the definition** from the CRM: `GET {CRM_API}/public/forms/{slug}`. Cache it in a transient for 60 seconds. If the CRM is unreachable, use the last cached copy. The response contains:

   ```js
   {
     slug, name, isActive,
     fields: [{ key, label, type, required, options }],   // type: text | email | tel | textarea | checkboxes | select
     consentText,
     design: {
       title, intro, buttonText, successMessage,
       layout,                                             // "centered" | "image-left"
       imageUrl, headingFont, bodyFont,
       colors: { text, button, buttonHover, buttonText, background, page },
     },
     publicKey, submitUrl,
   }
   ```

   **Rendering the fields:**
   - Render fields in order.
   - Name inputs by `key`; checkboxes use `key[]`.
   - Add the consent checkbox (`name="consent" value="yes"`, required) when `consentText` is set.
   - Keep the honeypot (`website`) and `_return_url`.

2. **Design.** The CRM preview shows the same thing, from the same values:
   - **Layout:** a centred card, max 560px wide. With `layout: "image-left"` and an `imageUrl`, use a two-column card, max 880px, with the image covering the left column. On phones it becomes one column, image on top.
   - **Title:** `design.title` in `headingFont` (Playfair Display, already loaded on the site), weight 400, about 34px, centred. Then the `intro` paragraph, centred.
   - **Fields:** label above, 13px, weight 500, in `bodyFont` (Instrument Sans, also loaded). Inputs are full width with a thin border (text colour at about 25% opacity), radius 2px, padding 10px 12px.
   - **Button:** centred, background `colors.button`, text `colors.buttonText`, hover `colors.buttonHover`. Uppercase, letter-spacing .06em, padding 12px 32px, label `buttonText`.
   - **Colours:** text `colors.text`; card background `colors.background`.
   - **Page background:** `colors.page` behind the card. Only when `page="1"` (pages from §1); inline on an existing page, leave the page background alone.
   - **Defaults** (the CRM always sends these, but fall back to them): text `#1A2E1F`, button `#2D5F4C`, hover `#5A4A2E`, button text `#FFFFFF`, background `#FFFFFF`, page `#EAEDEB`.
   - **CSS:** scope it under a wrapper class, e.g. `.banyan-crm-form`, so it doesn't leak into the theme.

3. **After sending:** replace the form with `design.successMessage`, in the card, centred.
   - Add a "Send another response" link that resets the form. Walk-in pages are reused on one iPad, so after 10 seconds reset automatically when `page="1"` and the form slug starts with `walk-in`. Or simply always on `page="1"`; your call.
   - On error, show the CRM's message above the button and keep what was typed.

4. **Inactive or unknown form:** show "This form is not available." No PHP errors.

## 3. Confirmed booking without payment (meeting room credits)

Members' companies get monthly meeting room credits (1 credit = 1 hour). Staff will book for members from the CRM using credits. WordPress must hold the slot like any other booking, without taking payment.

### `POST /wp-json/banyan/v1/bookings/credit`

Request body:

```json
{
  "room": "small", "date": "2026-12-03", "start": "10:00", "hours": 2,
  "first_name": "…", "last_name": "…", "email": "…", "phone": "…",
  "notes": "…", "company": "Acme Ltd", "booked_by": "Felicia (CRM)", "credit_ref": "CR-…"
}
```

**Behaviour:**
- Run the same availability and clash checks as checkout, with the same rules (opening hours, weekends, blocks). On a clash, return `409` with the usual message.
- Create the booking:
  - status `paid` (or a new `confirmed` status, if you prefer, documented);
  - `channel: "admin"`, `viaCrm: true`;
  - `payment: { method: "credits", amount: 0, currency: "HKD", mode: <current mode>, credit_ref }`;
  - no Stripe session.
- Send the normal confirmation email to the customer, saying "Paid with meeting room credits" instead of the amount. Use no Stripe receipt link.
- Fire the usual webhook to the CRM.
- Return the booking in the same shape as `GET /bookings/{ref}`.

**Cancelling:** `POST /bookings/{ref}/cancel` on a credit booking frees the slot. There's nothing to refund, so return `refund: null` even if `refund: true` was sent. The CRM gives the credits back itself.

**Reports:** these bookings have `payment.amount: 0` and `method: "credits"`, so revenue stays correct. Add `payment.method` to the webhook and `GET /bookings` for all bookings (`"stripe"` for normal ones).

---

## Notes from the CRM backend (already built on the CRM side)

- **Form definition:** `GET /public/forms/:slug` returns the usual envelope `{ success, data: { … } }`. Read `data`.
  - There's no CORS restriction, and it sends `Cache-Control: public, max-age=60`.
  - Unknown or inactive forms return `404 FORM_NOT_FOUND`.
  - A field may also have `placeholder`.
  - `design` may be `null` on older forms, and `design.colors` may be partial. Fall back to the defaults in §2.
- **Pages (`POST /crm-pages`):** return `{ id, url, status }`.
  - A `409` must carry a `message`; the CRM shows it to staff.
  - `DELETE /crm-pages/{id}` may return `404` for a page that's already gone. The CRM treats that as removed.
- **Credit bookings (`POST /bookings/credit`):**
  - The CRM sends `start` as `"HH:00"`, whole hours between 09:00 and 18:00.
  - Return the booking in the `GET /bookings/{ref}` shape. A list of one, or `{ booking: … }`, is also accepted.
  - Include `payment.method: "credits"`, `amount: 0` and `credit_ref`.
- **`payment.method`:** send it on every booking, in webhooks and `GET /bookings`: `"stripe"` or `"credits"`. If it's missing, the CRM assumes `"stripe"`.
- **Until these routes exist,** the CRM returns `501 WP_PAGES_UNSUPPORTED` / `WP_CREDITS_UNSUPPORTED` and tells staff the website update is pending. Nothing breaks.

## Reply needed

- The new routes and the plugin version.
- An example response for each route.
- A screenshot of a test page (title starting "TEST") in the Banyan design, centred layout and image layout, on phone and desktop.
- Anything in the design spec that doesn't fit the theme.
