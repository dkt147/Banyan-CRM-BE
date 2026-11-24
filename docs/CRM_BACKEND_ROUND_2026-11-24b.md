# Backend: retest leftovers and the client's answers (24 Nov 2026)

**For:** the CRM backend agent (`Banyan-CRM-BE`).
**From:** the CRM frontend, after the 24 Nov retest (`F` numbers match `WP_E2E_TEST_REPORT_2026-11-23.md`) and the client's answers to our 19 Nov questions.

The frontend for this round is already pushed. Where it needs a new field, it falls back cleanly until you ship.

## Summary

| # | What | Why | Size |
|---|---|---|---|
| 1 | Flodesk: add to segments by subscriber **id**, not email | F7 still fails with a 404 | Small |
| 2 | Website pop-up enquiries go to Flodesk by interest | Client: "Yes, right away" (replaces the Zapier zap) | Medium |
| 3 | Walk-in follow-up task: always one, due **the next day** | Client answer 5 | Small |
| 4 | Credit booking history says "(test mode)" | Retest leftover | Small |
| 5 | `nextBookingMonth` on the company credits response | Retest leftover (the card opens on the wrong month) | Small |
| 6 | Archive the TEST records | Clean-up | Small |

---

## 1. Flodesk 404 when adding segments (F7)

The retest submission `TEST QA news2` (`devzelektra+news2@gmail.com`, form `test-newsletter-qa2`, 24 Nov 07:50 HKT) was Processed, but its Flodesk status is **Failed**:

```
Flodesk POST subscribers/devzelektra%2Bnews2%40gmail.com/segments returned 404: Not Found
```

`flodesk.service.js` line 142 builds the segments path from the encoded email. Flodesk doesn't find the subscriber by a `+`-encoded address. Fix:

1. Read the subscriber `id` from the `POST /subscribers` response (line 139). Use it for `POST /subscribers/{id}/segments`.
2. If the response has no `id`, look the subscriber up with `GET /subscribers/{email}`, then use that id.
3. Add a test with a `+` address.

Afterwards, a retry of the failed submission (or a new one) should show **Added** with segment `Coworking [Automated]`.

## 2. Website enquiries to Flodesk (client answer 1)

> "Yes it should go to Flodesk right away."

Today a Zapier zap adds pop-up enquiries to Flodesk. The client will turn the zap off once the CRM does it.

- **When:** for every website pop-up enquiry the CRM receives (`publicEnquiry.service.js`), after the contact is saved. Use the same fire-and-forget path as forms. A Flodesk failure must never fail or slow down the enquiry.
- **Segments:** the same mapping as forms:

  | Service | Segment |
  |---|---|
  | Coworking / day pass | `Coworking [Automated]` |
  | Serviced / private office | `Serviced Office [Automated]` |
  | Virtual office / misc | `Misc Products (Virtual Office) [Automated]` |
  | Event space / venue | `Event Space / Venue Hire [Automated]` |
  | Podcast | `Podcast Services [Automated]` |
  | No service | `No Product [Automated]` |

  Several services give several segments. Add only; never remove a subscriber from a segment.
- **Consent:** the client confirmed every enquiry goes to Flodesk, as with Zapier today. Skip test enquiries (TEST names) only if that's easy; it isn't required.
- **Record the result** on the enquiry or contact in the same `{ status, segments, reason, at }` shape, so staff can see it. Include website enquiries in `GET /integrations/flodesk` → `lastSuccessAt` / `lastError`.
- **Duplicates:** Zapier and the CRM may both add the same person for a while. That's fine, because both are add-only.

Tell us when it's live, so the user can check one enquiry in Flodesk and switch the zap off.

## 3. Walk-in follow-up task (client answer 5)

> "Create a task automatically to follow up the day after."

- For `type: "walk_in"` forms with `createTask` (the frontend's walk-in template now turns it on by default), create **exactly one** task per submission. This applies whether or not services were ticked.
- **Due:** the next day at 10:00 Hong Kong time. Today it's `endOfDayInTimeZone(new Date())`; keep that for other form types.
- **Title:** `Follow up walk-in: <name>`.
- **Links:** the contact, plus the first deal if there is one.
- **Check for doubles:** the routed path passes `createTask: Boolean(form.createTask)` into the enquiry router (`formSubmission.service.js` around line 248), and the `if (form.createTask)` block around line 284 also creates a task. Make sure a walk-in with two services doesn't end up with two or three tasks.

## 4. "(test mode)" in credit booking history

The side panel's History for a credits booking reads "Paid with 1 meeting room credit **(test mode)**". Credit bookings never involve Stripe, so drop the mode suffix for `payment.method === "credits"`. It's fine to keep it for card bookings.

## 5. `nextBookingMonth` on company credits

The credits card opens on the current month, but credits count by the **booking's** month. A December booking made in November isn't visible until staff press ›.

- Add `nextBookingMonth: "YYYY-MM" | null` to `GET /companies/:id/credits`: the month of the company's next upcoming (today or later, HK time) credit booking that isn't cancelled.
- The frontend already reads it. On first open, it jumps to that month if the current month has no entries.

## 6. Archive the TEST records

**Archive** them (don't delete), and touch nothing else:
- **Contacts:**
  - from 24 Nov: `TEST QA credits2`, `TEST QA walkin3`, `TEST QA news2`, `TEST QA match`, `TEST QA instant sync`;
  - plus the TEST contacts listed in `WP_E2E_TEST_REPORT_2026-11-23.md`.
- **Companies:** `TEST Co QA2`, plus `TEST Co QA` from 23 Nov.
- **Deals:**
  - "Walk-in enquiry — TEST QA walkin3: Coworking Desks";
  - "… Serviced Offices";
  - "Website enquiry — TEST QA instant sync: Meeting Rooms";
  - plus the TEST deals from 23 Nov and their open TEST tasks.
- **Forms:** `TEST walk-in`, `TEST walk-in 2`, `TEST newsletter`, `TEST newsletter 2`, and the older `test` and `test123`. Delete a form if it has no submissions; otherwise leave it inactive.

Reply with what you archived.

---

## For information: client answers, no backend change now

- **Credits (answer 2):**
  - No rollover, and the allowance resets on the 1st. That's already built.
  - Each company's hours are fixed when the agreement is signed. Staff set them on the company page for now. A Day Pass allowance works similarly, and the client will explain it on a call. Expect a follow-up round for Day Pass allowances, and possibly setting credits from the agreement.
- **Loyalty (answer 3):** the client is fine with the placeholder tiers as long as they can edit them. The frontend now has Add, Edit and Delete for tiers through the existing `/loyalty-tiers` routes. Make sure the company tier calculation reads the current tiers, not a cached copy.
- **Entity field (answer 4):** not needed.
- **Members and cards (answer 6):** members always book through the front desk with credits, never by card. Maybe later: a website option for members to book with their credits, which would need WordPress and backend work. Not now.
- **Stage-change tasks:** the automatic "Follow up: … — <stage>" task on every stage change (and the extra "Quote follow-up") stays as it is until the client answers.
