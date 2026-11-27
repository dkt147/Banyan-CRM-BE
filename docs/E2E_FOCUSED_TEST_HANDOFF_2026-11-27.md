# Browser test: new features and recent fixes (27 Nov 2026)

**For:** the browser testing agent.
**From:** the CRM team.

**Scope:** only what changed since the 25 Nov test.
1. A retest of the fixes from your 25 Nov report.
2. The features built from the client's 26 Nov feedback.
3. The decisions we made on 27 Nov: memberships, Eventbrite, WhatsApp, stage tasks and the booking flow.

**Don't retest the rest of the CRM.**

- **CRM:** https://banyan-crm-admin.vercel.app
- **Login:** the developer gives you an **admin** login separately. Never write it in your report or screenshots.

**Some features need the second backend update** (`CRM_BACKEND_ROUND_2026-11-27b`): Events/Eventbrite, the WhatsApp and Eventbrite status cards, WhatsApp templates, and the follow-up task setting per stage. If a screen says "…needs the latest server update", or behaves the old way where a test says so, mark it **Blocked (server)** and move on. It isn't a fail.

---

## 0. Safety rules: read first

This is the client's live system, shared with their partner. These rules override everything below.

1. **Test records:** name every one with "TEST", e.g. contact `TEST QA focus`, company `TEST QA Co focus`, deal `TEST QA deal focus`.
   - **Exception:** for day pass emails, reuse the contact `Qa TEST daypass`. Contacts whose first name starts with TEST don't get those emails.
2. **Email and WhatsApp:**
   - Send only to an address or number **you** control, e.g. `+qa` aliases of your own mailbox.
   - Never message a client, a staff member or a real contact.
3. **Real records:**
   - Don't edit, archive, delete, tag, note, message, or add a membership to any record that isn't TEST.
   - Looking is fine.
4. **Passwords:** only on a TEST user you create yourself. Never on a real user, and never change the admin's password.
5. **Rooms and calendars:**
   - **Never touch the Library.**
   - Don't cancel, move or delete any booking or calendar event, including test ones.
   - Calendar blocking: look only. Never switch it on, and never click **Sync now**.
   - The only booking allowed is §12.2, and only if the developer has ticked it below.
6. **Money:**
   - Don't create or send invoices: CRM invoices are pushed to Xero, the client's real accounts.
   - Don't mark anything paid. The Stripe test card `4242 4242 4242 4242` is the only card allowed.
   - **Sync from Xero** (§7) is allowed once: it only reads from Xero.
7. **Don't touch:**
   - agreements (DocuSign);
   - automations: don't enable or edit any;
   - integrations: don't disconnect any;
   - real pipelines or stages: you may open a stage's edit window but **Cancel**;
   - workspace settings, real loyalty tiers and real tags: only ones you create.
   - **Eventbrite:** look only. Don't click **Sync now** on Eventbrite unless the developer says so.
8. **If anything goes wrong,** such as a real person getting a message, a real record changing, or a calendar or booking changing: **stop and report it immediately.**

**Developer: tick before sending.**
- [ ] §12.2: one TEST booking of the **small meeting room** with the Stripe test card is allowed.

  If this isn't ticked, skip §12.2.

**Setup:**
1. Create the contact `TEST QA focus` with your `+focus` email.
2. Create the company `TEST QA Co focus`, and link the contact to it.
3. Create the deal `TEST QA deal focus` for that contact, with value 1000, in any pipeline **except** Membership, Private office or Virtual office.

---

## 1. Retest: fixes from the 25 Nov test

| # | Test | Expected |
|---|---|---|
| 1.1 | **Contacts** list: change the filters quickly, 3–4 times in under 2 s (e.g. Created: Today → This week → Clear → a tag). Then do the same on the **Deals** list. | The final list always matches the last filter chosen. An older, slower result never replaces a newer one. The counts are right. |
| 1.2 | **Users** page: the **Status** filter. Try Active, Inactive and All. | Each shows the right users. A deactivated user is under Inactive, not deleted. |
| 1.3 | **Users → Add user.** Look at the email and password fields before you type. | The browser doesn't autofill your own login into them. |
| 1.4 | **+ New deal** (from the Deals list, and from a contact). Watch the Stage and Contact fields while they load. | "Loading…" while loading, never "No contacts" or an empty stage. The stage shown is the one saved: open the deal afterwards and check it. Cancel without saving, or save a TEST deal. |
| 1.5 | Contacts list: **save a view.** | An inline "View name" field appears; there's no browser pop-up. Save it as `TEST QA view focus`. It appears in the views list. |
| 1.6 | `Qa TEST daypass` → **Day pass** card → history. | Visit dates read like "24 Nov 2026" (not "2026-11-24"). |
| 1.7 | `Qa TEST daypass` → **Email balance.** | Sent. The email arrives in your mailbox **from info@banyanworkspace.com** within a few minutes, and an email activity appears on the contact. If you get "Gmail isn't connected" or similar, write down the exact message. Gmail was switched on after the last test, so this must work now. |
| 1.8 | **Password change sign-out.** Create the TEST user `TEST QA user focus` (your `+user` email). Sign in as it in a second browser (incognito). As the admin, **Set password** on it. Then use the incognito window. | Within seconds the incognito session is signed out with "Your password was changed. Please sign in again." The new password works. Afterwards, **deactivate** the TEST user. |
| 1.9 | Room calendar settings → **Google Calendar → website blocks**, **Preview** only. | Library is unticked. The preview lists rooms, "to create", conflicts (each with room, date, time and booking ref) and skipped all-day events. Nothing is saved. |

## 2. Contact, company and deal pages: tabs

| # | Test | Expected |
|---|---|---|
| 2.1 | Open `TEST QA focus`. | The details are on the left. On the right is a wide panel with tabs: **Activity, Notes, Emails, WhatsApp, Tasks, Deals, Bookings, Invoices, Events, Files**, each with a count. The old small buttons on the right are gone. |
| 2.2 | Switch tabs, then open another contact. | Each tab loads without errors. The last tab you used is remembered. |
| 2.3 | The same on `TEST QA Co focus` and `TEST QA deal focus`. | Same layout. The deal has no Deals or Events tab, and shows link chips to its contact and company. |
| 2.4 | Window widths of 1440, 1024 (iPad) and 390 px (phone). | Below about 1100 px the tabs move under the details. There's no sideways page scrolling. The tab row scrolls sideways if needed. |
| 2.5 | Task and booking pages. | They keep their old layout. Nothing is broken. |

## 3. Notes

| # | Test | Expected |
|---|---|---|
| 3.1 | `TEST QA focus` → **Notes** tab → type "TEST note one" → **Add note** (also try Ctrl+Enter for a second note). | Each note shows **your name** and the **date and time** (HK). The newest is on top. The tab count goes up. |
| 3.2 | **Edit** your note, then save. | The text changes and shows "· edited". |
| 3.3 | **Delete** the second note, and confirm. | It's removed. The count goes down. |
| 3.4 | Add a note on `TEST QA deal focus`. Then open its contact and company → Notes. | The deal note appears on both, labelled "On deal: TEST QA deal focus". |
| 3.5 | Activity tab → **Notes** filter. | Your notes appear with their full text. |
| 3.6 | Empty note; or more than 5000 characters (paste a long text). | Clear messages, and nothing is saved. |
| 3.7 | A real contact that had text in the old Notes field (look only). | It shows under "Earlier notes". Nothing was lost. |

## 4. Detailed timeline

| # | Test | Expected |
|---|---|---|
| 4.1 | `TEST QA focus`: edit the job title and the phone, then save once. | **One** Activity entry, "Contact updated · by <you>", listing **Job title: (old) → (new)** and **Phone: (old) → (new)**, with the old value struck through. |
| 4.2 | Save without changing anything. | No new entry. |
| 4.3 | Add, then remove, a tag on the contact. | The entry is titled "Tags changed", with the tag **labels** (not keys). |
| 4.4 | `TEST QA deal focus`: change the value from 1000 to 1500. | "Deal details updated", "Value: HK$1,000 → HK$1,500". |
| 4.5 | Move the deal to the next stage (stage bar). | "Stage changed", "Stage: <old> → <new>". |
| 4.6 | Activity filters **All / Notes / Changes / Other**. | Each shows the right kind of entry. |
| 4.7 | The company: change a field. | "Company updated", with before and after. |
| 4.8 | A TEST task: complete it. | The task's timeline says "Task completed". |

## 5. Birthdays

| # | Test | Expected |
|---|---|---|
| 5.1 | `TEST QA focus` → Details → Edit → **Birthday**. Try `14/03`, then `14 Mar 1990`, `31/02`, `abc` and `29/02/1991`. | `14/03` → "14 Mar". `14 Mar 1990` → "14 Mar 1990 · turns N". The others give clear errors and nothing is saved. |
| 5.2 | Set the birthday to **today's** HK date with a year, e.g. `27/11/1990`. | The header shows "Birthday today (N)". |
| 5.3 | **Dashboard → Overview.** | The "Birthdays today" panel lists `TEST QA focus` with "turns N". |
| 5.4 | Set the birthday to 3 days from now (no year). | The dashboard lists it under "Next 7 days" with its weekday. |
| 5.5 | Clear the birthday (empty, then save). | Shows "—". It's gone from the dashboard. |

## 6. Contact tags (Settings → Contact tags)

| # | Test | Expected |
|---|---|---|
| 6.1 | Open it. | Segment and Source groups, each tag with its contact count. Sources include **Eventbrite**. |
| 6.2 | **Add tag** `TEST QA tag focus` in Segments, with a description. | Saved. It shows in the tag picker on a contact and in the Contacts list filter. |
| 6.3 | Add `test qa tag focus` again (different case). | "Already exists" message. |
| 6.4 | Put the tag on `TEST QA focus`. **Rename** it to `TEST QA tag renamed focus`. | The contact shows the new name (reload). |
| 6.5 | Edit a built-in **Source** tag (Cancel without saving). | Its group can't be changed. |
| 6.6 | **Archive** your TEST tag. Tick "Show archived tags". | It leaves the pickers, but `TEST QA focus` still shows its label. You can **Restore** it. Leave it archived. |

## 7. Invoices

| # | Test | Expected |
|---|---|---|
| 7.1 | Invoices page as the admin: **Sync from Xero**, once. | It finishes with "Synced from Xero: N checked, N new, N updated, N not linked…". Hovering over the button shows the last sync. Write down the numbers. |
| 7.2 | Open 2–3 real clients that you can see have invoices on the Invoices page (look only) → **Invoices** tab. | Their invoices are listed with number, amount, status, and due or paid date, plus an outstanding total. Xero invoices open **in Xero** in a new tab (you may get a Xero sign-in page; that's fine). |
| 7.3 | The same on their **company** and on a related **deal**. | The same invoices appear where they're linked. |
| 7.4 | `TEST QA focus` → Invoices. | "No invoices yet…" |
| 7.5 | **Data question:** how many real contacts or companies show Xero invoices? Are the amounts and statuses plausible? | Report. |

## 8. Memberships

Production had no memberships, so the card says "Not a member" for every real contact. That's expected.

| # | Test | Expected |
|---|---|---|
| 8.1 | `TEST QA focus` → **Membership** card. | "Not a member", with an **Add membership** link. |
| 8.2 | **Add membership.** Plan: if the list has plans, pick one; if it's empty or only shows "+ New plan…", create `TEST QA plan` (type Coworking membership, price 1). Status Active, start today, renewal in a month (filled in for you), monthly 1, seats 1, keep "Tag the contact Active member" ticked. | Saved. The card shows the plan, Active, Since, Renews, HK$1 and Seats 1. The header shows the badge "Member · <plan>". The contact has the **Active member** tag. |
| 8.3 | Try a renewal date before the start date, and seats 0. | Clear messages. |
| 8.4 | `TEST QA Co focus` → **Memberships** card. | Shows the membership with the member's name. **Add membership** offers a dropdown of the company's people (Cancel). |
| 8.5 | Create `TEST QA membership deal` in the **Membership** pipeline for `TEST QA focus`. **Mark won**, ticking Payment received. | The "Deal won: add the membership" window opens with the deal value as the monthly price and the note "From deal: …". Click **Not now**. The stage bar shows **Add membership**. Don't add a second membership. |
| 8.6 | Memberships page. | Your TEST membership is listed. |

## 9. Follow-up tasks on stage change *(needs the second backend update)*

| # | Test | Expected |
|---|---|---|
| 9.1 | Pipelines → the pipeline of `TEST QA deal focus` → a stage's **Edit**. Look, then **Cancel**. | A **Follow-up task** box with a tick box, "Due after (days)" and an optional title. "Quote sent" (where it exists) is ticked with 3 days, and its card says "Task in 3 d". **Don't save any stage.** |
| 9.2 | Move `TEST QA deal focus` to a normal stage (not Quote sent). Look at its **Tasks** tab. | **No** automatic follow-up task. You're asked "What's next?" instead. *(Old behaviour, one task on every move: Blocked (server).)* |
| 9.3 | If the pipeline has **Quote sent**, move the deal there. | Exactly **one** automatic task, due in 3 days at 10:00 HK. |

## 10. Email and WhatsApp (own address and number only)

| # | Test | Expected |
|---|---|---|
| 10.1 | `TEST QA focus` → send an email (Inbox → new message, to your `+focus` address), subject "TEST QA email focus". | Arrives **from info@banyanworkspace.com**. It shows on the contact's **Emails** tab and in the Inbox. |
| 10.2 | Reply from your mailbox. | Within a few minutes the reply is in the same CRM thread. |
| 10.3 | Settings → Integrations → **WhatsApp Business** card. | Connected or Not connected, the business number, whether incoming messages arrive, and the number of approved templates. Copy exactly what it says. |
| 10.4 | Only if connected: put **your own** WhatsApp number in `TEST QA focus` → WhatsApp. Click **WhatsApp** (top of the contact) and send a **template** (fill the blanks). | It arrives on your phone. It shows on the WhatsApp tab and in the Inbox, and Activity says "WhatsApp sent". |
| 10.5 | Reply from your phone, then send **free text** from the CRM. | Your reply arrives in the CRM. The free text arrives on your phone. |
| 10.6 | If not connected: open the WhatsApp window anyway. | It says WhatsApp isn't connected, and **Send** is disabled. Mark 10.4–10.5 Blocked (not connected). |

## 11. Events (Eventbrite): look only *(needs the second backend update)*

| # | Test | Expected |
|---|---|---|
| 11.1 | Settings → Integrations → **Eventbrite** card. | Connected or Not connected, the organisation, whether sign-ups arrive straight away, and the last sync with counts. Copy exactly what it says. |
| 11.2 | Sidebar → **Events**: Upcoming / Past / All, and search. | The list loads with date, status, and sign-ups / capacity. |
| 11.3 | Open an event. | Stats; an attendee table with ticket, status and "New contact" badges; filters; and "Open in Eventbrite" (the right event). |
| 11.4 | Open 2 attendees (look only). | The contact has the **Eventbrite** tag, the **Events** tab lists the sign-up, and Activity shows "Signed up for …". |
| 11.5 | **Data question:** are any attendees duplicated as two contacts with the same email? | Report. |

## 12. Meeting room booking (the client says it "doesn't work")

| # | Test | Expected |
|---|---|---|
| 12.0 | CRM → **Meeting rooms** page, top. | Note what the sync line says: "Synced from WordPress … · checks every 2 min" is good. A notice "Automatic WordPress sync is off" means the server setting isn't fixed yet: report it. |
| 12.1 | CRM → Meeting rooms → **New booking**. Small room; a free weekday at least 14 days ahead; 1 hour. Go to step 2 and pick `TEST QA focus` in the contact search. **Stop: close the window. Don't click "Create payment link".** | Availability loads, with booked hours greyed out. Step 2 fills in the contact's details and shows the HK$ total. The button says **Create payment link**. Write down anything that blocks or confuses you, with the exact text. |
| 12.2 | **Only if ticked in §0:** (Stripe is in **test mode**: a real card is always declined. That's expected and may be what the client hit.) on **banyanworkspace.com**, book the **small meeting room** at least 14 days ahead on a free weekday slot, 1 hour. Name `TEST QA booking focus`, your `+booking` email, test card 4242 4242 4242 4242. **Don't cancel or delete it afterwards.** | Payment succeeds and you get a confirmation email. Within a few minutes it's in CRM Meeting rooms with the right room, time, amount and the "Test" badge, and in the small room's Google Calendar. **Write down every step and any error exactly.** |

## 13. Clean-up (before you report)

- [ ] The TEST membership is set to **Cancelled** (Memberships page → Edit), not deleted.
- [ ] If you created `TEST QA plan`, set it **inactive**.
- [ ] `TEST QA tag renamed focus` is **archived**.
- [ ] The saved view `TEST QA view focus` is deleted.
- [ ] `TEST QA user focus` is **deactivated**.
- [ ] `TEST QA focus` has no birthday set, or it doesn't matter. Just tell us.
- [ ] No real record was edited, messaged, tagged, noted or given a membership.
- [ ] No invoice, agreement, automation or stage was created or changed.
- [ ] Calendar blocking is still off. The Library was never touched. No booking was cancelled.
- [ ] List every TEST record you created (contacts, company, deals, tasks, notes, tag, plan, membership, user, view, emails, WhatsApp messages and the booking ref) for the CRM team to archive.

## 14. Report

Send back `E2E_FOCUSED_TEST_REPORT_2026-11-27.md` with:
1. **A summary table:** one row per test ID, marked Pass / Fail / Blocked (server) / Blocked (other) / Not tested, with a short note.
2. **For each Fail:**
   - steps;
   - expected vs actual;
   - the exact on-screen text;
   - a screenshot, with no logins or personal data;
   - whether you think it's the screen or the server.
3. **Email and WhatsApp:** each message, with time sent and received, and whether it showed in the CRM.
4. **Booking (§12):** every step, any error, and the booking ref (if 12.2 was done).
5. **Data questions:** 7.5 and 11.5, plus the numbers from 7.1.
6. **Small things:** wording, slow screens (over 3 s), and phone or iPad layout.
7. **The clean-up list.**
