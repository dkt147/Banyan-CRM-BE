# Frontend fixes from the 23 Nov E2E test

**For:** the CRM frontend agent (`Banyan-CRM-Admin`).
**From:** the backend, 24 Nov 2026, after the browser E2E test of 23 Nov (`WP_E2E_TEST_REPORT_2026-11-23.md`). F-numbers match that report.

The backend fixes and new fields below are in `Banyan-CRM-BE` (77 tests pass). They're live once the backend is pushed and Render has deployed. Until then, the new fields are simply missing, so fall back to what you show now.

## Summary

| # | What | Size |
|---|---|---|
| 1 | Credit bookings show "HK$0" in the bookings list (F1) | Small |
| 2 | Google Calendar state in the side panel is wrong after cancelling (F4) | Small |
| 3 | Credit adjustments show the wrong sign; credits card month (F5) | Small |
| 4 | Walk-in form: "Instagram" source option; all deals on a submission (F6) | Small |
| 5 | Wording and UX items (F9–F12, 6.1) | Small each |

---

## 1. Credit bookings in the bookings list (F1)

**New on every room booking row:**
- `payment.amountLabel` is now `"Meeting room credits (1 h)"` for credit bookings. Card bookings still say `"HK$250"`.
- `payment.stripeUrl` is `null` for credit bookings.

**Change:**
- **Amount column:** show `payment.amountLabel`. Don't format `payment.amount` yourself; that's where "HK$0" came from.
- **"Test" badge:** WordPress stamps every booking with the site's current Stripe mode, including credit bookings, so all bookings are "test" until launch. That's expected. For `payment.method === "credits"`, don't say "Test (excluded from revenue)". Credit bookings are never revenue, so show "Meeting room credits" instead of the revenue mode.

## 2. Google Calendar state in the side panel (F4)

The backend data was right: the three cancelled bookings had `eventId: null`, `action: "removed"`, `reason: "status_cancelled"`. The panel showed the raw key and, for two of them, an old "In room calendar".

**New on `googleCalendar`:**
- `status`: `"in_calendar" | "removed" | "not_in_calendar" | "error"`.
- `label`: ready to show, for example:
  - "In Meeting Room calendar";
  - "Removed from The Library calendar (cancelled)";
  - "Not in Meeting Room calendar: no calendar set for this room";
  - "Calendar update failed: …".
- `retry`: `true` only when the last update failed.

**Change:**
- Show `googleCalendar.label`. Show the **Retry** button only when `googleCalendar.retry` is `true`.
- **After Cancel succeeds,** reload the booking with `GET /room-bookings/:ref`, about 2–3 s later. The calendar removal runs just after the cancel response, and the panel kept the row from before the cancel.

## 3. Credits card (F5)

- **Sign:** ledger entries carry signed `hours`. The "TEST undo" adjustment is stored as `hours: -1`. Show each entry as follows:
  - `use`: "−N h";
  - `refund`: "+N h returned";
  - `adjust`: the sign of `hours`, so "+1 h" or "−1 h".
- **Month:** the card opens on the current month, but credits count by the **booking's** month, so December bookings didn't show. Suggestions:
  - put next and previous month buttons on the card;
  - or open on the month of the company's next upcoming credit booking, when there is one.

## 4. Walk-in form (F6)

- **"How did you hear about us?":** add **Instagram** to the options in the walk-in template. Facebook and LinkedIn are worth adding too. The reports' lead-source grouping already treats them as Social. Existing forms keep their options until edited.
- **Deal source:** walk-in deals now have `source: "walk_in"` (it was `website`). Nothing to change unless you hard-coded labels.
- **Submissions list:** each submission now has `dealIds` (populated with `{ _id, title }`) as well as the first `dealId`. Show all of them in the DEAL column, since a walk-in with services in two pipelines makes two deals.

## 5. Wording and UX

- **F9 Source column:** use the new row field `channelLabel`, for example:
  - "Website checkout · booked via CRM";
  - "WP Admin";
  - "Meeting room credits · booked via CRM".
  
  Concatenating `channel` and `viaCrm` is what produced "webCRM".
- **F9 Loyalty page:** remove the internal text "Configured from MongoDB".
- **F10:** the "Form created" message says "Use 'Embed'", but the button is called "Share". Make them match.
- **F11 Preview:** checkboxes render above their labels. Put them beside the labels, as the website does.
- **F11 Page titles:** the website page title is `design.title || name`, as specified. For test forms, put "TEST" in the design title. Optionally, make the editor show the title the page will get.
- **F12 "What's next?":**
  - The prompt only appears when a task is completed from the task page. The **Complete** button in the Tasks list should show it too.
  - The "Next task created" banner from the previous task is still shown on the new task's page. Clear it.
- **F12 Tasks on stage change:** moving a deal's stage created two follow-up tasks automatically. Check whether that's the "Next:" bar or an automation rule, and whether two is intended.
- **6.1 Won/Lost:** the stage bar has no Won/Lost controls, so those rules couldn't be tested. Add them, or say where they are.

## Not frontend (for your information)

- **F3:** a booking with a **different email** no longer attaches to a contact just because the phone matches. It does when no email is given, or when the matching contact has no email.
- **F7:** newsletter and contact forms never create deals any more, even when they have an interests field, so "Unsupported enquiry service: Coworking" can't happen again. Walk-in forms ignore service names the CRM doesn't know (they stay on the submission). "Coworking", "Private office", "Venue hire" and "Podcast services" are now recognised.
- **F2, F8 and the rest of F7/F9:** WordPress side (`docs/WP_E2E_FIXES_2026-11-24.md`).
