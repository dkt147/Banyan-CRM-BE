# Backend fixes from the 18 Nov 2026 browser QA

**For:** the CRM backend agent (`Banyan-CRM-BE`).
**From:** the CRM frontend (`Banyan-CRM-Admin`), 18 Nov 2026, after QA on https://banyan-crm-admin.vercel.app.

## Context: most "Not in UI" results are an old deploy

QA ran against the deployed frontend (commit `9686f8f`). None of the frontend work from the 17–18 Nov rounds was deployed yet:
- cancel/refund in the booking panel
- room calendar settings and partner blocks
- the Forms page and submissions
- the template preview and category list
- the tag catalogue and filters
- Reports by month and year
- the `/room-bookings/checkout` modal
- the "Synced N min ago" header

These will be deployed together with the fixes below. **No backend action is needed for them.**

Pass these corrections on to QA:

| QA tried | Correct |
|---|---|
| `GET /contacts?tags=a,b` | `GET /contacts?tag=a,b` (AND, max 10). This already works. |
| room calendar settings API "not found" | `GET/PUT /room-bookings/google-calendars` |
| `/reports`, `/reports/metrics` | `GET /reports/periodic` |

## Summary

| # | Change | Who | Size |
|---|---|---|---|
| 1 | Google OAuth `redirect_uri_mismatch` | Owner (Google Cloud) + check Render env | Config |
| 2 | Oversized template → clean `413`, and don't echo field values in Mongo errors | Backend | Small |
| 3 | Reject tags that normalise to nothing (`"!!!"`) | Backend | Small |
| 4 | Run the tag migration on production (`test-booking` → `test_booking`) | Backend | Run only |
| 5 | `timeline` on `GET /room-bookings/:ref` | Backend | Small–medium |
| 6 | Duplicate contact "Dev Zelektra" | Backend | Investigate |
| 7 | Verify the server-side 409 on `/room-bookings/checkout` | Backend | Test only |

Frontend fixes already made (in the same deploy):
- the Google connect buttons no longer hang;
- a template over 500 KB gets a clear message, both before saving and on a `400`/`413`;
- the tag editor explains invalid, duplicate and over-limit tags;
- the contacts list filters by several tags (AND);
- the room bookings list has a From/To date filter (uses the existing `from`/`to`), and its empty default view offers "Show all dates";
- the booking panel renders `timeline` once §5 lands.

---

## 1. Google OAuth: `redirect_uri_mismatch`

`GET /integrations/google/connect` works and returns `authorizationUrl`. Google then rejects it:

> Error 400: redirect_uri_mismatch

The redirect URI sent is:

```
https://banyan-crm-be-n69x.onrender.com/api/v1/integrations/google/callback
```

**Owner (Google Cloud Console → APIs & Services → Credentials → the OAuth client):**
- Add exactly that URI under *Authorized redirect URIs*.
- It takes a few minutes to apply.

**Backend (Render env):**
- `GOOGLE_REDIRECT_URI` must equal that URI.
- `CLIENT_URL` must be `https://banyan-crm-admin.vercel.app`. `integrationOAuth.controller.js` redirects to `${CLIENT_URL}/integrations?google_oauth=…`, and that page posts the result back to the opener. If it still points at `localhost:5173`, the popup lands on a dead page after a successful sign-in.

**Consent screen:**
- The scopes include `gmail.readonly` and `gmail.send` (restricted).
- If the Google Cloud project belongs to Banyan's Workspace, set the user type to **Internal** so no verification is needed.
- Otherwise, add the staff accounts as **test users** until Google verifies the app.

The frontend fix is unrelated to the cause. The CRM can't see errors Google shows in the popup, so it no longer waits on "Opening Google…". It shows a note telling the user to finish in the Google window or close it.

**Test:**
1. Go to Settings → Integrations → Connect.
2. Google consent appears.
3. After allowing, the popup closes and the CRM shows "connected".
4. QA tests T5 (Library calendar, partner blocks) and T7.3 (send email) after this.

## 2. Template body too large

`POST /templates` with a ~600 KB body returns `400 MONGO_VALIDATION_ERROR`, and Mongoose's `maxlength` message echoes the start of the body back.

**What to change:**
- **Templates:** when `body` (or `subject`) is over the limit, return **413**:
  ```json
  { "success": false, "code": "TEMPLATE_TOO_LARGE", "message": "This message is over 500 KB, the most an email can be." }
  ```
  Check `body.length > 512000` in the validator before saving.
- **`error.middleware.js`:** for `mongoose.Error.ValidationError` with `kind === "maxlength"`, use the message `` `${path}` is too long (max N characters). `` and never include the value. This applies to every model, not only templates, since values can contain personal data.

The frontend already checks 512,000 characters before saving, and maps both `413` and the old Mongo message to a friendly error.

## 3. Tags that normalise to nothing

`PATCH /contacts/:id` with `tags: ["vip", "!!!"]` returns 200 and drops `"!!!"` silently. That's because `normalizeTags` filters empty values *before* the Zod regex runs.

**What to change in `contact.validators.js` (and `form.validators.js` for `tagsToApply`):**
- If any input value normalises to `""`, fail validation with **400 `INVALID_TAG`**.
- Use the message `"!!!" can't be a tag. Use letters or numbers.`
- Put the bad values in `details: { invalid: ["!!!"] }`.
- Keep normalising valid input as now (`QA Tag` → `qa_tag`).

The frontend shows `message` as is.

## 4. Run the tag migration on production

`GET /contacts/tags` on production still lists `test-booking` (7 contacts) and `test_booking` (1 contact). Migration `20261117-crm-feedback` already normalises `test-booking` → `test_booking`. It has not been run on production.

1. Run a dry run first: `npm run migrate` (check `src/scripts/migrate.js` for the apply flag).
2. Check the log shows about 7 contacts changing.
3. Apply it against production.
4. Afterwards, `GET /contacts/tags` should show only `test_booking` (8).

This changes contacts' tag values only. It doesn't touch bookings or meetings.

## 5. Booking history on `GET /room-bookings/:ref`

The side panel has no history. Add `timeline`, oldest first, on the **single-booking** response only (not the list):

```js
timeline: [
  { at: "2026-11-18T07:02:11Z", text: "Booked via CRM by Banyan Admin" },
  { at: "2026-11-18T07:03:40Z", text: "Paid HK$250 (test mode)" },
  { at: "2026-11-18T07:03:41Z", text: "Added to Small room calendar" },
  { at: "2026-11-18T09:15:00Z", text: "Cancelled: QA test cancel", by: "Banyan Admin (CRM)" },
  { at: "2026-11-18T09:15:01Z", text: "Refunded HK$250 · re_3Ucwrk…" },
]
```

Build it from data you already store:
- `createdAt` and `channel`/`viaCrm`
- `payment.paidAt`
- `cancelledAt`/`cancelledBy`/`cancelReason`
- `payment.refund`
- `googleCalendar.syncedAt`/`action`/`error`
- any `Activity` rows linked to the booking

Shape: `{ at: ISO, text: string, by?: string }`. Return an empty array when there's nothing.

**Note for QA:** "No activity yet" on QA Test Alice's contact is expected. `activityFor` deliberately skips Stripe test-mode bookings, so they never appear on a contact timeline. The booking `timeline` above is separate and should include test bookings.

## 6. Duplicate contact "Dev Zelektra"

There are two contacts with the same email. Please:
1. Find how the second one was created (`source`, `createdAt`, and which booking/form/enquiry links to each).
2. Likely causes:
   - The webhook and the polled sync process the same new booking at once, and both `findOrCreateContact` calls create a contact. If so, use an atomic upsert on `{workspaceId, email}` or retry the find on a duplicate.
   - `findOrCreateContact` ignores archived contacts, so a new one is created.
   - The email differs only by whitespace or case on a path that bypasses the model's `lowercase`/`trim`.
3. Merge the two by hand. Keep the older contact and move its bookings, deals and activities across. Report back.

## 7. Check the server-side clash on checkout

QA confirmed the UI hides booked slots. They did not hit the server-side check. Please confirm that `POST /room-bookings/checkout` for a slot that's already paid or held returns **409**, with WordPress's message passed through. The modal shows that message and refreshes availability.

---

## Reply needed
- §1: confirm the redirect URI and `CLIENT_URL` on Render, and whether the consent screen is Internal.
- §2–§3: the deployed error codes.
- §4: the migration log (count changed).
- §5: an example `timeline` from a real booking.
- §6: the cause, and confirmation that the duplicate was merged.
- §7: the 409 result.

House rules:
- Don't change or delete existing meetings or test bookings in the shared room calendars; they are used with Banyan's partner.
- Don't send meeting invites.
- All times are Hong Kong time.
