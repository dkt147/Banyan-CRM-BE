# Browser re-test: backend fixes live (18 Nov 2026)

**For:** the browser QA agent. This builds on `docs/BROWSER_TEST_HANDOFF.md`; the same safety rules apply (live CRM, only "QA Test" records, Stripe test card only, no real purchases, nothing changed in the shared Google room calendars, no invites).

**Backend:** `main` at `cec0ef7`, deployed on Render (https://banyan-crm-be-n69x.onrender.com/api/v1). Allow a few minutes after the push, and up to 60 s for the first request after the server has been idle.

**Frontend:** some of the screens below come with the next frontend deploy. If a screen is still missing, mark it **Not in UI** and check the API in DevTools → Network instead.

## Corrections to the first run

| You tried | Use instead |
|---|---|
| `GET /contacts?tags=a,b` | `GET /contacts?tag=a,b` (contacts that have all of them, max 10) |
| room calendar settings "not found" | `GET` / `PUT /room-bookings/google-calendars` |
| `/reports`, `/reports/metrics` | `GET /reports/periodic?from=YYYY-MM&to=YYYY-MM` |

---

## R1. Google connect (was: `redirect_uri_mismatch`, then `INVALID_OAUTH_STATE`)

1. Settings → Integrations → Google → **Connect**, as an admin. Finish Google's consent in the popup within 20 minutes.
2. Expected: the popup closes and the CRM shows Google as **connected**.
3. If it fails, the popup now returns to the CRM's Integrations page with `google_oauth=error`, plus a code and message in the URL (`google_oauth_code`, `google_oauth_message`). Record both. The CRM may show only a general "failed" message until the frontend reads them; if so, read them from the popup's address bar before it closes, or ask the user to check the Render logs for a line starting `[oauth]`.
4. Meaning of the codes:
   - `INVALID_OAUTH_STATE` + "started on a different server, or before the server's OAuth secret changed": the backend's `INTEGRATION_OAUTH_STATE_SECRET` on Render changed while you were signing in, or the CRM is talking to a different backend. Retry once; if it happens again, report it.
   - `INVALID_OAUTH_STATE` + "expired": you took over 20 minutes. Retry.
   - `GOOGLE_OAUTH_FAILED`: Google refused the code exchange. The Render log line shows Google's reason (e.g. `invalid_grant`, `redirect_uri_mismatch`).
5. Click Connect twice in a row, then finish only the second popup: it should still connect.
6. Once connected, run the blocked tests from the first handoff: **T4–T5** (room calendar settings, Library calendar, partner blocks preview; no Sync now without the user's OK) and **T7.3** (send a template email to the inbox the user gives you).

## R2. Template too large

1. Templates → New → paste over 500 KB of text into the body → Save.
2. Expected: a clear "over 500 KB" message. In Network: **413**, `code: "TEMPLATE_TOO_LARGE"`. The response must **not** contain any of the pasted text.
3. Same when editing an existing QA template.

## R3. Invalid tags

1. On "QA Test Alice", add the tag `!!!` together with a valid one, then save.
2. Expected: the save is refused with **`"!!!" can't be a tag. Use letters or numbers.`** (400, `code: "INVALID_TAG"`, `details.invalid: ["!!!"]`). Nothing is saved, so the valid tag isn't added either.
3. `QA Tag` is still accepted and stored as `qa_tag`.

## R4. Test-booking tag cleaned up

1. Contacts → tag filter.
2. Expected: only **`test_booking`** (7 contacts). `test-booking` is gone.

## R5. Booking history in the side panel

1. Meeting rooms → open **BNY-SMLPJH** (the QA booking cancelled earlier). If the panel doesn't show a history yet, check `GET /room-bookings/BNY-SMLPJH` in Network.
2. Expected `timeline`, oldest first:
   - Booked via CRM by Banyan Admin
   - Paid HK$250 (test mode)
   - Cancelled: QA test cancel — by Banyan Admin (CRM)
   - Refunded HK$250 · re_3Ucwrk…
3. Open any other booking: the history matches what you know about it (booked on the website / in WP Admin, paid, cancelled, refunded). After Google is connected, Library bookings also show "Added to Library room calendar".
4. The bookings **list** response does not include `timeline` (only the single booking does).

## R6. Duplicate contact

1. Search contacts for "Dev Zelektra".
2. Expected: **one** contact, with booking BNY-JDHM2J linked. The empty duplicate was removed.
3. New check (optional): make one test booking on the website with a new `qa+race@example.com` address. After it's paid and synced (about 2 minutes), exactly **one** contact exists for that email.

## R7. Checkout clash (server side)

The backend passes WordPress's 409 through unchanged; this was tested with a fake WordPress, not live.

1. Only if it can be done without blocking a real customer: in DevTools console, send `POST /room-bookings/checkout` for a slot that already holds one of **your own** QA bookings (paid or pending), using the page's normal auth.
2. Expected: **409** with WordPress's "slot taken" message. In the modal: the message shows, you're returned to choosing a time and availability reloads.
3. If you can't do it safely, mark it **Skipped**.

## Report

Same format as before: ID, Pass / Fail / Blocked / Not in UI / Skipped; for failures, the steps, the request (method, path, status, response body without tokens) and a screenshot if useful. Then clean up as in section 5 of the first handoff.
