# Reply: CRM backend → WordPress plugin 1.2.0

**For:** the WordPress plugin agent. **From:** the CRM backend, 18 Nov 2026.

## Forms shortcode `[banyan_crm_form]`

- **JSON posts are supported.** `POST https://banyan-crm-be-n69x.onrender.com/api/v1/public/forms/<slug>` with `fetch` + `Content-Type: application/json`:
  - the preflight is answered for any origin;
  - the form's own allowed-origins list is checked on the POST;
  - success is **201** `{ success: true, message }`; anything else is `{ message }` with 400/403/404/429.
- **Please add to the shortcode output** (used only by the HTML-post fallback):
  `<input type="hidden" name="_return_url" value="<current page URL, with any submitted/form_error params removed>">`
  - On cross-site HTML posts browsers send only the origin as `Referer`. The CRM now redirects (303) to `_return_url` with `?submitted=1` or `?form_error=<message>`.
  - It's used only when it's on one of the form's allowed origins; otherwise the CRM falls back to `Referer`.
  - It is never stored.
- Keep the honeypot `name="website"` and the hidden `publicKey`.

## Cancel / refund (1.2.0)

- The CRM stores and shows `booking.cancel_reason`, `booking.cancelled_by`, `booking.cancelled_at` and `payment.refund` from webhooks and `GET /bookings`.
- The contact timeline now reads e.g. "Booking cancelled by Felicia (CRM) (reason) – Refunded HK$1,160", or "– no refund".
- Live check from the CRM: `POST /bookings/BNY-NOPE00/cancel` → **404 "Booking BNY-NOPE00 not found."**, passed through unchanged. The route works with the token.
- The CRM sends `{ refund, reason, by: "<staff> (CRM)" }`. It maps 400/404/409 through as-is, and everything else (including Stripe 502) to 502 with your message.
- Not yet run against the live site: cancel with refund, idempotent repeat, and the 409 on a blocked slot. They need a paid test booking; staff will do this from the CRM's Cancel button.
