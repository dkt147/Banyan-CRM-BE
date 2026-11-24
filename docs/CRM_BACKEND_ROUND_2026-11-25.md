# Backend: client meeting 25 Nov — date filters, passwords, day pass credits, calendar blocking

**For:** the CRM backend agent (`Banyan-CRM-BE`).
**From:** the CRM frontend, after the client review meeting on 25 Nov 2026.

The frontend for all of this is built. Each screen says "needs the latest server update" (or simply hides itself) until your routes exist, so nothing breaks in between. The client reviews again tomorrow afternoon, so please do §1–§3 first.

## Summary

| # | What | Client ask | Size |
|---|---|---|---|
| 1 | `createdFrom` / `createdTo` on `GET /contacts` and `GET /deals` | "See all new contacts from last week to today" | Small |
| 2 | Passwords: admin sets a user's password; users change their own | Jojo couldn't sign in, and there was no way to fix it | Small |
| 3 | Day pass credits: packages, half/full-day use, balance email, low-balance email | Replaces the front desk's Excel file | Medium–large |
| 4 | Calendar → website blocking, per room | Rooms booked by hand in Google Calendar are double-booked | Small–medium |
| 5 | Reports from 2026 only | "We need data from 2026 onward" | Done in the frontend |

---

## 1. Date filters on Contacts and Deals

**Request:** `GET /contacts?createdFrom=2026-11-18&createdTo=2026-11-25` and `GET /deals?...`, with the same two params.

- **Format:** `YYYY-MM-DD` **Hong Kong** calendar dates, **inclusive** at both ends.
- **Range:** `createdFrom` means `createdAt >= <date>T00:00:00+08:00`. `createdTo` means `createdAt < <date + 1 day>T00:00:00+08:00`.
- **Either one alone** is allowed.
- **Combine** with every existing filter (search, tag, companyId, isArchived, ownerId, status, pipelineId) and keep the pagination totals right.
- **Bad dates** (`2026-13-01`, or from > to): return `400 INVALID_DATE_RANGE` with a clear `message`.
- Add an index on `{ workspaceId: 1, createdAt: -1 }` for both collections if one isn't there.

The frontend presets (Today, Yesterday, Last 7 days, This week, Last week, Last 30 days, This month, Last month, Custom) all resolve to these two params.

## 2. Passwords

There's currently **no** way to change a password after a user is created (`member.controller.js update` doesn't allow `password`). Jojo couldn't sign in, and the only fix was editing the database by hand.

### 2a. Admin sets a password: `POST /members/:id/password`

- **Permission:** `users.manage` (admin). Same workspace only.
- **Body:** `{ password }`.
- **Rules:** at least 8 characters, with a letter and a number. Return `400 WEAK_PASSWORD` with a message if not.
- **Effect:**
  - hash with bcryptjs (cost 12, as on create);
  - **revoke all that user's refresh tokens**, so other devices are signed out;
  - write an audit entry `user.password_set` (actor and target only; never log the password).
- **Never** allow it on yourself here. Return `400 USE_CHANGE_PASSWORD`, because the frontend sends you to "Change password".
- **Inactive users:** refuse with `409 USER_INACTIVE`. Reactivate them first.
- **Response:** `{ success: true, data: { id, passwordChangedAt } }`.

### 2b. Change own password: `POST /auth/change-password`

- **Auth:** the signed-in user.
- **Body:** `{ currentPassword, newPassword }`.
- **Wrong current password:** **`400 INVALID_CURRENT_PASSWORD`, not 401.** The frontend treats any 401 as "session expired" and would sign the user out.
- **Same password rules** as 2a. The new password must differ from the current one: `400 SAME_PASSWORD`.
- **Effect:** hash, revoke **all** refresh tokens for the user (including the current one), and audit `user.password_changed`. The frontend then shows "Password changed" and signs the user out, so they sign in again with the new password.
- **Rate limit:** at most 5 attempts per user per 15 minutes. After that, `429` with a message.
- **Store** `passwordChangedAt` on the user.

### Not needed now

A "Forgot password?" email link isn't required yet. Admins can set a password (2a). If it's cheap to add later, use a one-hour single-use token emailed via `sendWorkspaceEmail`.

## 3. Day pass credits (packages)

### What the client said
Some members have no agreement. They buy a **10-day pass** up front at a better price and use it **by the half day or full day**. Today a colleague keeps an Excel sheet and takes off 0.5 every time someone checks in. They want:

1. the **balance on the contact page**;
2. a button to **email the member their balance** whenever staff decide;
3. an **automatic email when the balance is 5 or fewer**, so staff don't have to remember;
4. **half days**.

Agreed design: the unit is **days, in half-day steps** (0.5). Balances are **per contact**.

### Data
A new collection, e.g. `DayPassEntry`:

```
{ workspaceId, contactId,
  type: "purchase" | "redeem" | "adjust" | "refund",
  days: Number,        // signed: purchase +10, redeem −0.5 / −1, adjust ±, refund +
  amount: Number|null, // HK$ paid, purchases only (optional)
  date: "YYYY-MM-DD"|null, // visit date, redeems only (HK)
  note, by: <user name>, byId, at: Date }
```

- **Balance** = the sum of `days`. Cache it on the contact as `dayPassBalance` if that helps list queries, but the entries are the source of truth.
- **Half steps:** every `days` must be a multiple of 0.5. Reject anything else with `400 INVALID_DAYS`.
- **Low emails:** store `lastBalanceEmailAt` and `lastLowBalanceEmailAt` on the contact, or on a small `DayPassAccount` doc.

### Routes (all under `/contacts/:id/day-passes`, same workspace)

| Route | Permission | Body | Notes |
|---|---|---|---|
| `GET /` | records.read | — | `{ balance, lowThreshold: 5, autoEmail: true, lastBalanceEmailAt, lastLowBalanceEmailAt, entries: [...newest first, max 200] }`. Each entry: `{ id, type, days, amount, date, note, by, at }`. A contact with no entries returns `balance: 0, entries: []`, not 404. |
| `POST /purchase` | records.write | `{ days (0.5–100), amount?, note? }` | Adds a package. Returns `{ balance, entry }`. |
| `POST /redeem` | records.write | `{ days: 0.5 \| 1, date?, note? }` | `date` defaults to today (HK). If the balance is short: `409 INSUFFICIENT_DAY_PASSES` "Only 0.5 days left." Returns `{ balance, entry, lowBalanceEmailSent: bool }`. |
| `POST /adjust` | credits.adjust (admin) | `{ days (±, non-zero), note (required) }` | Corrections. The balance may not go below 0. |
| `POST /email-balance` | records.write | `{}` | Sends the balance email now. `400 NO_EMAIL` if the contact has no email. Returns `{ sentAt }`. |

**List for the front desk:** `GET /day-passes?search=&low=true&page=&limit=` → `{ items: [{ contact: { _id, firstName, lastName, email }, balance, lowThreshold, lastUsedAt, lastBalanceEmailAt }], pagination }`.
- Only contacts with at least one entry.
- Ordered by lowest balance first, then name.
- `low=true` means balance ≤ 5.
- Excludes archived contacts.

### Emails
Use `sendWorkspaceEmail` (Gmail as info@, as other CRM emails do). Plain, friendly and short; no amounts other than days.

- **Balance email** (button), subject "Your Banyan day pass balance":
  > Hi <first name>, you have **7.5 days** left on your Banyan Workspace day pass. Your last visit was on 24 Nov. See you soon! — The Banyan team
- **Low-balance email** (automatic), subject "Your Banyan day pass is running low":
  > Hi <first name>, you have **4.5 days** left on your day pass. To top up with a new 10-day package, just reply to this email or ask at the front desk.
  - **When:** after a `redeem` that leaves the balance **≤ 5**. The meeting said customers should "constantly receive the email", so send after **each** such redeem, at most **once per day** per contact.
  - **At 0:** use the wording "Your day pass has no days left".
  - **Never** send for TEST contacts (first name starting with "TEST"); record it as skipped.
  - **Never** let an email failure fail the redeem. Return `lowBalanceEmailSent: false` and log it.
- Record each email as an Activity on the contact (`type: "email"`, subject), so it shows on the contact timeline.

### Optional (nice to have)
- On `POST /check-ins` with `{ contactId, dayPassDays: 0.5|1 }`, also create the redeem entry, so the front desk can do both in one step. The frontend uses the contact-page buttons for now.
- `type: "refund"` when a redeem is undone (e.g. a mistake). For now an admin uses Adjust with a note.

## 4. Calendar → website blocking, per room

**The problem the client raised:** if someone books a room directly in Google Calendar (e.g. "Meeting Room 8, 16:00–17:00"), the website and the CRM can still sell that slot.

**What exists:**
- `partnerBlocks.service.js` already turns non-CRM events in the room calendars into WordPress blocks through `POST /wp-json/banyan/v1/blocks`. That WordPress route now exists: it answers `401` without the token, not `404`.
- It runs every 10 minutes when `partnerBlocks.enabled` is on. It's currently **off**.

**Change:**
1. **Per-room setting:** `partnerBlocks: { enabled, rooms: { small: bool, medium: bool, library: bool } }` on `GET`/`PUT /room-bookings/google-calendars`.
   - Defaults when missing: small and medium **true**, library **false**. The Library is the partner's live calendar, so it's only blocked when an admin ticks it.
   - Only rooms that are **ticked and have a calendar ID** are scanned.
   - Unticking a room removes the blocks the CRM created for it (only CRM-created blocks, by `external_id`).
2. **Speed:** run it every **3 minutes** while enabled, instead of 10. Also run it straight after the Google Calendar poll if that poll saw changes in a room calendar. Keep the WordPress call count low by only sending creates and deletes for events that changed.
3. **Safety, as today:**
   - Never write to Google Calendar.
   - Skip the CRM's own booking events (`isOwnedEvent`).
   - Skip all-day events unless they're inside opening hours.
   - Never create a block over an existing paid WordPress booking. Log it as a conflict, and show it in `GET /room-bookings/partner-blocks` → `conflicts[]` with the event title, room, date and time, so staff can sort it out.
4. **Preview:** `GET /room-bookings/partner-blocks/preview` should respect the per-room ticks, so staff can see exactly what would be blocked before switching on.
5. **CRM calendar:** blocked slots already show, because the CRM reads availability from WordPress. Confirm the CRM "New booking" picker shows them as Booked, since it reads WordPress availability live.

Tell us when it's deployed. The user will switch it on for the two meeting rooms first, check the preview, and leave the Library off until the client confirms.

## 5. Reports from 2026 (for information)

The frontend no longer offers years before 2026. Breakdowns never start before 1 Jan 2026, and the yearly report's year list starts at 2026. No backend change is needed. If `GET /reports/periodic` or `/reports/breakdown` gets a `from` before 2026-01-01, clamping it is fine.

## Tests to add
- Date filters: inclusive edges at HK midnight, either param alone, a bad range giving 400.
- Passwords: admin set (revokes tokens, can't use it on self or an inactive user), change (wrong current password gives 400 not 401, same-password rule, revokes tokens, rate limit).
- Day passes: purchase/redeem/adjust maths in half steps, insufficient balance gives 409, low email at ≤ 5 sent at most once a day, no email for TEST names, the list is ordered by balance.
- Partner blocks: per-room ticks respected, Library off by default, unticking removes only CRM-created blocks.

## Reply needed
- What's live, and the commit.
- Example responses for `GET /contacts/:id/day-passes` and `GET /day-passes`.
- The partner-blocks preview output for the two meeting rooms (read-only) before anyone switches it on.
