# Handoff: Banyan Room Booking plugin ↔ Banyan CRM

**For:** the Claude agent maintaining the WordPress plugin **Banyan Room Booking** on banyanworkspace.com.
**From:** the CRM backend (`Banyan-CRM-BE`, Node/Express on Render).
**Date:** 17 Nov 2026

The CRM integration with your plugin is live. This file covers:

1. what the CRM relies on (don't break it);
2. one new feature we need from you (§3, **required**);
3. some optional improvements (§4);
4. how to test the work together (§5).

---

## 1. Live setup

| | |
|---|---|
| CRM API | `https://banyan-crm-be-n69x.onrender.com/api/v1` |
| CRM webhook (your push) | `https://banyan-crm-be-n69x.onrender.com/api/v1/webhooks/banyan-bookings`. Enter it in **WP Admin → Room Bookings → Settings → CRM API URL** if it isn't there yet. |
| CRM admin UI | `https://banyan-crm-admin.vercel.app` (calls your public endpoints straight from staff browsers) |
| Shared secret | The plugin's **API token** (Settings). The CRM has it as `BANYAN_CRM_TOKEN`. **Don't regenerate it** without telling the CRM owner: webhooks and sync stop at once until the CRM env is updated. |

## 2. Contract the CRM depends on (please keep stable)

Additive changes are fine. Renaming, removing or changing the meaning of any of these breaks the CRM.

**Push webhook** (`booking.paid`, `booking.cancelled`):
- `POST` JSON with headers:
  - `X-Banyan-Event`;
  - `X-Banyan-Token`;
  - `X-Banyan-Signature`: hex HMAC-SHA256 of the **exact raw body**, keyed with the token.
- The CRM verifies against the raw bytes, so escaped slashes (`https:\/\/`) are fine. The signature just has to match what you send.
- The CRM replies 2xx `{ ok, id, ref, created }`. Anything else means "failed", so "Resend to CRM" must keep working.
- The CRM upserts by `booking.ref`, so resends are safe.

**Payload shape** (webhook and `GET /bookings` items), as documented in `CRM_BOOKING_INTEGRATION_README.md`:
- `booking.{ref, status, channel, room_key, room_name, date, start_time, end_time, hours, start_iso, end_iso, created_at}`
- `customer.{first_name, last_name, email, phone, notes}`
- `payment.{provider, mode, amount, amount_minor, currency, status, paid_at, stripe_session_id, stripe_payment_intent}`
- Statuses: `paid | pending | cancelled | expired | blocked | error`.
- Notes starting with `Booked via CRM by …` mark CRM-made bookings.

**Token endpoint:** `GET /bookings` with `status`, `from`, `to`, `updated_since`. The CRM polls `updated_since` every 2 minutes. Please make sure **every** status change updates the row's "updated" timestamp: pending → expired, admin blocks, and cancellations. Webhooks only cover paid/cancelled, so this poll is how the CRM learns about the rest.

**Public endpoints** used from CRM staff browsers (`banyan-crm-admin.vercel.app` and `http://localhost:5173` must stay CORS-allowed):
- `GET /availability`
- `POST /checkout` (CRM sends `return_url` on banyanworkspace.com)
- `GET /session`

**Rules hard-coded in the CRM:**
- rooms `small`/`medium`/`library` at HK$250/580/888 per hour;
- Mon–Fri, 09:00–18:00, whole hours;
- 90-day window;
- 35-minute hold.

If an admin changes any of these, tell the CRM owner.

---

## 3. REQUIRED: partner blocks endpoint

**Why.** CRM room bookings are now copied into a shared **Library Google Calendar** that a partner also uses. The partner adds their own meetings there, and WordPress doesn't know about them, so the website can sell those hours. The client chose to fix this by turning partner meetings into **WordPress blocked time automatically**. The CRM side is built and tested, and stays off until these endpoints exist.

Both endpoints are **token-protected** (`X-Banyan-Token`, same check as `GET /bookings`). Return 401/403 without a valid token.

### `POST /wp-json/banyan/v1/blocks`

```json
{
  "room": "library",
  "date": "2026-11-23",
  "start": 14,
  "hours": 2,
  "reason": "Partner: Board meeting",
  "external_id": "gcal:abc123:2026-11-23"
}
```

| Field | Rules |
|---|---|
| `room` | `small` · `medium` · `library` |
| `date` | `YYYY-MM-DD`, open day (Mon–Fri). **Not** limited by the 90-day window. Today is fine even if the hours have passed. |
| `start` | int 9–17 |
| `hours` | int ≥ 1, `start + hours ≤ 18` |
| `reason` | string ≤ 200. Store it as the block's notes. |
| `external_id` | string ≤ 120. **Idempotency key**, unique per block. |

Behaviour:
- **Create a block exactly like WP Admin → Block time does:**
  - `status = blocked`, `channel = admin`, `first_name = "Blocked"`, `notes = reason`;
  - it must appear in `/availability` and `GET /bookings`.
- **Idempotent:** if a block with this `external_id` exists, return it with 200 and don't create a second one.
- **Clash check:** under the same DB lock as `/checkout`, if any requested hour overlaps a **paid** or **pending** (unexpired hold) booking, create nothing. Return 409.
  - An overlap with an existing **block** is not a clash. Create it anyway, or merge, as you prefer.
- **Don't** send any email or create a Stripe session.
- **Don't** push a webhook for it. The CRM picks blocks up through `updated_since`.

Responses:
- **201** `{ "ref": "BNY-XXXXXX" }`, or **200** with the existing ref when `external_id` matches.
- **409** `{ "message": "…", "conflicts": ["BNY-…"] }`. The CRM shows these clashes to staff to resolve by hand.
- **400** `{ "message": "…" }` for validation errors (field named in the message).

### `DELETE /wp-json/banyan/v1/blocks/{ref}`

- If `ref` is a block (`status = blocked`), remove or cancel it and return **200** `{ "ok": true }`. The hours become free again.
- **404** if the ref doesn't exist. **409** if the ref is **not** a block. The CRM must never be able to delete a customer booking through this endpoint.

### Also

- Add `external_id` to the `booking` object in `GET /bookings` (null for normal bookings and manual blocks).
- Blocks made this way can still be removed by hand in WP Admin. The CRM recreates one only if the partner event still exists and changes.

### How the CRM calls it (for context)

Every 10 minutes, when an admin has switched it on, the CRM:
1. reads the room calendars for the next 90 days. It skips its own booking events, cancelled events and events marked "free".
2. rounds each partner event outwards to whole hours within 09:00–18:00, one block per weekday. For example, 10:30–11:15 becomes `start: 10, hours: 2`.
3. calls `POST /blocks` for new or changed events and `DELETE /blocks/{ref}` for removed or changed ones.

Until your endpoint exists, the CRM gets 404 `rest_no_route`. It then stops, shows "WordPress doesn't support automatic blocks yet", and retries every 6 hours. **No CRM deploy is needed when you ship.**

---

## 4. Optional improvements (nice to have, in priority order)

| # | Change | Benefit for the CRM |
|---|---|---|
| a | Webhook events for `booking.pending`, `booking.expired`, `booking.blocked`, same payload and signing | Holds, expiries and admin blocks appear in the CRM instantly instead of after up to 2 minutes. The CRM already accepts any `X-Banyan-Event`. |
| b | `session_id` in the `POST /checkout` response | The CRM stops parsing it out of the Stripe URL. |
| c | `GET /bookings?ref=BNY-…` | Faster single-booking refresh. |
| d | Exempt requests carrying a valid `X-Banyan-Token` from the 12-per-10-min `/checkout` limit | Staff making many phone bookings won't hit 429. |
| e | `POST /bookings/{ref}/cancel` (token) with an optional Stripe refund | Staff can cancel paid bookings from the CRM. |

If you build any of these, list them in your reply so the CRM can use them.

---

## 5. How to test together

1. **Webhook:** in WP Admin → Room Bookings, click **Resend to CRM** on `BNY-LDNMJ4`. Expect `sent`, and a CRM response like `{"ok":true,…,"ref":"BNY-LDNMJ4"}` in your log.
2. **Blocks endpoint, by itself**, with the token in `$TOKEN`. Use a future weekday with no bookings, e.g. `2026-12-01`:

```bash
API=https://banyanworkspace.com/wp-json/banyan/v1
# create → 201 { ref }
curl -s -X POST "$API/blocks" -H "X-Banyan-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"room":"library","date":"2026-12-01","start":14,"hours":2,"reason":"Partner: test","external_id":"test:1"}'
# same again → 200, same ref (idempotent)
# /availability?room=library&month=2026-12 → "2026-12-01": [14,15]
# without token → 401/403
# over a paid booking (e.g. BNY-LDNMJ4's slot if still upcoming) → 409 with conflicts
# DELETE "$API/blocks/<ref>" → 200; hours free again in /availability
# DELETE on a customer booking ref → 409
```

3. **End to end with the CRM:** when 2 works, tell the CRM owner. They switch on **"Block partner events in WordPress"** in the CRM (Meeting rooms tab), add a test event in the Library Google Calendar, and run **Preview → Sync**. Expect a new block in WP Admin with reason `Partner: …`. Deleting the Google event removes the block within about 10 minutes.

## 6. Reply with

- The status of §3, with example request and response bodies from your implementation.
- Any of §4 you built.
- Anything in §2 you need to change, and why.
