# Backend follow-up: WordPress plugin 1.2.0 (cancel/refund, CRM forms shortcode)

**For:** the CRM backend agent (`Banyan-CRM-BE`).
**From:** the CRM frontend (`Banyan-CRM-Admin`), 18 Nov 2026, after the WordPress reply to `WEBSITE_CHANGES_HANDOFF.md`.

Plugin **1.2.0** is live on banyanworkspace.com:
- `POST /wp-json/banyan/v1/bookings/{ref}/cancel` is shipped and was tested end to end in test mode, including a real refund.
- The `[banyan_crm_form]` shortcode is shipped.
- The plugin contract is unchanged except for the additive fields in §1.

| # | Change | Size |
|---|---|---|
| 1 | Keep the new cancel/refund fields when syncing bookings | Small |
| 2 | Check `POST /room-bookings/:ref/cancel` against the live plugin | Test only |
| 3 | `_return_url` for HTML form posts | Small |
| 4 | Nothing to do: CORS for JSON form posts (checked) | – |

---

## 1. Sync the new cancel/refund fields

WordPress now sends these on the webhook and on `GET /bookings`, and they are `null` when not used:
- `booking.cancel_reason` (≤ 500 characters)
- `booking.cancelled_by` (≤ 100 characters, e.g. `"Felicia (CRM)"`)
- `booking.cancelled_at` (ISO)
- `payment.refund`: `{ id, amount, amount_minor, currency, status }` or `null`

`normalizeWpBooking` in `wpRoomBooking.service.js` (around lines 135–165) currently drops all of them. Please store them and return them from `toRoomBookingRow` (list and `GET /room-bookings/:ref`) under these names, which the frontend already reads:

```js
cancelReason: b.cancel_reason || null,
cancelledBy: b.cancelled_by || null,
cancelledAt: b.cancelled_at || null,
payment: { ...,
  refund: payment.refund ? {
    id: payment.refund.id, amount: payment.refund.amount, amountMinor: payment.refund.amount_minor,
    currency: String(payment.refund.currency || "HKD").toUpperCase(), status: payment.refund.status,
  } : null,
}
```

**Leave reports as they are.** `roomRevenue` and `roomHours` only count `status: "paid"`, so cancelled and refunded bookings already drop out.

**Timeline note:** on a cancellation, the timeline line in `wpRoomBooking.service.js` (~line 232) says "refund handled in Stripe". When `payment.refund.status === "succeeded"`, say "Refunded HK$<amount>". When `refund` is null on a paid booking, say "No refund".

## 2. Cancel from the CRM: check it now works

Your `cancelWpBooking` turns WordPress's `404 rest_no_route` into `501 WP_CANCEL_UNSUPPORTED`. With 1.2.0 the route exists, so the CRM's Cancel button (booking side panel) should now work with no deploy.

Please check it on a **test-mode** booking, since the plugin is currently on Stripe test keys (see the note at the end):
- **Cancel with refund (admin):** WordPress returns 200 with `refund.status: "succeeded"`. After the re-sync, the row shows `cancelled`, and the CRM's Google Calendar event is removed.
- **Cancel the same booking again:** 200, with the same refund ID.
- **Blocked slot:** WordPress returns 409. Pass the message through.
- **Errors:** WordPress's error statuses map as follows:

  | WordPress | CRM |
  |---|---|
  | 404 | 404 |
  | 502 (Stripe refund failed, booking unchanged) | 502, with the message |

## 3. `_return_url` for HTML form posts

The shortcode posts with `fetch` + JSON first, which already works (see §4). If that fails at the network level, it falls back to a normal HTML post. In that case `redirectBack` in `publicForms.routes.js` uses the `Referer`. On cross-site posts browsers send only the **origin** (`strict-origin-when-cross-origin`), so the visitor lands on the homepage instead of the form page.

Please change it as follows:
- Accept an optional body field `_return_url`.
- If its origin is in the form's allowed origins (same check as now), redirect there. Otherwise fall back to `Referer`.
- Strip `_return_url` from the stored payload, as with `publicKey` and `website`.

Then tell the WordPress agent to add `<input type="hidden" name="_return_url" value="<current page URL>">` to the shortcode output. The CRM embed snippet will add it too, for other sites.

## 4. CORS for JSON form posts: checked, nothing to do

A live preflight from `https://banyanworkspace.com` to `POST /api/v1/public/forms/website-enquiry` returns:
- `204`
- `access-control-allow-origin: https://banyanworkspace.com`
- `access-control-allow-headers: content-type`

`publicFormCors` reflects the origin, and the per-form origin check still applies on the POST. Please reply to the WordPress agent that JSON posts are supported.

---

## Notes for the CRM owner (not code)

- **The website room-booking plugin is on Stripe sandbox (test) keys.** The WordPress agent reports that the plugin's Stripe keys belong to the "Banyan workspace sandbox", which has no live account. If that is the plugin's live setting, website customers are paying in test mode, which means no real money. **Check WP Admin → Room Bookings → Settings → Stripe mode/keys** and switch to the live account's keys. In the CRM, test payments show a TEST badge and are left out of revenue.
- **Day passes:** the backend code is live. It needs someone with access to the **live** Stripe account (the one with the three `buy.stripe.com` links and the CRM's keys) to:
  1. run `npm run stripe:payment-links` and set `STRIPE_PAYMENT_LINK_PRODUCTS` on Render;
  2. subscribe the CRM webhook to `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`;
  3. turn on name and phone collection on the three links.

  The WordPress agent's Stripe login can't open that account.
