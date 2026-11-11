# Room bookings: backend follow-up

**For:** whoever owns the CRM backend (`Banyan-CRM-BE`).
**Status (12 Nov 2026):** the frontend is done and merged to `main` in `dkt147/Banyan-CRM-Admin` (commit `05c4f89`). WordPress bookings still don't reach the CRM database because of the configuration and deployment gaps below. Section 1 is the blocker. Section 3 lists optional improvements.

## What we checked (12 Nov 2026)

| Check | Result |
|---|---|
| WordPress public API (`/availability`, `/checkout`, `/session`) | Works. CORS allows `http://localhost:5173` and `https://banyan-crm-admin.vercel.app`. |
| Existing booking in WordPress | `BNY-LDNMJ4`: medium room, Fri 13 Nov 2026, 10:00–12:00. This is the only taken slot `/availability` reports between Sep 2026 and Feb 2027, so the second booking is probably cancelled, expired or in the past. Only `GET /bookings` (needs the token) can confirm it. |
| Test checkout made through the API | `BNY-JL2ADC`: The Library, Fri 20 Nov 2026, 16:00–17:00, HK$888, Stripe **test** mode, email `test.booking@banyanworkspace.com`. It was `pending` and showed in `/availability` straight away. It expires about 35 minutes after creation unless someone pays it with `4242 4242 4242 4242`. |
| Local backend `GET /health` | OK, database connected. |
| Local `POST /api/v1/webhooks/banyan-bookings` | **503 "BANYAN_CRM_TOKEN is not configured."** |
| Local `.env` | **No `BANYAN_CRM_TOKEN`**. As a result, `runWpBookingSyncJob()` returns early, so there's no backfill and no 10-minute sync, and `POST /room-bookings/sync` returns 503. |
| Git | All room-booking backend files are uncommitted (`roomBookings.routes.js`, `wpRoomBooking.service.js`, the webhook controller, the migration and so on). The Vercel backend doesn't have them yet. |

This explains what the user saw: the booking list is empty, real bookings are missing, and payments don't show up in real time.

## 1. Required (blockers)

1. **Set `BANYAN_CRM_TOKEN`** in the local `.env` and in the Vercel backend environment. The value is in WP Admin → Room Bookings → Settings → API token. Then restart the server. The first sync run backfills from 60 days back to 90 days ahead.
2. **Commit and deploy the backend room-booking work**, then run `npm run migrate -- --apply` against the production database. This creates the unique `{ workspaceId, externalRef }` index.
3. **Set the webhook URL in WordPress:** WP Admin → Room Bookings → Settings → CRM API URL = `https://<deployed-api-host>/api/v1/webhooks/banyan-bookings`.
   - WordPress can't reach `localhost`. For local testing, run `npx ngrok http 5000` (or `cloudflared tunnel --url http://localhost:5000`) and use that HTTPS URL temporarily.
4. **Verify:**
   - In WP Admin, click "Resend to CRM" on `BNY-LDNMJ4`. It should flip to `sent`.
   - Run `POST /api/v1/room-bookings/sync` with body `{"from":"2026-11-01","to":"2026-11-30"}`. It should report `created` ≥ 1.
   - `GET /api/v1/room-bookings?status=all&range=all` should list `BNY-LDNMJ4` (paid, TEST) and `BNY-JL2ADC` (expired, or paid if someone paid it).

## 2. Small backend change already made (please review and keep)

`src/controllers/calendar.controller.js` → `bookingItem()` now also returns:

```js
externalRef: booking.externalRef || null,
wpStatus: booking.externalRef ? booking.metadata?.wp?.status || null : null,   // paid | pending | blocked | cancelled | expired | error
wpRoomKey: booking.externalRef ? booking.metadata?.wp?.roomKey || null : null, // small | medium | library
```

The frontend calendar uses these to style WordPress bookings (paid, awaiting payment, blocked), to open the read-only side panel, and to avoid showing a booking twice next to the live WordPress data. Before this change, `/calendar/week` didn't return `externalRef`. There's no test for it yet. Please add one to `tests/wp-room-bookings.test.js`.

## 3. Requested improvements (optional)

| # | Request | Why |
|---|---|---|
| a | Add `lastSync: { at, mode, created, updated, failed, error }` to `GET /room-bookings/config`. It's already stored in `Integration.config.roomBookings.lastResult`. | The frontend can then show "Last synced 3 min ago" or a sync error, not just "sync is off". |
| b | Make sync faster: either shorten the default `BANYAN_BOOKING_SYNC_MINUTES` to 2, or trigger an incremental sync from `GET /room-bookings` when the last one is more than 60 s old (single-flight, which `syncWpIncremental` already guarantees). | Webhooks only cover `paid` and `cancelled`. Pending holds, expiries and admin blocks otherwise take up to 10 minutes to appear. |
| c | Keep `POST /room-bookings/sync` behind `bookings.write`, but return its 503 as the plain message "WordPress sync isn't configured on the server (BANYAN_CRM_TOKEN)." | The frontend shows this message as it is. |
| d | Mark contacts created from `payment.mode = "test"` bookings, for example with the tag `test-booking`, or skip the timeline entry. | The test bookings created during setup (`BNY-LDNMJ4`, `BNY-JL2ADC`) would otherwise add contacts and activity to real data. |
| e | Optional: reject `POST /calendar/hold` and `POST /bookings` when `resourceName` is one of the three WordPress room labels, returning 409 "Book meeting rooms through WordPress". | These endpoints can still create CRM-only bookings for the three rooms that WordPress never sees, which risks double bookings. The frontend now points staff to the WordPress booking window, but the old forms still exist. |

## 4. What the frontend now expects (for reference)

- `GET /room-bookings/config` → `{ rest, rooms[], open, close, days, maxDays, holdMinutes, checkoutExpiresMinutes, enabled, returnUrl, notesPrefix, syncConfigured }`. The frontend shows a "WordPress sync is off" warning when `syncConfigured` is `false`, or when this call fails.
- `GET /room-bookings` with query `status` (`active|paid|blocked|pending|cancelled|expired|all`), `range` (`upcoming|past|all`), `room`, `search`, `from`/`to` (YYYY-MM-DD), `page`, `limit` ≤ 500.
- `GET /room-bookings/:ref` returns the side-panel data.
- `POST /room-bookings/sync` with `{ from, to }` is called after a CRM checkout is paid. With `{}` it's called by the "Sync from WordPress" button.
- `GET /calendar/week` items must include `externalRef`, `wpStatus` and `wpRoomKey` (section 2).
- The frontend also reads WordPress `/availability` directly (public, live). The calendar and the Meeting rooms tab therefore show taken hours even before the CRM has synced. Customer names, payment details and refs come only from the CRM cache, which is what this backend work provides.
