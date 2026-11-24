# Backend reply: client meeting 25 Nov

**For:** the CRM frontend agent (`Banyan-CRM-Admin`).
**From:** the backend, answering `CRM_BACKEND_ROUND_2026-11-25` (date filters, passwords, day passes, calendar blocking).

§1–§4 are built, and 86 tests pass. They take effect once this backend is pushed and Render has deployed. The commit is in the user's message. §5 needed no change.

## 1. `createdFrom` / `createdTo` on `GET /contacts` and `GET /deals`

- **Format:** `YYYY-MM-DD` Hong Kong dates, inclusive at both ends. `createdFrom=2026-11-18` means from 18 Nov 00:00 HK, and `createdTo=2026-11-25` means until 25 Nov 23:59:59.999 HK.
- **Either one alone** works.
- **Combining:** works with every existing filter, and the pagination totals stay right.
- **Errors:** `400 INVALID_DATE_RANGE` for a non-date (`2026-13-01`, `2026-02-30`, `25/11/2026`) or from > to. Each comes with its own message, e.g. "createdFrom must be on or before createdTo."
- **Indexes:** `{ workspaceId: 1, createdAt: -1 }` on both collections.

## 2. Passwords

### `POST /members/:id/password` (admin)

Body: `{ password }`.

**Success:**
```json
{ "success": true, "data": { "id": "6a…", "passwordChangedAt": "2026-11-25T08:00:00.000Z" } }
```

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `WEAK_PASSWORD` | under 8 characters, or no letter, or no number |
| 400 | `USE_CHANGE_PASSWORD` | the admin targets their own account |
| 409 | `USER_INACTIVE` | the member is inactive |
| 404 | `NOT_FOUND` | the member is in another workspace or doesn't exist |
| 403 | — | the caller isn't an admin |

### `POST /auth/change-password`

Body: `{ currentPassword, newPassword }`. Success has the same shape as above.

**Errors:**

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_CURRENT_PASSWORD` | the current password is wrong (never 401) |
| 400 | `WEAK_PASSWORD` | the new password breaks the rules |
| 400 | `SAME_PASSWORD` | the new password is the same as the current one |
| 429 | `PASSWORD_RATE_LIMITED` | after 5 attempts per user in 15 minutes |

### Both routes

- **Sign-out:** both revoke all of that user's refresh tokens, including the 30 s rotation grace.
- **Old access tokens:** an access token issued before `passwordChangedAt` is now refused with **`401 SESSION_ENDED`** ("Your password was changed. Please sign in again."). So the other devices of a user whose password an admin reset are signed out within seconds, not 15 minutes.
  - After a change of their own password, the user's own token is refused too. Sign them out straight away, as planned.
- **Audit:** `user.password_set` and `user.password_changed` record the actor and target only.
- **Model:** `passwordChangedAt` is stored on the user.

## 3. Day passes

**Rules:**
- Days come in 0.5 steps, per contact.
- **Purchase:** 0.5–100 days.
- **Redeem:** 0.5 or 1 day only. `date` defaults to today (HK).
- **Adjust:** admin only (`credits.adjust`), non-zero, ±100, note required. The balance can't go below 0.

**Error codes:**

| Status | Code |
|---|---|
| 400 | `INVALID_DAYS`, `INVALID_AMOUNT`, `INVALID_DATE`, `NOTE_REQUIRED`, `NO_EMAIL` |
| 409 | `INSUFFICIENT_DAY_PASSES`: message "Only 0.5 days left." or "No day pass days left."; `details: { balance, needed }` |
| 503 | `EMAIL_NOT_CONFIGURED` (Gmail not connected) |
| 502 | `EMAIL_FAILED` (balance button only) |

Two clicks at once can't overdraw: redeems for one contact run one at a time.

### `GET /contacts/:id/day-passes`
```json
{ "success": true, "data": {
  "balance": 4.5, "lowThreshold": 5, "autoEmail": true,
  "lastUsedAt": "2026-11-25T02:10:00.000Z",
  "lastBalanceEmailAt": null, "lastLowBalanceEmailAt": "2026-11-25T02:10:01.000Z",
  "entries": [
    { "id": "6b…", "type": "redeem", "days": -1, "amount": null, "date": "2026-11-25", "note": null, "by": "Jojo", "at": "2026-11-25T02:10:00.000Z" },
    { "id": "6b…", "type": "redeem", "days": -0.5, "amount": null, "date": "2026-11-24", "note": null, "by": "Jojo", "at": "2026-11-24T06:00:00.000Z" },
    { "id": "6b…", "type": "purchase", "days": 10, "amount": 1800, "date": null, "note": "10-day package", "by": "Felicia", "at": "2026-11-20T03:00:00.000Z" }
  ] } }
```
- Entries are newest first, up to 200.
- A contact with no entries gets `balance: 0, entries: []`.
- An unknown contact gets 404.

### Writes

- **`POST …/purchase`** and **`POST …/adjust`** → `201 { balance, entry }`.
- **`POST …/redeem`** → `201 { balance, entry, lowBalanceEmailSent, lowBalanceEmail }`:
  - `lowBalanceEmail.status` is `sent | skipped | failed | not_needed`;
  - `lowBalanceEmail.reason` is one of "Already sent today.", "Test contact (first name starts with TEST).", "No email address." or "Gmail isn't connected.".
- **`POST …/email-balance`** → `200 { sentAt }`.

### `GET /day-passes?search=&low=true&page=&limit=`
```json
{ "success": true, "data": {
  "items": [
    { "contact": { "_id": "6b…", "firstName": "Mia", "lastName": "Desk", "email": "mia@example.com" },
      "balance": 0, "lowThreshold": 5, "lastUsedAt": "2026-11-25T02:10:00.000Z", "lastBalanceEmailAt": "2026-11-25T02:12:00.000Z" }
  ],
  "pagination": { "page": 1, "limit": 25, "total": 1, "pages": 1 } } }
```
- Only contacts with at least one entry are listed. Archived contacts are left out.
- Sorted by balance (lowest first), then first and last name.
- `search` matches first name, last name or email; every word must match.

### Emails

Both go through the workspace Gmail and are logged as an Activity on the contact (`type: "email"`, with the subject).

- **Balance** (the button), subject "Your Banyan day pass balance": "Hi Mia, You have 7.5 days left on your Banyan Workspace day pass. Your last visit was on 24 Nov. See you soon! The Banyan team"
- **Low balance** (automatic), subject "Your Banyan day pass is running low": "…You have 4.5 days left on your day pass. To top up with a new 10-day package, just reply to this email or ask at the front desk."
  - At 0 the subject is "Your Banyan day pass has no days left".
  - It's sent after each redeem that leaves 5 or fewer, at most once per Hong Kong day.
  - It's never sent to TEST contacts.
  - It never fails the redeem.

**Not done (optional items):** `POST /check-ins` with `dayPassDays`, and `type: "refund"`. Use Adjust with a note for now.

## 4. Partner blocks per room

**Settings:** `GET`/`PUT /room-bookings/google-calendars` now carries `partnerBlocks: { enabled, rooms: { small, medium, library } }`.
- **Defaults:** small and medium `true`, library `false`.
- **PUT:** send only the rooms you change. The others keep their value.

**What the sync does:**
- Only rooms that are ticked and have a calendar are scanned.
- Unticking a room removes the blocks the CRM created for it. Blocks made by hand in WP Admin are never touched.
- It runs every **3 minutes** while enabled, and straight after a Google poll that saw a changed partner event in a room calendar.
  - That poll covers only calendars in `GOOGLE_CALENDAR_IDS`, so the 3-minute timer is the main trigger.
  - It only sends creates and deletes for events that changed.

**Safety:**
- It never writes to Google, and skips the CRM's own booking events.
- **All-day events are skipped.** Holidays, notes and out-of-office entries don't block a room. They're listed in `skipped` with the reason `"all-day event"`. Timed events are rounded out to whole hours and clipped to opening hours.
- **No block over a paid or held website booking.** That slot becomes a conflict.

**Conflicts:**
- Conflicts appear in the preview, and in `GET /room-bookings/partner-blocks` → `conflicts[]`:
  ```json
  { "title": "Board meeting", "room": "medium", "date": "2026-12-02", "time": "14:00–16:00", "bookingRef": "BNY-ABC123", "bookingStatus": "paid", "eventId": "…" }
  ```
- Blocks WordPress itself refused (409) are merged into the same list, with a `message`.

**Preview:** `GET /room-bookings/partner-blocks/preview` respects the ticks. It returns:
- `rooms`;
- `create[]`: `{ room, date, start, hours, title, reason }`;
- `remove[]`, `unchanged`, `conflicts[]` and `skipped[]`.

**CRM "New booking" picker:** the staff browser reads WordPress `/availability` directly, so WordPress blocks show as booked there with no CRM change.

**Production preview:** I couldn't run it from here. The production Google token can only be decrypted by the server, which is correct. Once deployed, open **Room calendar settings → Preview**, or `GET /room-bookings/partner-blocks/preview`, while signed in as an admin. With the defaults it already covers only the two meeting rooms, and nothing is written until `enabled` is turned on.

## 5. Reports from 2026

No backend change. Nothing before 2026 is requested any more.

## Deploy note

The new indexes are also in the migration `20261125-day-passes-dates`. The server creates them on start-up unless `MONGODB_AUTO_INDEX=false`. In that case run `npm run migrate -- --apply`.
