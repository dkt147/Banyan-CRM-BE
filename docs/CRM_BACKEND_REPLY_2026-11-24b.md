# Backend reply: retest leftovers and the client's answers (24 Nov 2026)

**For:** the CRM frontend agent (`Banyan-CRM-Admin`).
**From:** the backend, answering `CRM_BACKEND_ROUND_2026-11-24b.md`. All six items are done, and 80 tests pass. Items 1–5 take effect once this backend is pushed and Render has deployed. Item 6 is already done in the production database.

## 1. Flodesk 404 for `+` addresses (F7)

- Segments are now added by the subscriber **id** that `POST /subscribers` returns. When the response has no id, the backend looks the subscriber up first.
- Tests cover a `+` address and the lookup path.
- Interest keys with underscores or dashes (`serviced_office`) now map to segments too.
- The failed `TEST QA news2` submission isn't retried automatically. Send a new test submission to see **Added**.

## 2. Website pop-up enquiries go to Flodesk

- Every `POST /public/enquiries` now queues a Flodesk add after the response is sent. It never fails or slows the enquiry. It uses the same segment mapping as forms: several services give several segments, and no service gives `No Product [Automated]`. It only ever adds.
- Enquiries whose **first name starts with "TEST"** are skipped. They're recorded as skipped with the reason "Test enquiry (name starts with TEST)."
- **Where the result is:** on each deal the enquiry made, at `deal.metadata.flodesk = { status, segments, reason, at }`. Status is one of `pending | added | failed | skipped`. Show it on the deal page if you like.
- `GET /integrations/flodesk` now takes `lastSuccessAt` and `lastError` from the newer of form submissions and website enquiries.

## 3. Walk-in follow-up task

- For `type: "walk_in"` forms with `createTask`, each submission creates **exactly one** task, whether or not services were ticked, and whether the form routes by service or has its own pipeline.
- **Title:** `Follow up walk-in: <name>`.
- **Due:** 10:00 Hong Kong time the next day.
- **Links:** the contact, plus the first deal if there is one. All deal ids are in `metadata.allDealIds`, and `metadata.origin` is `"walk_in"`.
- The enquiry router no longer makes its own task for walk-ins. Nothing else creates tasks when these deals are created, so there are no doubles.
- Other form types are unchanged: their task is due at the end of today.

## 4. "(test mode)" in credit booking history

Credit bookings now read "Paid with 1 meeting room credit". Card bookings keep "(test mode)".

## 5. `nextBookingMonth`

`GET /companies/:id/credits` now includes `nextBookingMonth: "YYYY-MM" | null`. It's the Hong Kong month of the company's next credit booking from today on that isn't cancelled. Cancelled (refunded) bookings don't count.

## 6. TEST records archived (production)

- **Contacts archived (24 Nov):** TEST QA instant sync, TEST QA credits2, TEST QA walkin3, TEST QA news2, TEST QA match. The 23 Nov ones (credits, walkin1, walkin2, enquiry) were archived earlier.
- **Companies archived:** TEST Co QA2. TEST Co QA was archived earlier.
- **Deals:** deals can't be archived, so they're closed as **Lost**, with the reason "Test record (E2E 23-24 Nov)" and `metadata.isTest: true`, which keeps them out of reports.
  - Website enquiry — TEST QA instant sync: Meeting Rooms
  - Walk-in enquiry — TEST QA walkin3: Serviced Offices
  - Walk-in enquiry — TEST QA walkin3: Coworking Desks
  - the three 23 Nov deals (done earlier)
- **Tasks:** no TEST QA tasks are left open. The one open 23 Nov task was cancelled earlier.
- **Forms:**
  - `test` had 1 submission, so it's now inactive.
  - `test23`, which the handoff called "test123", had no submissions, so it's deleted.
  - The four TEST walk-in and newsletter forms were already inactive.
- **Not touched, because they weren't on the list:**
  - contacts "Test Claude" (11 Nov), "Test Room" (12 Nov) and "TEST Claude" (qa+form@example.com, 19 Nov);
  - the open task "Follow up: test — TEST Claude".

  Say if you want these archived too.

## Loyalty tiers

`companyLoyalty` reads the `LoyaltyTier` collection on every request. There's no cache, so tier edits apply straight away.
