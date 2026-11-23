# End-to-end test: CRM + website (23 Nov 2026)

**For:** the WordPress agent (Banyan Room Booking plugin 1.3.1).
**From:** the CRM team.

**Goal:** test the whole flow across banyanworkspace.com, the CRM (https://banyan-crm-admin.vercel.app) and Stripe **test mode**, then report every problem back so the CRM side can fix it.

The developer gives you the CRM login separately. Never write it in your report or screenshots.

---

## 0. Safety rules: read before you start

The room calendars, especially **the Library calendar, are in live use by Banyan's partner**, and real customers book the same rooms. A careless test booking can block a real customer or put a stray event in the partner's calendar.

1. **Every test record starts with "TEST":**

   | Record | Example |
   |---|---|
   | Customer first name | `TEST` |
   | Customer last name | `QA <what you're testing>` |
   | Company | `TEST Co QA` |
   | Form | `TEST walk-in` |
   | Page title | `TEST …` |
   | Notes | `TEST – do not action` |

2. **Never book the Library.** Use the **small meeting room only**, and the large meeting room only where a step says so.
3. **Booking times:**
   - Book only on **weekdays at least 3 weeks ahead**, between **16:00 and 18:00**, for **1 hour**.
   - Before every booking, open that day in the CRM (Bookings and Calendar → Meeting rooms) or on the website, and check the **whole day** for that room. If anything is already booked within 2 hours either side of your slot, pick another day.
4. **Payments:**
   - Pay only in **Stripe test mode**, with card `4242 4242 4242 4242`, any future expiry and any CVC. The checkout must show the **Sandbox/Test** badge.
   - If it doesn't, **stop** and report it. Don't pay.
5. **Emails:** use an email address you control, e.g. a `+qa` alias of your own mailbox. **Never** use a client's or staff member's address. Don't send any email from the CRM to anyone else.
6. **Settings:** don't change any CRM settings (room calendars, partner blocking, Google, Flodesk, users), WordPress plugin settings or Render. You are **observing**, not configuring.
   - Partner blocking must stay **off**. If you find it on, stop and report it.
7. **Existing records:** don't edit, cancel or delete anything that isn't yours (not starting with TEST). This includes existing bookings, Google Calendar events, contacts and deals.
8. **No meeting invites, ever.**
9. **Clean up as you go:**
   - cancel every test booking (with refund where offered);
   - remove test pages;
   - note every test record in the clean-up list in §7.
10. **If anything looks wrong** (a real booking affected, an event in the Library calendar, a real email sent), **stop testing and report it immediately**, before continuing.

---

## 1. Before you test

| # | Check | Expected |
|---|---|---|
| 1.1 | CRM → Settings → **Integrations** | Google shows connected (info@banyanworkspace.com). The **Flodesk** card says **Connected**, with no "Segments not found". |
| 1.2 | CRM → Bookings and Calendar → **Meeting rooms** → Room calendars | Small, large and Library calendar IDs are set. **Partner blocking is OFF.** |
| 1.3 | Sidebar | Shows **Users** (not "Members"). |
| 1.4 | Stay signed in to the CRM for **20+ minutes**, then click around | Still signed in. Before the fix, Safari/iPad signed you out at 15 minutes. If you can, test this in Safari. |

If 1.1 or 1.2 fails, report it and skip the steps that need it, marked "Blocked".

## 2. Room bookings

| # | Test | Expected |
|---|---|---|
| 2.1 | **Website booking.** On banyanworkspace.com, book the **small room** (rules in §0), customer `TEST QA website`, and pay with the test card. | Confirmation page and email. In the CRM (Meeting rooms list): the row shows Paid, a **TEST** badge, Website checkout, and the contact tagged `test_booking`. |
| 2.2 | **Google Calendar copy.** Open that booking's side panel in the CRM, then the small room calendar in Google Calendar. | Side panel: "In room calendar". Google: an event titled **`TEST – Meeting Room – TEST QA website (BNY-…)`**, whose description starts "Stripe TEST mode – not a real booking." Nothing new in the Library calendar. |
| 2.3 | **Staff booking with card.** In the CRM, New booking → small room → fill from a contact or type `TEST QA staff` → Continue to payment → open the payment page → pay with the test card. | The CRM shows "Payment successful", the row appears with "booked via CRM", and the calendar event is titled `TEST – …`. |
| 2.4 | **Clash check.** Start a second CRM booking for the **exact same slot** as 2.3. | The slot shows as Booked and can't be picked. |
| 2.5 | **Cancel with refund.** In 2.1's side panel: Cancel booking → reason `TEST cleanup` → tick **Refund in full** → Cancel and refund. | The status shows Cancelled, with who and why. Payment shows "Refunded HK$… · re_…". History lists the cancellation and refund. The website shows the slot free again. The Google event is removed. A cancellation email is received. Stripe (test) shows the refund. |
| 2.6 | **Cancel 2.3 again**, the same way. Then try cancelling it a second time if the button is still there. | No double refund (same refund ID). |

## 3. Meeting room credits

| # | Test | Expected |
|---|---|---|
| 3.1 | Create a company `TEST Co QA` and a contact `TEST QA credits` (your email, a phone number) linked to it. On the company page, set **Monthly allowance** to **2 h**. | The Meeting room credits card shows allowance 2 h, used 0, remaining 2 h. |
| 3.2 | New booking → small room, 1 hour (rules in §0) → fill from contact `TEST QA credits`. | A **Payment** choice appears: "Meeting room credits from TEST Co QA – 2 of 2 hours left in YYYY-MM". |
| 3.3 | Choose credits → **Book with credits**. | "Booked with meeting room credits", with the ref and "Credits left: 1 h". Email: "paid with meeting room credits", with no amount. WP Admin shows "Credits (1)". In the CRM row, Amount reads "Meeting room credits (1 h)". |
| 3.4 | Try booking **2 more hours** with credits for the same contact and month. | Credits option disabled ("needs 2"), or a clear "has 1 meeting room credit left" message. |
| 3.5 | Cancel the 3.3 booking from its side panel. | No refund checkbox, and the note says the hours go back. The company card shows used 0 and a "Returned" entry. The slot is free on the website. |
| 3.6 | Company page → **Adjust credits** (admin): `+1`, note `TEST`. Then `-1`, note `TEST undo`. | Both entries are listed, and the totals update. |
| 3.7 | Bookings and Calendar → **Calendar** → "Meeting room credits" panel. | `TEST Co QA` is listed with its usage. |

## 4. Forms and website pages

| # | Test | Expected |
|---|---|---|
| 4.1 | CRM → Forms → **New form** → **Walk-in visitor**. Rename it `TEST walk-in`, slug `test-walk-in-qa`. Check the **preview** and change a colour. Save. | Saved. The preview shows the Banyan design and reflects the colour. |
| 4.2 | **Share → Create page** with address `forms/test-walk-in-qa`. | A link appears. Opening it shows the site header and footer and the form in the Banyan design, centred. No sideways scroll on desktop or at phone width (375px). |
| 4.3 | Submit the page with `TEST QA walkin1`, your email, **no services ticked**, newsletter **No**. | Thank-you message, then auto-reset after about 10 seconds. CRM: a submission marked Processed, the contact tagged `walk_in`, **no deal**. |
| 4.4 | Submit again (`TEST QA walkin2`) with **Coworking Desks + Serviced Offices** ticked and "How did you hear" set to Instagram. | Two deals ("Walk-in enquiry — …"). The contact's source is Instagram. |
| 4.5 | Edit the form in the CRM: change its title → **Share → Update page**. Reload the page after about 1 minute. | The new title shows. |
| 4.6 | Try **Create page** on another test form with the path `meeting-rooms-hong-kong`. | A clear message that the address is already used. Nothing changes on the website. |
| 4.7 | **Share → Remove page** for `TEST walk-in`. | The CRM no longer shows a link. The page is in the WP bin. |
| 4.8 | **Shortcode on an existing page:** don't edit live pages. Only check the CRM's Share dialog shows the `[banyan_crm_form slug="…"]` text. | Shown. |
| 4.9 | **Website enquiry pop-up.** Submit it once as `TEST QA enquiry`, one service, notes `TEST – do not action`. | It works exactly as before. In the CRM: a contact, a deal in that service's pipeline, and a follow-up task. |
| 4.10 | **iPad / phone:** in the CRM, open Forms → New form → Blank form on a narrow or touch screen. | The whole dialog is visible and scrolls (it used to be cut off at the top). |

## 5. Newsletter and Flodesk

| # | Test | Expected |
|---|---|---|
| 5.1 | New form → **Newsletter sign-up**, name `TEST newsletter`, slug `test-newsletter-qa`. Create a page for it. | Page works. |
| 5.2 | Submit with `TEST QA news1`, your email, interest **Coworking**, and **without** ticking consent. | The browser blocks it (consent is required). |
| 5.3 | Submit with consent ticked. | CRM Forms → Submissions: Flodesk shows **Added**, segment `Coworking [Automated]`, and the contact is tagged `newsletter`. In Flodesk (Audience → Subscribers), the address is in the Coworking segment. |
| 5.4 | **Clean up:** delete that subscriber in Flodesk, and remove the page. | Done. |

## 6. Other CRM screens (look, don't change real data)

| # | Test | Expected |
|---|---|---|
| 6.1 | Open a **TEST deal** from 4.4. Use the **stage bar** at the top: click "Next: …". | The stage changes, and the bar highlights the new stage. Won/Lost rules show clear messages. |
| 6.2 | Open the follow-up task for a TEST deal → **Complete**. | "What's next?" appears. Create the next task (`TEST follow-up`). It's created and linked to the same deal and contact. Then complete and delete it. |
| 6.3 | **Reports → Breakdowns:** try all three tabs, Weekly and Monthly, and Custom dates. Export CSV. | Each loads without errors, and your TEST walk-in services show under "Enquiries by type". (Test payments never count in revenue.) |
| 6.4 | **Loyalty** page | Company tiers list with the tier cards. `TEST Co QA` shows HK$0 (test payments don't count). |
| 6.5 | **Contacts:** filter by tags `test_booking` + `walk_in`, and add the tag `!!!` to a TEST contact. | The filter needs both tags. `!!!` is refused with a clear message. |
| 6.6 | **Templates:** create `TEST html` from a small HTML file with a hosted logo image. Check Preview, then delete it. | The preview renders. Don't send it to anyone. |
| 6.7 | **Integrations → Connect Google:** don't reconnect; only check the button opens Google in a small window and the CRM doesn't hang on "Opening Google…". Close the window without approving. | The CRM shows a hint instead of hanging. |

## 7. Clean-up checklist (all must be done before you report)

- [ ] Every TEST room booking is **cancelled**, with card ones refunded in Stripe test mode.
- [ ] No TEST event is left in the small or large room calendars (the CRM removes them on cancel). **Nothing** was ever added to the Library calendar.
- [ ] TEST pages removed (CRM Share → Remove page); the WP bin is fine.
- [ ] Flodesk test subscriber deleted.
- [ ] TEST forms deleted. A form with submissions is deactivated instead; that's fine.
- [ ] TEST contacts, company and deals: **list them in your report**, and the CRM team will archive them. Don't bulk-delete.
- [ ] WP Admin: no leftover TEST bookings in Pending.

## 8. Report format

Send back `WP_E2E_TEST_REPORT_2026-11-23.md` containing:

1. **Summary table:** one row per test ID, with Pass / Fail / Blocked / Not tested.
2. **For each Fail:**
   - steps;
   - expected vs actual;
   - the exact error text;
   - the booking ref, form slug or contact name;
   - which side you think is at fault (website, CRM screen, CRM server);
   - a screenshot, with no logins or personal data visible.
3. **Safety log:** every booking you made (ref, room, date and time, and that it's cancelled), plus confirmation that nothing touched the Library calendar or real records.
4. **Clean-up list:** what's done, and what's left for the CRM team.

Small things are worth reporting too: confusing wording, layout issues on phone or iPad, slow pages.
