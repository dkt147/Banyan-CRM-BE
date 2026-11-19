# Backend follow-up: test events in room calendars, walk-in services

**For:** the CRM backend agent.
**From:** the CRM frontend, 19 Nov 2026. This follows your reply to `CRM_BACKEND_ROUND_2026-11-19.md`; everything in that reply is wired into the frontend.

| # | Change | Size |
|---|---|---|
| 1 | Label Stripe test-mode bookings "TEST" in the room Google Calendars | Small |
| 2 | Walk-in forms: allow several services, or none | Small–medium |

---

## 1. Label test bookings in the room calendars (blocks the Library calendar)

The client gave us the three room calendars (all owned by `info@banyanworkspace.com`). **The Library calendar is in live use by Banyan's partner.** The client's rule is that any test event must be clearly labelled as a test.

The problem is in `roomCalendar.service.js`. `desiredCalendarState` and `eventBodyFor` push Stripe **test-mode** paid bookings exactly like real ones, e.g. "The Library – QA Test Alice (BNY-…)". Every booking is test mode until launch, so any QA booking of the Library would put an unlabelled event in the partner's live calendar.

**Change:**
- When `wp.payment?.mode === "test"`, prefix the summary with `TEST – `, e.g. `TEST – The Library – QA Test Alice (BNY-…)`.
- Add `Stripe TEST mode – not a real booking.` as the first line of the description.
- Re-patch already-pushed events when their title changes. They're our own events, so `ownedEventWrite` allows it.
- Add a test for the title.

**What stays as it is:**
- the ownership check;
- no backfill (`pushFrom`);
- `sendUpdates: "none"`;
- partner blocks are never copied back.

The Library ID will only be entered once this is live. The small and large meeting room calendars are being set now.

## 2. Walk-in forms: several services, or none

The client's walk-in form (a copy of the HubSpot form she uses on the iPad today) has **"Products / services" as checkboxes**. Visitors often tick several, or none: a day-pass visitor may just leave their details.

With your current routing, a form with an `interests` field and no pipeline returns 400 unless exactly one service is ticked. Please change it, for `type: "walk_in"` forms only:
- **No service ticked:** create or update the contact (tags, source, newsletter opt-in, Flodesk) with **no deal**. Status `processed`.
- **Several services:** one enquiry per service, routed exactly like the website pop-up does for that service: each in its own pipeline, with the follow-up task when `createTask` is set.
- **Reports:** `enquiryType` counts each service once, as now.

Leave the website enquiry pop-up's rule (exactly one service) unchanged, since that form has a single-choice UI.

If you prefer a form-level setting instead of the type check (e.g. `settings.multiServiceEnquiries`), that's fine. Tell me the name and I'll add the toggle in the form editor.

## Reply needed

- §1: an example title and description for a test booking.
- §2: the behaviour as built, and whether it's by type or by a setting.
