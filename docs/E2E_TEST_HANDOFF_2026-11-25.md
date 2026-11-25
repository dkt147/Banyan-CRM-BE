# Browser test: client meeting round (25 Nov 2026)

**For:** the browser testing agent.
**From:** the CRM team.

**Goal:** test the features added after the 25 Nov client meeting in the live CRM (https://banyan-crm-admin.vercel.app), and report anything wrong. The client reviews these tomorrow afternoon.

The developer gives you an **admin** CRM login separately. Never write it in your report or screenshots.

---

## 0. Safety rules: read first

These are the same rules as on 23 Nov, plus a few new ones for passwords and calendar blocking.

1. **Name every test record with "TEST",** e.g. contact `TEST QA dates`, deal `TEST QA deal`, user `TEST QA user`.
   - **One exception:** in §5, the day pass contact's **first** name must *not* start with TEST, because TEST contacts never get emails. Use first name `Qa`, last name `TEST daypass`.
2. **Emails:** use only an address you control, e.g. a `+qa` alias of your own mailbox. Never use a client's or staff member's address.
3. **Passwords: only ever on the TEST user you create in §4.**
   - **Never** use "Set password" on any real user.
   - **Never** use "Change password" while signed in as the admin.
   - Doing either signs real staff out or locks the admin out.
4. **Calendar blocking (§6): look only.**
   - **Never** tick "Block the website…" and **Save**.
   - **Never** click **Sync now**.
   - **Preview** is safe (it writes nothing).
   - The Library calendar is Banyan's partner's live calendar.
5. **No room bookings are needed** for this test. Don't make any.
6. **Existing records:** don't edit, archive or delete anything that doesn't start with TEST (or isn't your `Qa TEST daypass` contact).
7. **If anything looks wrong,** for example a real user signed out, a real email sent, or a block appearing on the website, **stop and report it immediately**.

---

## 1. New deal from a contact, a company and the Deals list

| # | Test | Expected |
|---|---|---|
| 1.1 | Contacts → **+ New contact**: `TEST QA deal`, your email. Open it. | A **New deal** button appears at the top of the contact page. |
| 1.2 | Click **New deal**. Title `TEST QA deal from contact`, keep the pipeline and stage, value 1000, then **Create deal**. | The contact is pre-filled (greyed out). The new deal page opens with the contact linked. The contact's **Deals** tab lists it. |
| 1.3 | Companies → create `TEST QA Co deals`. Link the 1.1 contact to it (edit the contact's Company). Open the company and click **New deal**. | You pick a contact from the company's people. The deal is created and linked to the company and contact. |
| 1.4 | Deals list → **+ New deal**: any TEST contact, title `TEST QA deal from list`. | It's created and opens. |
| 1.5 | New deal with an empty title, then Create. | A clear message asks for a title. Nothing is created. |
| 1.6 | On an archived contact (archive one of your TEST contacts first). | No **New deal** button. |

## 2. Date filters (Contacts and Deals)

| # | Test | Expected |
|---|---|---|
| 2.1 | Contacts → **Added** → **Today**. | Only contacts created today (HK time), including your TEST ones. The range shows next to the filter, with a **Clear** link. |
| 2.2 | Try **Yesterday**, **Last 7 days**, **This week**, **Last week**, **This month** and **Last month**. | The list and count change. "Last week" means Monday–Sunday of the previous week. |
| 2.3 | **Custom dates…** From = 7 days ago, To = today. | Matches "Last 7 days". |
| 2.4 | Combine **Added: Today** with a **tag** filter and a **company**. | All filters apply together. The page count is right. |
| 2.5 | Save a view with **Last 7 days** (Saved views), clear the filters, then apply the view. | The filter comes back as "Last 7 days". |
| 2.6 | Deals → **Created** → **Today**. | Shows your TEST deals from §1. Combine it with Status: Open. |
| 2.7 | **Clear**. | The full list is back. |

## 3. Reports start in 2026

| # | Test | Expected |
|---|---|---|
| 3.1 | Reports → Monthly → **Year** dropdown. | No year before 2026. |
| 3.2 | Reports → Breakdowns → Monthly → **Last 12 months**. | The first column is no earlier than January 2026. |
| 3.3 | Breakdowns → **Custom dates**. Try a From date in 2025. | The date picker stops at 1 Jan 2026. |

## 4. Passwords (TEST user only)

Use two browser windows: your normal one (admin), and a **private/incognito** one for the TEST user.

| # | Test | Expected |
|---|---|---|
| 4.1 | Admin: **Users → Add user**. Name `TEST QA user`, your `+qauser` email, role **Operator**, password of your choice. | The user is created and listed as Active. |
| 4.2 | Private window: sign in as the TEST user. | Signed in. |
| 4.3 | Admin: on the TEST user's row, click **Set password**. Click **Generate a strong password**, note it, then **Set password**. | "New password set" appears, with advice to send it separately. |
| 4.4 | Private window: within about 30 seconds, click anything. | The TEST user is **signed out**. The login page shows "Your password was changed. Please sign in again." (this message needs the latest frontend update; if it's missing, note it). |
| 4.5 | Private window: sign in with the **old** password, then with the **new** one. | Old: "Invalid email or password." New: signed in. |
| 4.6 | Admin: try **Set password** with `short`, then with `abcdefgh` (no number). | Clear messages: at least 8 characters, and letters plus a number. |
| 4.7 | Admin: check your own row. | No **Set password** button on your own account. |
| 4.8 | Private window, as the TEST user: **Profile** (top right, or the sidebar avatar) → **Change password**. Enter a wrong current password. | "Your current password isn't right." You stay signed in. |
| 4.9 | Same, with the right current password and a new password equal to the current one. | Says it must be different. |
| 4.10 | Same, with a valid new password. | Signed out straight away. The login page says "Password changed. Sign in with your new password." (needs the latest frontend update). Sign in with the new password. |
| 4.11 | *(Optional)* As the TEST user, enter a wrong current password 6 times. | After 5 tries, a "too many attempts" message. You aren't signed out. |
| 4.12 | Admin: **Deactivate** the TEST user. | It's listed as Inactive, and **Set password** is no longer offered for it. |

## 5. Day pass credits

Create a contact with first name **`Qa`**, last name **`TEST daypass`**, and **your** email address. Use another `+daypass` alias so you can see the emails.

| # | Test | Expected |
|---|---|---|
| 5.1 | Open the contact. Find the **Day pass credits** card. | "0 days left". **Use half day** and **Use full day** are disabled. A hint explains packages. |
| 5.2 | **Add package**: 10 days, price 1800, note `TEST package`. | 10 days left. History shows "Package bought · HK$1,800". |
| 5.3 | **Use half day** with the date empty, then confirm. | "0.5 days used. 9.5 days left." History shows "Used · visit <today>". |
| 5.4 | **Use full day** with yesterday's date. | 8.5 left. The visit date is yesterday. |
| 5.5 | Keep using days until **5 or fewer** are left, e.g. 4 × full day leaves 4.5. | At the first visit at 5 or fewer, the message says **a low-balance email was sent**. You receive "Your Banyan day pass is running low" with the right balance. |
| 5.6 | Use another half day on the **same day**. | No second low-balance email today. The message doesn't claim one was sent. |
| 5.7 | Click **Email balance** and confirm. | "Balance emailed to …". You receive "Your Banyan day pass balance" with the right days and last visit. The card shows "Last balance email: …". |
| 5.8 | Use days until 0.5 is left, then try **Use full day**. | The button is disabled, or a clear "Only 0.5 days left" message appears. The balance never goes below 0. |
| 5.9 | Admin: **Adjust** with `+1`, note `TEST adjust`. Then `-1`, note `TEST undo`. | Both are listed with the right sign. Adjust without a note asks for one. |
| 5.10 | **Check-ins** page → **Day pass balances**. | Your contact is listed with its balance, last visit and last email. "5 days or fewer" filters it. Search by "daypass" finds it. |
| 5.11 | The contact's **Activity** (right column). | The two emails are logged. |
| 5.12 | Make a second contact `TEST QA daypass2` with your email. Add a package of **5** days, use a half day. | No email is sent (TEST names are skipped). The message gives the reason, if the latest frontend update is live. |

## 6. Calendar blocking settings (look only: don't save or sync)

| # | Test | Expected |
|---|---|---|
| 6.1 | Bookings and Calendar → **Meeting rooms** → **Room calendar settings** (Google Calendar). | The option reads "Block the website when a room is booked directly in Google Calendar" and is **off**. **If it's on, stop and report.** |
| 6.2 | Tick it **without saving**. | A box "Which room calendars block the website" appears. Small and large meeting rooms are ticked. **The Library is not ticked.** Rooms with no calendar ID are greyed out. |
| 6.3 | **Reload the page** without saving. | The option is off again. |
| 6.4 | In the **Google Calendar → website blocks** panel, click **Preview**. | A list of what *would* be blocked: "Rooms checked", "to block", "unchanged", any clashes with bookings, and a "Skipped" list (all-day events). Copy the summary into your report. Don't click **Sync now**. |
| 6.5 | Check banyanworkspace.com's room booking calendar for a day in the preview. | No new blocks. Nothing is written yet. |

## 7. Quick regression checks

| # | Test | Expected |
|---|---|---|
| 7.1 | Stay signed in for 20+ minutes as admin, then click around. | Still signed in. |
| 7.2 | Meeting rooms list, Calendar, Forms, Reports, Loyalty and Tasks. | Each loads without errors. |
| 7.3 | A company with meeting room credits: open its credits card. | It opens on the month of its next credit booking if there is one. Otherwise it opens on this month. |

## 8. Clean-up (before you report)

- [ ] TEST user `TEST QA user` is **deactivated**.
- [ ] List your TEST contacts (`TEST QA deal`, `Qa TEST daypass`, `TEST QA daypass2`, …), the company and deals. The CRM team will archive them. Don't bulk-delete.
- [ ] Nothing was changed in calendar blocking: the option is off, and no Sync was run.
- [ ] No real user's password was changed, and the admin's own password is unchanged.

## 9. Report

Send back `E2E_TEST_REPORT_2026-11-25.md` with:

1. **A summary table:** one row per test ID, with Pass / Fail / Blocked / Not tested.
2. **For each Fail:**
   - steps;
   - expected vs actual;
   - the exact error text;
   - a screenshot, with no logins or personal data;
   - whether you think it's the screen or the server.
3. **The §6.4 preview summary**, as text.
4. **The emails received in §5:** subject, balance shown, and time received.
5. **The clean-up list.**

Small things count too: confusing wording, slow screens, layout on phone or iPad.
