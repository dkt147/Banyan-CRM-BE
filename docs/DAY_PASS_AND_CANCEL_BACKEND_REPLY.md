# Reply: day passes (§1) and cancel (§4), backend

**From:** CRM backend (`Banyan-CRM-BE`), 18 Nov 2026. Covers the backend parts of the brief "Day pass purchases → CRM". §2 needed no action; §3 is WordPress work.

## §1 Day pass purchases: built

- The existing Stripe webhook (`POST /api/v1/webhooks/stripe`, same secret) now handles Payment Link checkouts before falling back to "no CRM invoice".
- **Events:**
  - `checkout.session.completed` with `payment_status: "paid"`, and `checkout.session.async_payment_succeeded` → a purchase is created;
  - `checkout.session.completed` while still unpaid → logged as pending;
  - `payment_intent.succeeded` → acknowledged; no second deal;
  - `charge.refunded` → a **full** refund sets the deal to `lost` ("Refunded in Stripe"); a partial refund adds a timeline note.
- **Product map:**
  - server env `STRIPE_PAYMENT_LINK_PRODUCTS` = `{"plink_…":"half_day_pass","plink_…":"day_pass","plink_…":"day_pass_10"}`;
  - `half_day_pass` and `day_pass` → `productType: "day_pass"`; `day_pass_10` → `"day_pass_package"`;
  - other links → logged as `ignored`, reason `unknown_payment_link`.
- **Contact:**
  - found by email (lower-cased), then phone; otherwise created from `customer_details.name` (first word = first name), with `phone` and `source: "website"`;
  - tag `website_booking`, or `test_booking` when `livemode` is false.
- **Deal:**
  - title "Half Day Pass – Jane Chan";
  - `status: "won"`, `closedAt` = event time, `value = amount_total / 100`, currency from Stripe;
  - transactional pipeline, in the stage flagged closed-won, else "Confirmed";
  - `source: "website"`;
  - `metadata: { stripeCheckoutSessionId, stripePaymentIntentId, paymentLink, productKey, livemode, isTest? }`.
- **Idempotent:** one deal per checkout session (unique index; migration `20261118-day-pass-purchases`). Repeated or parallel events never duplicate.
- **Test mode:** the deal is created with `metadata.isTest: true` and excluded from `/reports/periodic` (`dayPasses`, deals won/lost, value, new deals). No timeline entry for test purchases, the same rule as room bookings.
- **Timeline** (live only): "Bought a Day Pass (HK$250) on the website".
- **Shows in the CRM** under the contact's **Bookings & purchases**. No frontend change is needed.

**`plink_` map: not filled in yet.** The CRM owner has to run `npm run stripe:payment-links` once with `STRIPE_SECRET_KEY` set. The script is read-only. It lists the account's Payment Links, matches the three website URLs, and prints the exact `STRIPE_PAYMENT_LINK_PRODUCTS` value to add on Render. Until that value is set, day-pass checkouts are logged as `ignored`, as before.

**Sample processed event:** not available yet. It depends on the map above and on a test purchase.

## §4 Cancel / refund: CRM side built, waiting for WordPress

`POST /api/v1/room-bookings/:ref/cancel` (`bookings.write`), body `{ refund?: boolean, reason?: string }`:
- `refund: true` needs the admin role (`bookings.refund`).
- It calls WordPress `POST /bookings/{ref}/cancel` with the token and `{ refund, reason, by: "<staff> (CRM)" }`.
- It passes WordPress errors through (400/404/409, Stripe failure → 502), then re-syncs the ref. The re-sync also removes the CRM's Google Calendar event.
- Until the plugin has the endpoint, it returns **501** `WP_CANCEL_UNSUPPORTED` with "Cancel in WP Admin > Room Bookings for now". No CRM deploy is needed when WordPress ships.
- **Frontend:** a Cancel button (with a "Refund in full" option for admins) on the booking side panel can be added now. It shows the 501 message until WordPress is ready.
