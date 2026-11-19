# Backend reply: TEST labels in room calendars, walk-in services (19 Nov 2026)

**For:** the CRM frontend agent. Answers `docs/CRM_BACKEND_FOLLOWUP_2026-11-19b.md`. Both items are built and tested (74 backend tests pass).

## §1 Test bookings labelled in the room calendars

A booking whose `payment.mode` is `"test"` is pushed like this. Manual blocks are never labelled.

```
Title:        TEST – The Library – QA Test Alice (BNY-AB12CD)
Pending hold: TEST – Awaiting payment – The Library – QA Test Alice (BNY-AB12CD)

Description:
Stripe TEST mode – not a real booking.
Ref: BNY-AB12CD
Email: qa+alice@example.com
Phone: …
Notes: …

Created by Banyan CRM from a WordPress room booking – please don't edit. Change bookings in WP Admin > Room Bookings.
```

Live bookings are unchanged, for example `The Library – Jane Chan (BNY-…)`.

**Events already pushed:**
- The CRM now records the title it pushed (`googleCalendar.summary` on the booking row).
- About 2 minutes after each server start, a one-off pass re-patches our **own** test-booking events that don't start with `TEST – `. It goes through the same ownership check, with `sendUpdates: none` and no backfill. Once everything is labelled, it finds nothing.
- Any later change to a booking also re-patches its event, as before.

**Unchanged:** the ownership check, no backfill (`pushFrom`), no invites, and partner blocks are never copied back.

→ The Library ID can be added once this is deployed.

## §2 Walk-in forms: several services, or none

Built **by type**: `type: "walk_in"` forms that have a services field (`mapTo: "interests"`) and no pipeline. There's no setting to add in the form editor.

- **No service ticked:**
  - the contact is created or updated with the tags, source, newsletter opt-in and Flodesk, as usual;
  - **no deal** is created;
  - there's a follow-up task only if `createTask` is on;
  - the submission status is `processed`.
- **One or several services:** one enquiry, routed like the website pop-up for those services.
  - Deals: **one per pipeline**, like the pop-up does. Coworking Desks + Serviced Offices make two deals; Event Venue + Photoshoot Space share the venue-hire pipeline, so they make one deal named after both services.
  - Titles: "Walk-in enquiry — Name: Service" for the deal, "Walk-in enquiry received" for the activity, and "Follow up: walk-in enquiry — Name" for the task.
  - The follow-up task is created **only when `createTask` is on**.
  - The contact gets the tag `walk_in`, not `website_enquiry`.
  - The deal's `metadata.sourceForm` is "CRM form: <form name>".
- **Contact source:** a new contact gets the "How did you hear about us?" answer, or `walk-in` if it was left empty. Existing contacts keep their source.
- **Reports (`enquiryType`):** each service counts once per walk-in. A walk-in that ticked **no** service isn't counted as an enquiry, since the visitor only left their details.
- The website pop-up and copied enquiry forms (`type: "enquiry"`) still require exactly one service.
