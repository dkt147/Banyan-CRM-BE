# Handoff: website changes for the CRM (banyanworkspace.com)

**For:** the agent maintaining the WordPress site and the **Banyan Room Booking** plugin, and the CRM backend agent (`Banyan-CRM-BE`). Each section says who owns it.
**From:** the CRM frontend (`Banyan-CRM-Admin`).
**Date:** 17 Nov 2026
**Related:** `WP_PLUGIN_HANDOFF.md` (plugin ↔ CRM contract, still valid), `CRM_FEEDBACK_BACKEND_DONE.md` (CRM API reference).

The client's feedback asks for everything a customer buys to show on their CRM contact under **Bookings & purchases**, and for forms to be created in the CRM and used on the website. The CRM side is built. Three things are still missing on the website side.

| # | Change | Owner | Priority |
|---|---|---|---|
| 1 | Day passes bought on the website reach the CRM | Backend (+ two Stripe settings by whoever has the Stripe account) | **P1** |
| 2 | Enquiry popup → CRM | – | Already works (confirmed by the client). Don't change it. |
| 3 | Shortcode to put CRM forms on website pages | WordPress | P2 |
| 4 | Cancel / refund a room booking from the CRM (old §4e) | WordPress, then backend | P3 |

Rules for all of it:
- **Time zone:** Hong Kong (`Asia/Hong_Kong`).
- **Partner calendar:** don't change or delete anything in the partner's Google Calendar, including test events.
- **Invitations:** no meeting invites or Google invitations.
- **Plugin contract:** don't break the WordPress plugin contract in `WP_PLUGIN_HANDOFF.md` §2.

---

## 1. Day pass purchases → CRM (P1)

**Status (18 Nov 2026): built on the backend.** It goes live once the CRM owner runs `npm run stripe:payment-links` and sets `STRIPE_PAYMENT_LINK_PRODUCTS` on Render. The Stripe dashboard checks below still apply. Nothing changes on the website.

### What happens today

The day pass pages (`/flexible-day-pass/`, `/coworking-day-pass-hong-kong/`) sell through three **Stripe Payment Links** (Elementor buttons). WordPress and the plugin are not involved:

| Product on the page | Price | Link | CRM `productType` |
|---|---|---|---|
| Half Day Pass (up to 4 h, valid 30 days) | HK$150 | `https://buy.stripe.com/bIY03M8fMada9AkbJA` | `day_pass` |
| Day Pass (up to 9 h, valid 30 days) | HK$250 | `https://buy.stripe.com/3cs6sa3Zwclih2MfZR` | `day_pass` |
| 10-Day Package (10 days or 20 half days) | HK$2,188 | `https://buy.stripe.com/6oE17Q53A9969Ak6pi` | `day_pass_package` |

The CRM's Stripe webhook (`POST /api/v1/webhooks/stripe`, `providerWebhook.controller.js`) only handles payments for CRM invoices. A Payment Link checkout has no CRM payment record, so it is stored as `ignored` / `local_payment_not_found`. **So no day pass purchase ever reaches the CRM.**

### Backend: turn paid Payment Link checkouts into purchases

The CRM frontend already shows a won deal with `productType: day_pass | day_pass_package` under **Bookings & purchases**, through `GET /related`. That means the backend only has to create that deal; no frontend work is needed.

In `receiveStripeWebhook`, before giving up with `local_payment_not_found`, handle `checkout.session.completed` (with `payment_status: "paid"`) and `checkout.session.async_payment_succeeded` where `session.payment_link` is set:

1. **Identify the product.**
   - Map `session.payment_link` (`plink_…`) to a product key with a config map, e.g. env `STRIPE_PAYMENT_LINK_PRODUCTS='{"plink_…":"half_day_pass","plink_…":"day_pass","plink_…":"day_pass_10"}'`.
   - Add a one-off script that lists the account's Payment Links (`GET /v1/payment_links`) with their `url`, so the `plink_` IDs can be matched to the three URLs above.
   - If a link isn't in the map, store the event as `ignored` with reason `unknown_payment_link`, as today. That way other Payment Links are never treated as day passes.
2. **Contact.**
   - Find the contact by `session.customer_details.email` (lower-cased), then by phone. Otherwise create one with `customer_details.name` split into first and last name, plus `phone`, and `source: "website"`.
   - Add the tag `website_booking`, or `test_booking` when `livemode` is false.
3. **Deal**, idempotent by checkout session ID (Stripe sends both `checkout.session.completed` and `payment_intent.succeeded`, and retries):
   - `title`: e.g. `Day Pass – Jane Chan`
   - `productType`: `day_pass` or `day_pass_package`
   - `status: "won"`, `closedAt` = payment time
   - `value: amount_total / 100`, `currency: "HKD"`
   - Pipeline: the transactional pipeline, in its won stage
   - `source: "website"`
   - `metadata`: `{ stripeCheckoutSessionId, stripePaymentIntentId, paymentLink, productKey, livemode }`
4. **Test mode:** if `livemode` is false, still create the deal so the flow can be tested, but mark it `metadata.isTest: true` and **exclude it from `/reports/periodic` `dayPasses` and revenue**. Room bookings are already handled the same way.
5. **Refunds:** on `charge.refunded` for one of these payment intents, set the deal to `lost` with reason "Refunded in Stripe". If that's too much for now, add a timeline note instead.
6. **Timeline:** add an activity on the contact, e.g. "Bought a Day Pass (HK$250) on the website".

Nothing changes in the day pass validity rules. The CRM doesn't track redemptions (days used) yet.

### Stripe check (whoever manages the Stripe account)

- **Same account: confirmed.** The client confirmed the Payment Links are on the same Stripe account as the CRM's `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, so the existing CRM webhook endpoint and secret are used. No second endpoint is needed.
- **Webhook events:** Stripe Dashboard → Developers → Webhooks → the CRM endpoint must send:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `charge.refunded`
- **Customer details:** on each of the three Payment Links, turn on **collect the customer's name** and **phone number**. Email is always collected. Without them, the CRM contact is created with only an email.
- **After payment:** optionally set the redirect on each link to a thank-you page on banyanworkspace.com. This is a website choice; the CRM doesn't need it.

**WordPress:** nothing to change for this item. Keep the buttons pointing at the same three links. If a link is replaced with a new one, tell the CRM owner so its `plink_` ID is added to the map.

---

## 2. Enquiry popup → CRM (no action)

The client confirmed that website enquiries from the site-wide popup (`#banyan-enquiry-popup`, a Contact Form 7 form, `wpcf7-f517`) already show up in the CRM. **Leave this as it is.**

Only if you change the popup's form, keep it sending the same fields to the same endpoint. The reference below is for that case.

**CRM endpoint:** `POST https://banyan-crm-be-n69x.onrender.com/api/v1/public/enquiries`, JSON:

```json
{
  "firstName": "Jane",
  "lastName": "Chan",
  "email": "jane@example.com",
  "phone": "+852 9123 4567",
  "interests": ["Flexible Day Pass"],
  "notes": "Free text, max 3,000 characters"
}
```

- `interests` must use these labels exactly:
  - Virtual Office
  - Flexible Day Pass
  - Coworking Desks
  - Serviced Offices
  - Meeting Rooms
  - Event Venue
  - Photoshoot Space
  - Podcast Studio
- The endpoint takes **one service per enquiry**. If a visitor ticks several, send one request per service, or send the first and put the rest in `notes`.
- **Honeypot:** a non-empty `_honeypot` or `website_confirm` field is accepted silently and not stored. Keep the form's hidden spam field and pass its value through.
- **Rate limit:** 10 requests per IP in a short window.

---

## 3. CRM forms on website pages (P2, WordPress)

Staff now build forms in the CRM (**Forms → Copy website enquiry form**, or a blank form). Today the CRM gives them a raw HTML snippet. A shortcode makes this safe for non-developers:

```
[banyan_crm_form slug="website-enquiry" key="<public key from the CRM Embed dialog>"]
```

**What the shortcode should do:**
- Fetch nothing at render time. Render the fields from a JSON copy pasted into the shortcode settings, or (simpler) keep the embed HTML the CRM produces and only add the parts below. Either is fine; say which you chose.
- **Post to** `https://banyan-crm-be-n69x.onrender.com/api/v1/public/forms/<slug>`, as a normal HTML post (urlencoded) or as JSON with `fetch`.
  - Hidden `publicKey` field.
  - Checkbox groups as `name[]`.
  - If the form has consent text, a required consent checkbox `consent=yes`.
- **Honeypot**, exactly like this (the CRM rejects submissions where it has a value):
  `<input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">`
- **After an HTML post**, the CRM redirects (303) back to the same page with:
  - `?submitted=1` → show a thank-you message in place of the form;
  - `?form_error=<message>` → show the message above the form, and keep the form.

  With `fetch` + JSON you get JSON back instead: 2xx means success, otherwise `{ message }`.
- **Allowed websites:** the CRM accepts posts only from the websites listed on the form (banyanworkspace.com when the list is empty). Pages on another domain need adding in the CRM form settings.
- **Key changes:** if staff click **Regenerate key** in the CRM, old embeds stop working. The shortcode's `key` has to be updated.

---

## 4. Cancel / refund a room booking from the CRM (P3, WordPress first)

Still open from `WP_PLUGIN_HANDOFF.md` §4e. Until it exists, the CRM tells staff to cancel in WP Admin.

`POST /wp-json/banyan/v1/bookings/{ref}/cancel`, token-protected like `GET /bookings`:

```json
{ "refund": true, "reason": "Customer asked to move to next week", "by": "Staff name (CRM)" }
```

- **Paid booking:** cancel it and free the hours. With `refund: true`, issue a full Stripe refund.
- **Response:** `200 { ref, status: "cancelled", refund: { id, amount, status } | null }`.
- **Pending hold:** cancel it and release it. Expire the Stripe Checkout session if possible.
- **Errors:**
  - Blocked slot: 409. Partner blocks use `DELETE /blocks/{ref}`.
  - Already cancelled: 200 with the current state (idempotent).
  - Stripe refund failure: 502 with Stripe's message. The booking stays as it was.
- **After it works:**
  - Send the existing `booking.cancelled` webhook as usual.
  - Delete the CRM's own event from the room's Google Calendar (the CRM already does this when it sees the cancellation).
  - Send the customer the normal cancellation email.

**Status (18 Nov 2026): the CRM side is live and waiting for this endpoint.**
- The CRM backend's `POST /room-bookings/:ref/cancel` calls it with the token and `{ refund, reason, by: "<staff> (CRM)" }`.
- Staff already have a Cancel button (admins also get "Refund in full") on the booking side panel.
- Until the plugin has the endpoint, the CRM shows "Cancel in WP Admin > Room Bookings for now" (501 `WP_CANCEL_UNSUPPORTED`).
- When you ship it, keep the request and response exactly as above. No CRM deploy is needed.

---

## Already done (no action)

These are listed so nobody rebuilds them:
- **Plugin 1.1.1:**
  - partner blocks (`POST`/`DELETE /blocks`);
  - pending, expired and blocked webhooks;
  - `session_id` in the `/checkout` response;
  - token holders exempt from the checkout rate limit.
- **Library Google Calendar:**
  - Paid bookings are added by the CRM, with no invitations and in HK time.
  - Partner meetings in that calendar become WordPress blocks every 10 minutes once the toggle is on in the CRM.
  - The meeting-room calendar IDs are still to come from the client.

## Test checklist

- [ ] Buy a Half Day Pass with a Stripe test card on a test-mode copy of the link. One contact and one won `day_pass` deal appear in the CRM, tagged `test_booking`, and appear under **Bookings & purchases**. Resending the webhook doesn't duplicate it.
- [ ] A live Day Pass purchase shows in **Reports → Day passes sold** for the month (HK time). A test one doesn't.
- [ ] A page with `[banyan_crm_form …]`: the submission appears in CRM **Forms → Submissions**, and the page shows the thank-you message (`?submitted=1`). A bad email shows the `form_error` message. Filling the hidden `website` field shows as spam.
- [ ] (When §4 is built) Cancel a test booking with a refund: the refund appears in Stripe, the hours are free in `/availability`, and the CRM shows it as cancelled.

## Reply with

- **§1 (backend):** the `plink_` map, and a sample webhook event processed into a deal (IDs only, no customer data).
- **§1 (Stripe):** whether the webhook events and the name/phone collection were already set, or what you changed.
- **§3:** the shortcode's final attributes and how it renders fields.
- **§4:** the endpoint status, with example request and response bodies.
