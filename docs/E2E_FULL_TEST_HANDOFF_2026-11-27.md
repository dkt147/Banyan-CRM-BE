# Browser test: the whole CRM (27 Nov 2026)

**For:** the browser testing agent.
**From:** the CRM team.

**Goal:** a complete pass through the live CRM (https://banyan-crm-admin.vercel.app) before the client's next review:
- every screen;
- the new features from the client's 26 Nov feedback;
- the fixes from the 25 Nov test.

Report everything that's wrong, confusing or slow.

**Logins:** the developer gives you an **admin** CRM login separately. Never write it in your report or screenshots.

**New features that need the server update:** Notes, the detailed timeline, Birthdays, Contact tags, Events (Eventbrite), the WhatsApp and Eventbrite status cards, WhatsApp templates, and the per-stage follow-up task setting. If you see "…needs the latest server update", mark that test **Blocked (server)** and move on. Don't count it as a fail.

---

## 0. Safety rules: read first

This is the client's live system, shared with their partner. These rules override anything below.

1. **Name every test record with "TEST",** e.g. contact `TEST QA full`, company `TEST QA Co full`, deal `TEST QA deal full`, tag `TEST QA tag`.
   - **One exception:** to receive day pass emails, a contact's first name must not start with TEST. Reuse `Qa TEST daypass` from the last test.
2. **Emails and WhatsApp:**
   - Send only to an address or number **you** control, e.g. `+qa` aliases of your own mailbox.
   - Never message a client, staff member or anyone in the contact list.
3. **Don't change real records.** Don't edit, archive, delete, tag, note or message anything that isn't yours (TEST…). Looking is fine.
4. **Passwords:**
   - Only on a TEST user you create.
   - Never "Set password" on a real user.
   - Never "Change password" as the admin.
5. **Room bookings and calendars:**
   - **Never touch the Library** (the partner's live calendar).
   - Don't cancel, move or delete **any** booking or calendar event, test ones included.
   - Calendar blocking: look only. Never Save it on; never click **Sync now**.
   - The only booking allowed is §11.4, and only if the developer has ticked it.
6. **Money and accounting:**
   - **Don't create or send invoices.** A CRM invoice is pushed to Xero, the client's real accounts.
   - Don't mark anything paid.
   - Don't send payment links to anyone but yourself.
   - Stripe is in test mode on purpose. Use only the test card `4242 4242 4242 4242`.
7. **Don't send agreements** (DocuSign), don't **enable or edit automations**, don't **disconnect integrations**, and don't change **pipelines, stages, workspace settings, or real loyalty tiers**.
8. **If anything goes wrong,** such as a real person getting a message, a real record changing, or a calendar or booking changing: **stop and report it immediately**.

**Developer: tick before sending.**
- [ ] §11.4: one TEST booking of the **small meeting room** with the Stripe test card is allowed.

  If this isn't ticked, skip §11.4.

---

## 1. Sign-in and session

| # | Test | Expected |
|---|---|---|
| 1.1 | Sign in as admin. | Dashboard opens. No errors. |
| 1.2 | Wrong password once (your own login, in a private window). | "Invalid email or password." |
| 1.3 | Stay signed in for 20+ minutes, then click around. | Still signed in. |
| 1.4 | Profile menu → **Sign out**, then sign in again. | Works. |
| 1.5 | iPad or Safari, if you have one: sign in and wait 20 minutes. | Still signed in. |

## 2. Dashboard

| # | Test | Expected |
|---|---|---|
| 2.1 | The Overview tab loads. | Metrics, pipeline cards and today's queue. No errors. |
| 2.2 | **Birthdays today** panel. | Shows "No birthdays today", or the people with a birthday today and a "Next 7 days" list. *(Blocked (server) if it says the update is needed.)* |
| 2.3 | After §4.6 (your TEST contact's birthday set to **today**): reload. | Your TEST contact is listed under today. Clicking opens the contact. |
| 2.4 | The Occupancy, Revenue and Sources tabs. | Each loads. |
| 2.5 | "Needs action" and the follow-ups count in the header. | Each opens a list that matches. |

## 3. Contacts list

| # | Test | Expected |
|---|---|---|
| 3.1 | Contacts → **+ New contact** `TEST QA full`, your `+full` email. | Created and listed. |
| 3.2 | Search by "TEST QA". | Finds it. |
| 3.3 | **Added: Today**, then straight away **Company** (any). Change filters quickly. | The count always matches the filters. No stale results (the 25 Nov F1 fix). |
| 3.4 | Tag filter, date filter, Mine, Archived. | All combine correctly. |
| 3.5 | **Views → + Save current view**. | A name field appears **in the menu** (no browser pop-up). Saving `TEST QA view` works, and applying it restores the filters. Then delete the view (×). |
| 3.6 | Select your TEST contact → bulk tag. | Works on the selected contact only. |
| 3.7 | Export, if offered. | A CSV downloads. |

## 4. Contact page (main new features)

Open `TEST QA full`.

| # | Test | Expected |
|---|---|---|
| 4.1 | Layout. | Details on the left. A wide panel on the right with **tabs**: Activity, Notes, Emails, WhatsApp, Tasks, Deals, Bookings, Invoices, Files, with counts. On a narrow window or iPad, the tabs sit under the details. |
| 4.2 | Click each tab. | Each shows its list or an "empty" message. The last tab you opened is remembered on the next contact. |
| 4.3 | **Notes → Add note**: "TEST QA note one", then **Add note**. | It appears at the top with **your name and today's date and time** (HK). *(Blocked (server) if the page says dated notes need the update; then check the old single notes field works.)* |
| 4.4 | Add a second note with Ctrl+Enter. | Saved. Newest first. |
| 4.5 | **Edit** the first note, then save. **Delete** the second (confirm). | The edit shows "· edited". The deleted note is gone. |
| 4.6 | Details → **Edit** → **Birthday**: try `31/02`, then `14 Mar`, then today's date as DD/MM/1990. Save. | `31/02` gives a clear error. `14 Mar` saves and shows "14 Mar". DD/MM/1990 shows "… 1990 · turns N", and a **"Birthday today (N)"** badge appears in the header. *(Blocked (server) if the birthday doesn't stay after reload.)* |
| 4.7 | Clear the birthday (empty, Save). | It shows "—". |
| 4.8 | **Activity** tab after 4.3–4.7. | Entries such as "Contact updated", with **who** did it and **old → new** values ("Birthday: empty → 14 Mar"). The filter chips (All, Notes, Changes, Other) work. *(Blocked (server) if only "Contact updated" with no detail.)* |
| 4.9 | Tags: add **Prospect**, then remove it. | Saves. Activity shows "Tags changed". |
| 4.10 | **Membership** card. | "Not a member" for your TEST contact. Also open 2–3 **real** contacts you know are members (look only). The card shows the plan, since, renews and monthly value, plus a "Member · <plan>" badge in the header. If every real member shows "Not a member", report it (it's a data question). |
| 4.11 | **Invoices** tab on a real contact or company that has invoices (look only). | Lists number, amount, status, due or paid date. A Xero invoice opens in Xero in a new tab. If every client shows "No invoices yet", report it: the Xero pull sync isn't live yet. |
| 4.12 | **New deal** from the contact: `TEST QA deal full`, value 1000. | The deal opens, linked to the contact. |
| 4.13 | **Day pass credits** card (on `Qa TEST daypass`): add a 5-day package, then use a half day. | "4.5 days left. A low-balance email was sent…". You receive "Your Banyan day pass is running low". **Email balance** works too. *(This was blocked on 25 Nov by the Gmail API; it should work now.)* |
| 4.14 | Day pass history dates. | They read like "27 Nov 2026" (not 2026-11-27). |

## 5. Companies

| # | Test | Expected |
|---|---|---|
| 5.1 | Create `TEST QA Co full`. Link `TEST QA full` to it (the contact's Company field). | Linked. The company shows the contact. |
| 5.2 | Company page layout. | Same tabs as the contact page. |
| 5.3 | **Notes** tab. | It also shows the notes you added on the contact, because they're linked to its company. Add a company note. |
| 5.4 | **Memberships** card. | "No memberships for this company". On a real member company: the plan(s) and members (look only). |
| 5.5 | **Meeting room credits** card on the TEST company: set the allowance to 2 h. Previous and next month. | Saves. The month buttons work. |
| 5.6 | **New deal** from the company. | Stage is pre-filled (not empty). The contact is picked from its people. |

## 6. Deals and pipelines

| # | Test | Expected |
|---|---|---|
| 6.1 | Deals list → **+ New deal**. | The Contact list shows "Loading…" (not "No contacts") while loading. Create `TEST QA deal list`. |
| 6.2 | Deals list filters: Created: Today, Status: Open. Change quickly. | The counts are right. |
| 6.3 | Open `TEST QA deal full` → **Pipeline and stage**: move to the next stage. | Moves. **Activity** tab: "Stage changed · Stage: Enquiry → … · by <you>". *(Blocked (server) without the detail.)* |
| 6.4 | Edit the value 1000 → 1500. | Activity: "Value: HK$1,000 → HK$1,500". |
| 6.5 | Add a note on the deal. Open its contact → Notes. | The deal note appears on the contact too, labelled "On deal: …". |
| 6.6 | **Mark won** without ticking payment received, then with it. **Reopen.** **Mark lost** without a reason, then with one. | Clear messages when the payment tick or the reason is missing. Each change is on the timeline. |
| 6.7 | Pipelines (board): find your TEST deal and drag it one stage (TEST only). | Moves and stays after reload. |
| 6.8 | Tasks tab on the deal, after the moves in 6.3 and 6.7. | **New rule:** a stage change only creates an automatic task if that stage has "Follow-up task" switched on. By default, only **Quote sent** has it (task due in 3 days). Moving to any other stage creates **no** automatic task; you're asked "What's next?" instead. Note exactly which tasks were created. *(Before the server update, every move still creates one; report it as Blocked (server).)* |
| 6.9 | Pipelines → open a stage's **Edit** (look only, **Cancel**, don't Save). | The stage window has a **Follow-up task** box: a tick box, "Due after (days)" and an optional title. Quote sent shows it ticked with 3 days; the board card says "Task in 3 d". Don't change any stage. |

## 7. Tasks

| # | Test | Expected |
|---|---|---|
| 7.1 | Tasks → new task `TEST QA task`, due tomorrow, linked to your TEST contact. | Created. It shows on the contact's Tasks tab. |
| 7.2 | Complete it from the list. | You're asked to create the next follow-up. Create one for tomorrow. |
| 7.3 | Open a task → complete it from the task page. | Same prompt. |
| 7.4 | Overdue and Today filters. | Correct. |

## 8. Email and WhatsApp (the client wants to test these)

Use only your own address and number.

| # | Test | Expected |
|---|---|---|
| 8.1 | Inbox loads. Look at a few real threads (don't reply). | Threads and messages show. No errors. |
| 8.2 | From `TEST QA full` (your `+full` email): send an email, e.g. from the Inbox (new message) or the contact's Emails tab, subject "TEST QA email". | It arrives in your mailbox **from info@banyanworkspace.com**. In the CRM it's in the Inbox and on the contact's **Emails** tab. |
| 8.3 | Reply to it from your mailbox. | Within a few minutes the reply shows in the same CRM thread. |
| 8.4 | Use an **email template** for the email (Templates, TEST one from §9). | The merge fields (first name and so on) are filled. |
| 8.5 | Settings → Integrations → **WhatsApp Business** card. | Says Connected or Not connected, with the business number, whether incoming messages arrive, and the number of approved templates. Note exactly what it says. |
| 8.5a | Only if connected: put **your own** WhatsApp number on `TEST QA full` (WhatsApp field). Click **WhatsApp** at the top of the contact. Send a **template** (fill the blanks). | The message arrives on your phone. It shows on the contact's **WhatsApp** tab and in the Inbox, and the Activity tab says "WhatsApp sent". |
| 8.5b | Reply to it from your phone, then send **free text** from the CRM within 24 hours. | Your reply shows in the CRM thread. The free text arrives. |
| 8.5c | Free text to your number when you haven't messaged in 24 hours (skip if not possible). | A clear message: use a template. |
| 8.6 | Notifications (bell). | New inbound messages notify. |

## 9. Templates and forms

| # | Test | Expected |
|---|---|---|
| 9.1 | Templates → new email template `TEST QA template` with `{{firstName}}`. | Saved. Preview fills it in. |
| 9.2 | Forms → create `TEST QA form`. **Share** → open the link in a private window and submit with your `+form` email. | The thank-you shows. The submission appears with a contact (and a deal, if set). |
| 9.3 | Walk-in preset form (if it exists): submit as `TEST QA walkin`. | The contact is created with source "Walk-in", and a follow-up task for the next day. |
| 9.4 | Submissions list. | The Deal column shows every linked deal. |

## 10. Check-ins and day passes

| # | Test | Expected |
|---|---|---|
| 10.1 | Check-ins page loads. **Day pass balances**: search "daypass". | Finds `Qa TEST daypass`. The "5 days or fewer" filter works. |
| 10.2 | Check in your TEST contact, if the page has a check-in action. | Recorded. |

## 11. Bookings, calendar and meeting rooms

**Look only, except 11.4.**

| # | Test | Expected |
|---|---|---|
| 11.1 | Bookings and Calendar → Calendar: week and month views. | Bookings and room events show at the right HK times. |
| 11.2 | Meeting rooms list: open 2–3 bookings (look only). | Source, amount ("Meeting room credits" for members, not HK$0), the Google Calendar status, and the Stripe link only for card payments. |
| 11.3 | Room calendar settings. | Blocking is **off**, and the Library is unticked. The "Google Calendar → website blocks" panel shows "Rooms checked" on **Preview** (Preview only). |
| 11.4 | **Only if ticked in §0:** on banyanworkspace.com, book the **small meeting room** at least **14 days ahead** on a free weekday slot, 1 hour, name `TEST QA booking`, your `+booking` email, Stripe test card 4242 4242 4242 4242. **Don't cancel or delete it afterwards.** | Payment succeeds. You get a confirmation email. It appears in CRM Meeting rooms within a few minutes, with the right time, room, amount and the "Test" badge, and in the small room's Google Calendar. Write down every step and any error exactly: the client says this flow "doesn't seem to work". |
| 11.5 | Bookings list (other bookings). | Loads. The filters work. |
| 11.6 | CRM: Meeting rooms → **New booking**. Pick the **small** room, a free weekday slot ≥14 days ahead, 1 hour. Go to step 2, choose your TEST contact. **Stop there: close the window, don't click "Create payment link".** | Availability loads; booked hours are greyed. Step 2 fills the contact's details and shows the HK$ total. The button says **Create payment link** (not "Redirecting…"). Note anything that blocks or confuses you; this is the flow the client says doesn't work. |

## 12. Memberships, invoices, payments, agreements (look only)

| # | Test | Expected |
|---|---|---|
| 12.1 | Memberships page. | Lists memberships with plan, status and renewal. Note the count of active ones. |
| 12.2 | Invoices page. | Lists invoices with status. **Don't create, send or mark paid.** Note whether invoices made in Xero appear. |
| 12.3 | Payments page. | Loads. |
| 12.4 | Agreements page. | Loads. **Don't send.** |
| 12.5 | Documents page. | Loads. |

## 13. Loyalty and credits

| # | Test | Expected |
|---|---|---|
| 13.1 | Loyalty page: tiers and company standings. | Load. **Don't edit real tiers.** |
| 13.2 | **Add tier** `TEST QA tier` (min spend 999999), save, then edit it to **inactive**. | Created, then shown as inactive. Report that it needs removing. |
| 13.3 | A company with credits: its credits card. | Opens on the month of its next credit booking if it has one. Otherwise this month. |

## 14. Reports

| # | Test | Expected |
|---|---|---|
| 14.1 | Monthly report: year list. | Starts at 2026. |
| 14.2 | Breakdowns: last 12 months, custom dates. | Nothing before Jan 2026. |
| 14.3 | Any export button. | Downloads. |

## 15. Automations (look only)

| # | Test | Expected |
|---|---|---|
| 15.1 | The Automations page loads, with each rule's trigger and status. | No errors. **Don't enable, disable or edit.** |

## 16. Settings and users

| # | Test | Expected |
|---|---|---|
| 16.1 | Settings hub. | Every card opens its screen, including the new **Contact tags**. |
| 16.2 | **Contact tags:** two groups (Segments, Sources) with contact counts. *(Blocked (server) if it says an update is needed.)* | Labels and meanings show. |
| 16.3 | **Add tag** `TEST QA tag`, meaning "test". | The code `test_qa_tag` is shown. It's added, and appears in the contact tag picker (reload the contact). |
| 16.4 | Add `test qa tag` again. | "A tag with this name already exists". |
| 16.5 | **Edit** `TEST QA tag` → rename it `TEST QA tag renamed`. Put it on your TEST contact first. | The contact shows the new name. |
| 16.6 | **Archive** it. | It leaves the picker. Your TEST contact still shows it. "Show archived tags" lists it. |
| 16.7 | Users: filter **Active / Inactive / All users**. | Inactive shows `TEST QA user` from 25 Nov (deactivated, not deleted). |
| 16.8 | Users → **Add user**. | The form is **empty**: the browser doesn't fill in the admin's email or password. Cancel (no need to create another user). |
| 16.9 | Integrations page (look only). | Shows Google, Gmail, WhatsApp, Stripe and Xero status. **Don't disconnect.** Note which are connected. |
| 16.10 | Audit log and Notifications. | Load. The audit log shows your tag and user actions. |
| 16.11 | Workspace (look only). | Loads. |

## 17. Search, assistant, layout

| # | Test | Expected |
|---|---|---|
| 17.1 | Global search "TEST QA". | Finds your contact, company and deal. Clicking opens them. |
| 17.2 | Ask the assistant "deals quiet over 14 days". | A sensible answer, with no errors. |
| 17.3 | Phone width (DevTools, 390 px) and iPad (1024 px): Dashboard, Contacts, the contact page with tabs, Deals and Tasks. | No sideways scrolling. The tabs scroll sideways if needed. The buttons are tappable. |
| 17.4 | Speed: note any screen that takes over 3 s. | — |

## 17A. Events (Eventbrite) and integrations

New on 27 Nov: the CRM reads Eventbrite events and sign-ups. **Look only:** don't create, change or cancel anything on Eventbrite, and don't click **Sync now** unless the developer says so.

| # | Test | Expected |
|---|---|---|
| 17A.1 | Sidebar → **Events**. | The list loads with Upcoming / Past / All and search. If the server isn't updated: a "needs the latest server update" notice (Blocked (server)). |
| 17A.2 | Open one event. | Date, venue, "Signed up", "Checked in", the attendee table with ticket, status and links to contacts; "Open in Eventbrite" opens the right event. |
| 17A.3 | Open 2 attendees' contacts (look only). | Tagged **Eventbrite**; the **Events** tab lists the sign-up; Activity shows "Signed up for …". |
| 17A.4 | A company with attendees → **Events** tab. | Lists its people's sign-ups with their names. |
| 17A.5 | Settings → Integrations → **Eventbrite** card. | Connected or Not connected, organisation name, whether new sign-ups arrive straight away, and the last sync with counts. Note exactly what it says. |
| 17A.6 | Settings → Contact tags. | "Eventbrite" is listed under Sources. |

## 18. Clean-up (before you report)

- [ ] `TEST QA tag renamed` is **archived**.
- [ ] `TEST QA tier` is **inactive**.
- [ ] The saved view `TEST QA view` is deleted.
- [ ] No real record was edited, messaged, tagged or noted.
- [ ] Calendar blocking is still off. Sync was never run. The Library was never touched.
- [ ] No invoice, agreement or automation was created, sent or changed.
- [ ] List everything TEST you created for the CRM team to archive: contacts, company, deals, tasks, notes, form, template, tag, tier, the booking reference (if §11.4 was done) and emails sent. Don't bulk-delete.

## 19. Report

Send back `E2E_FULL_TEST_REPORT_2026-11-27.md` with:

1. **A summary table:** one row per test ID: Pass / Fail / Blocked (server) / Blocked (other) / Not tested, plus a short note.
2. **For each Fail:**
   - steps;
   - expected vs actual;
   - the exact on-screen text;
   - a screenshot, with no logins or personal data;
   - whether you think it's the screen or the server.
3. **Emails and WhatsApp:** each message sent and received, with subject, time, and whether it showed in the CRM.
4. **§11.4 (if done):** every step, any error, the booking reference, and whether it reached the CRM and Google Calendar.
5. **Data questions:**
   - Do real members show a membership?
   - Do real clients show Xero invoices?
   - Which automatic tasks did each stage change create (6.8)?
   - Do Eventbrite attendees appear as contacts, and are any duplicated?
6. **Small things:** wording, slow screens, layout on phone or iPad.
7. **The clean-up list.**
