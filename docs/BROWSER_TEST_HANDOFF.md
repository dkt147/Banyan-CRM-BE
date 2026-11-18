# Browser test handoff: Banyan CRM (18 Nov 2026)

**For:** a Claude agent testing the live CRM in a browser.
**Goal:** check that the features shipped between 11 and 18 Nov work end to end, and report what passes, what fails and what isn't in the UI yet.

---

## 1. Where things are

| What | URL |
|---|---|
| CRM admin (what you test) | https://banyan-crm-admin.vercel.app |
| CRM API (seen in DevTools → Network) | https://banyan-crm-be-n69x.onrender.com/api/v1 |
| Website (WordPress, room booking + forms) | https://banyanworkspace.com |
| WordPress admin | https://banyanworkspace.com/wp-admin → **Room Bookings** |
| Stripe test dashboard | https://dashboard.stripe.com/test/payments |

**Logins:** ask the user for a CRM **admin** login. If they have one, also ask for an **operator** (non-admin) login, for the permission checks. Ask for WordPress admin and Stripe access only if a test needs them. Never write passwords into reports.

**The server sleeps.** The API runs on Render's free tier. The first request after about 15 minutes idle can take 30–60 seconds. Wait and reload once before calling anything a failure.

---

## 2. Safety rules (read first)

This is the **live production CRM** with real customer data.

1. **Only touch records you created.** Name everything with the prefix **`QA Test`** (e.g. contact "QA Test Alice", email `qa+alice@example.com`). Don't edit, cancel or delete any other booking, contact, deal or event.
2. **Room bookings: test mode only.** The booking plugin uses Stripe **test** keys. Pay with `4242 4242 4242 4242`, any future expiry date, any CVC and any postcode. **If the Stripe page has no "Test mode" badge, stop and tell the user.** Don't enter a real card anywhere.
3. **Pick far-off dates.** Book at least 3 weeks ahead, on a weekday, mid-afternoon. Check the slot is free first so you don't block a real customer.
4. **Day passes (Stripe Payment Links) are live money.** Don't buy one. Only check the screens described in T9.
5. **Email:** only send to an address the user gives you, or to a `qa+…@example.com` address.
6. **Google Calendar:** don't add, move or delete events in the shared Library calendar unless the user says so (T5 explains).
7. **Clean up at the end** (section 5).

---

## 3. How to report

For each test give: **ID, Pass / Fail / Blocked / Not in UI**, and for anything other than Pass:
- what you did (steps), what you expected, what happened;
- the booking ref (`BNY-…`), form slug or record name;
- the failing request from DevTools → Network: method, path, status and response body (remove tokens);
- a screenshot if it helps.

**Not in UI** means the backend feature exists but the frontend has no button or field for it yet. The frontend agent is still working through `docs/FRONTEND_HANDOFF_2026-11-17.md`. If you can, confirm the API works by checking the Network tab or calling the endpoint from the browser console with the page's auth. Mark it "Not in UI (API OK)" or "Not in UI (API fails)".

Put the report in one markdown file and give it to the user. Order: failures first, then blocked, then not in UI, then passes.

---

## 4. Tests

### T1. Meeting rooms: list and sync (`/room-bookings`)

1. Open **Meeting rooms**.
2. Expected:
   - Bookings from the website appear, showing ref `BNY-…`, room (Small / Medium / Library), date, time, hours, customer and status (Paid / Pending / Cancelled / Expired / Blocked).
   - The header shows **"Synced N min ago"** (N is usually 2 or less). If it shows an error, record the text.
3. Filters: status, room, date range and search (name, email or ref) each narrow the list correctly.
4. Open one booking → the side panel shows customer, notes, payment (amount, currency) and the timeline.
5. Test bookings (made with Stripe test keys) carry the contact tag **`test_booking`**.

### T2. Create a booking from the CRM (staff checkout)

1. Meeting rooms → **New booking**. Pick the Small room, a free slot about 3 weeks ahead, 1 hour. Customer "QA Test Alice", `qa+alice@example.com`, notes "QA browser test".
2. Expected: you're sent to Stripe Checkout in **test mode**. Pay with `4242 4242 4242 4242`.
3. Back in the CRM (or after the modal's polling finishes), the booking shows as **Paid** within about 2 minutes. Record the ref.
4. Open it. The notes read **"Booked via CRM by <your staff name> – QA browser test"**.
5. In DevTools, the checkout request should be `POST /api/v1/room-bookings/checkout` (the backend route). If it calls WordPress `/checkout` directly from the browser instead, note it: the modal hasn't been switched yet (frontend item 5). That's not a failure.
6. A contact "QA Test Alice" exists, linked to the booking, tagged `test_booking`.
7. **Clash:** start a second booking for the same room and time. Expected: a clear "slot taken" message, and the modal goes back to choosing a time with availability reloaded.
8. **Rules:** try a Sunday or a past date. Expected: the date can't be picked, or a clear 400 message.

### T3. Cancel a booking from the CRM (WordPress plugin 1.2.x)

Use the paid booking from T2.

1. Log in as the **operator** (if you have one). Open the booking → Cancel. Expected: **"Refund"** is unavailable, or the request returns 403. Cancelling without a refund may be allowed. Don't confirm yet; go back to the admin login.
2. As **admin**: Cancel, tick **Refund in full**, reason "QA test cancel", confirm.
3. Expected:
   - Status **Cancelled**, showing the reason, who cancelled ("cancelled by" your name or staff), the time, and **"Refunded HK$…"** matching what you paid.
   - The timeline has "Booking cancelled by … (QA test cancel) – Refunded HK$…".
   - The Stripe test dashboard shows the refund on that payment.
   - The slot is free again in the booking modal or on the website calendar.
4. Click Cancel again on the same booking. Expected: success, with the same refund shown. **No second refund** appears in Stripe.
5. If the UI still says "Cancel in WP Admin" and has no button, mark it **Not in UI**. You can check the API from the console: `POST /room-bookings/<ref>/cancel` with body `{ "refund": true, "reason": "QA test cancel" }`.
6. Bad ref: `POST /room-bookings/bad/cancel` → 400. Unknown ref `BNY-NOPE00` → 404 "Booking BNY-NOPE00 not found."

### T4. Room calendar settings (Google Calendar)

Location: Meeting rooms → settings, or wherever "Room calendars" appears.

1. Open the settings. Expected: fields for the Small, Medium and Library calendar IDs; "Include pending holds"; "Show partner events"; "Block partner events in WordPress"; whether Google is **connected**; last sync; last error.
2. The Library field should hold the shared Library calendar ID (starting `c_682acafd…@group.calendar.google.com`). Small and Medium are expected to be empty for now.
3. **Don't change saved values** without the user's OK. To test validation, type `not-a-calendar` into the empty **Small** field and save. Expected: a clear 400 message (invalid calendar ID or not accessible), and nothing saved. Clear the field afterwards.
4. Under each room: "Adding bookings since <date>". **Preview older bookings** shows a read-only list with a note. There is **no** "add all" button.
5. If Google isn't connected: a message pointing to Settings → Integrations → Google.

### T5. Library bookings in Google Calendar and partner blocks

Only if T4 shows Google **connected** and the Library calendar saved. Otherwise mark **Blocked** and say why.

1. Book the **Library** as in T2 (test card, 3+ weeks ahead). Within about 2 minutes, the side panel shows **"In Library calendar"**, and the event is in the Library Google Calendar (open calendar.google.com if you have access). There are no attendees, so no invite emails go out.
2. Cancel it (with refund) as in T3. Expected: the Google event is removed within about 2 minutes.
3. If the panel shows a calendar **error** in red, click **Retry** (`POST /room-bookings/<ref>/google-calendar-sync`) and record the result.
4. **Partner blocks panel:** shows enabled, supported, number of blocks, last checked, and clashes. **Preview** lists what would be created or removed, without changing anything. Run **Sync now** only if the user agrees.
5. Only with the user's OK: the user (or partner) adds a 1-hour "QA partner test" event in the Library calendar 3+ weeks ahead. After **Sync now**, or within 10 minutes, the CRM list shows a **"Partner (calendar)"** block for that time, and the website shows that slot as unavailable. Deleting the Google event removes the block after the next sync.
6. **Calendar page (`/calendar`):** events imported from the room calendars are read-only. Try to edit or delete one. Expected: blocked, with "This event is in a shared room calendar and is read-only in the CRM" (409).

### T6. Website forms (`/forms`)

1. **Forms → Copy website enquiry form** (or New form). Name it "QA Test form" and save.
2. Edit a field label, save, reload → the change has stuck.
3. **Embed:** the snippet includes the hidden honeypot input `name="website"`, and the shortcode `[banyan_crm_form slug="…" key="…"]`.
4. **Submit from the website.** This needs a WordPress test page, so ask the user to publish the shortcode on a hidden or draft page, or do it yourself if you have WP admin. Submit with "QA Test Bob", `qa+bob@example.com`, and one service ticked. Expected:
   - you land back on the same page with **`?submitted=1`** and a thank-you message;
   - **Forms → Submissions** shows it as **processed**;
   - a contact "QA Test Bob" (tag `form_submission`), a deal in the matching pipeline, and a follow-up task exist.
5. Submit with the email left empty (if the form requires it). Expected: back on the page with `?form_error=…`, and the message is readable.
6. **Regenerate key:** shows a warning that existing embeds stop working. After you confirm, the old shortcode's submissions fail ("Form not found"). Only do this on the QA form.
7. **Delete** the QA form. If it has submissions, it's deactivated instead of deleted; that's expected.

### T7. Templates and email

1. **Templates:** create "QA Test template", category any, subject `Hello {{firstName}}`, and an HTML body with bold text and a link that uses `{{firstName}}` and `{{email}}`.
2. Preview (if there is one): the variables are filled in for a chosen contact.
3. Send it to "QA Test Alice" through the email composer (contact → Email → choose the template). **Only send if `qa+alice@example.com` is replaced by an inbox the user gives you.** Expected: success; the email arrives with formatting, the link works and the variables are filled (not literal `{{firstName}}`).
4. Category list includes **Renewal reminder** (`renewal_reminder`).
5. A huge body (over 500 KB, e.g. a pasted image as base64) → a clear "too large" message (413), not a crash.

### T8. Contacts: tags and related records

1. **Contacts** list: the tag filter lists tags with counts. Choose two tags → only contacts with **both** are shown.
2. Open "QA Test Alice" → add tag `QA Tag` → it's saved as `qa_tag` (normalised). An invalid tag shows a clear message.
3. Tag catalogue/help shows groups and descriptions, including `test_booking` and `form_submission`, which are marked automatic.
4. **Related records / Bookings & purchases** on a contact with a room booking: the booking appears once. For a contact with a won day-pass deal (ask the user for one, or search deals for "Day Pass"), the purchase appears once (no duplicates), labelled as a purchase.

### T9. Day passes (view only)

Don't buy anything.

1. Search deals for "Day Pass" or "10-Day Package". If any exist: title "Half Day Pass – <name>" (or Day Pass / 10-Day Package), status **Won**, value in HK$, stage Confirmed, and a linked contact.
2. If none exist yet, mark **Blocked (no purchases yet)**. Stripe setup on the client's side may not be finished.

### T10. Reports (`/reports`)

1. Monthly and yearly views load **without** an "Estimated" notice.
2. Metric tooltips show definitions.
3. Choose a range such as this year by month. Numbers appear per period (deals won, value, day passes, bookings…). Test bookings/purchases (`test_booking`) aren't counted. Compare deals won this month with the Deals list filtered to won this month; they should match roughly.
4. An invalid range (e.g. "to" before "from") shows a clear message.

### T11. Permissions (if you have an operator login)

As the operator:
- Refund on cancel → refused (T3).
- Saving room calendar settings → refused (403).
- Partner blocks **Sync now** → refused.
- Forms create/edit → check whether it's allowed; report what you see (needs `forms.manage`).

---

## 5. Clean-up

- Cancel every QA booking still paid or pending (with refund, as admin).
- Archive or delete the "QA Test" contacts, deals, tasks, the template and the form.
- Remove any `QA Tag` tags.
- Ask the user to remove the WordPress test page and any "QA partner test" Google event.
- List anything you couldn't clean up in your report.

---

## 6. Background (only if something looks odd)

- WordPress is the source of truth for room bookings. The CRM keeps a copy, synced every 2 minutes and on page loads. A change made in WP Admin shows in the CRM within about 2 minutes.
- Statuses never go backwards from webhooks (a Paid booking won't turn back into Pending).
- Hong Kong time (UTC+8) is used for dates and times.
- API reference: `docs/CRM_FEEDBACK_BACKEND_DONE.md`. Frontend to-do list: `docs/FRONTEND_HANDOFF_2026-11-17.md`.
