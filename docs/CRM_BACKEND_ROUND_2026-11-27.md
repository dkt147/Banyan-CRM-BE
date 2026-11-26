# Backend round: client feedback of 26 Nov 2026

**For:** the backend agent (Express/Mongo, `E:\Projects\Banyan-CRM-BE`, deployed on Render).
**From:** the CRM frontend team.
**Frontend:** built and ready. Each new screen checks for a 404 and shows "needs the latest server update" until your routes are live, so you can deploy in any order.

## What the client asked for

1. Make the timeline detailed.
2. Show Xero invoices on deals, contacts and companies.
3. Notes and emails as tabs, with an "Add note" button that saves the date and the author.
4. Let them edit the tag list.
5. Show the membership on the contact page.
6. Add birthdays, plus "Birthdays today" on the dashboard.

The frontend is done for all of them. The backend work is below, in priority order.

| # | Area | What's needed | Size |
|---|---|---|---|
| A | Notes | A new `/notes` API, stored as `Activity` records with type `note` | M |
| B | Detailed timeline | Before and after values on every edit, and richer `/related` activity items | M |
| C | Birthdays | A `Contact.birthday` field and `GET /contacts/birthdays` | S |
| D | Contact tags | A `ContactTag` collection and the `/contact-tags` routes | M |
| E | Xero invoices | Pull invoices made in Xero into the CRM and link them to contacts and companies | M–L |
| F | Memberships | No code change; the data needs checking | — |

General rules (the same as before):
- The envelope is `{ success, data }`.
- Errors are `AppError(message, status, CODE)`.
- Everything is scoped by `workspaceId`.
- Hong Kong time for any "day" logic.
- **Never return 401 for a validation problem.** A 401 makes the CRM try to refresh the session.

---

## A. Notes

The client said: "It is better if we can have a CTA to add a new note that will be dated, and we can see the user that created the note."

Store each note as an `Activity` with `type: "note"`, `body` set to the text and `userId` set to the author. Notes then appear on the timeline automatically.

### Routes

New file `src/routes/notes.routes.js`, mounted at `/api/v1/notes`, with `requireAuth` on every route.

| Method | Path | Body or query | Who | Returns |
|---|---|---|---|---|
| GET | `/notes` | `contactId` or `companyId` or `dealId` (exactly one is required), `limit` (default 50, max 100), `page` | any signed-in user | `{ items, pagination }`, newest first |
| POST | `/notes` | `{ body, contactId? , companyId? , dealId? }`, with at least one id | `records.write` | 201 with the note |
| PATCH | `/notes/:id` | `{ body }` | the author or an admin | the note |
| DELETE | `/notes/:id` | — | the author or an admin | `{ deleted: true }` |

**Note shape:**

```json
{ "_id": "...", "body": "Called Ken, wants a 2-person office from January.",
  "createdAt": "...", "updatedAt": "...",
  "userId": { "_id": "...", "name": "Jojo Leung" },
  "contactId": "...", "companyId": "...", "dealId": { "_id": "...", "title": "..." } }
```

Populate `userId` with `name` and `dealId` with `title`. The frontend shows "On deal: …" when a contact or company note came from a deal.

### Rules

1. **Linking, so a note is never hidden on another page:**
   - With a `dealId`: copy the deal's `contactId` and `companyId` onto the note.
   - With only a `contactId`: copy the contact's `companyId`.
   - GET by `contactId`, `companyId` or `dealId` then finds every note that has that id.
2. **`body`:**
   - Trim it; it must be 1–5000 characters.
   - Errors: `400 NOTE_EMPTY` and `400 NOTE_TOO_LONG`.
   - Store it as plain text. The frontend shows it with `white-space: pre-wrap`; don't render HTML.
3. **Ids:** every id must belong to the workspace. Otherwise return `404 NOT_FOUND`, and do the same for unknown notes.
4. **Who can change a note:**
   - Only the author or an admin can PATCH or DELETE it. Others get `403 NOT_NOTE_AUTHOR`.
   - PATCH sets `metadata.editedAt` and `metadata.editedBy`.
5. **Deleting:** a hard delete is fine. Also write an audit log entry (`note.deleted`, with the body in `before`).
6. **Don't** send notes through automations or emails.
7. **Indexes:** `{ workspaceId: 1, type: 1, contactId: 1, occurredAt: -1 }` and the same for `companyId` and `dealId`. Add them to the migration script.
8. **Old notes:** contacts and companies still have the old single `notes` text field. The frontend shows it as "Earlier notes" under the new notes, so no migration is needed.

### `/related` change

In `related.service.js`, add `sections.notes = { total }` (the count of notes for the record) so the Notes tab can show a number.

---

## B. Detailed timeline

The client sent a screenshot of a deal whose timeline only says "Deal updated" ×4.

### B1. Record what changed

When a **deal, contact, company or task** is updated, create an Activity with:

```js
{
  type: "deal_updated" | "contact_updated" | "company_updated" | "task_updated",
  subject: "<specific title>",             // see below
  userId,                                   // who did it
  dealId / contactId / companyId,           // as now
  metadata: {
    changed: ["stageId", "value"],          // keep: older screens use it
    changes: [
      { field: "stageId", label: "Stage", from: "Enquiry", to: "Trial completed" },
      { field: "value",   label: "Value", from: "HK$0",    to: "HK$1,800" }
    ]
  }
}
```

**Specific titles:**
- "Stage changed" (stage only)
- "Deal marked won" and "Deal marked lost"
- "Deal reopened"
- "Moved to <pipeline>"
- "Deal details updated" (anything else)
- "Contact updated" and "Company updated"
- "Tags changed" (tags only)
- "Task completed" and "Task updated"

**Readable values (`from`/`to` are strings):**

| Field | Show as |
|---|---|
| `stageId`, `pipelineId` | the stage or pipeline name |
| `ownerId`, `assignedTo` | the user's name |
| `contactId`, `companyId` | the contact's or company's name |
| `value`, money fields | `HK$1,800` |
| dates | `24 Nov 2026`, HK time; add the time only for datetimes |
| booleans | `Yes` / `No` |
| `tags` | labels joined with `, `, using the tag catalogue from part D |
| `birthday` | `14 Mar` or `14 Mar 1990` |
| empty | `null` (the frontend shows "empty") |

- Cut long text (`description`) to 200 characters with "…".
- Skip `updatedAt`, `metadata`, internal flags and anything that didn't actually change. Compare before and after; don't trust the payload's keys.
- If nothing changed, don't create an activity.
- One Activity per save, with all the changes in it.

**Contacts and companies have no update activity today.** Only `deal.service.js` and `task.service.js` create one. Add it in the contact and company update paths, and for tag changes, including bulk tagging.

### B2. Richer `/related` activity items

Each activity item in `GET /related/:type/:id` currently has `{ id, title, subtitle, date }`. Add these fields:

```js
{
  id, title, subtitle, date,
  type: a.type,                                   // "note", "deal_updated", "email_sent", …
  user: a.userId ? { id, name } : null,           // populate userId → name
  changes: a.metadata?.changes || [],
  changed: a.metadata?.changed || [],              // fallback for older entries
  body: a.type === "note" ? a.body : undefined     // full note text (max 5000)
}
```

- Raise the activities limit to **50**, newest first.
- `sections.activities.total` must be the true count.
- Older activities have no `changes`. The frontend shows "Changed: Stage, Value" from `changed`, so no backfill is needed.

---

## C. Birthdays

1. **`Contact.birthday`:** a String, either `"MM-DD"` (year unknown) or `"YYYY-MM-DD"`.
   - Validate it with `^(\d{4}-)?\d{2}-\d{2}$` and check it's a real date. `02-29` is allowed without a year, and with a year only if that year is a leap year. The year must be from 1900 to now.
   - `null` clears it.
   - Error: `400 INVALID_BIRTHDAY`.
   - The frontend already turns "14/03", "14 Mar 1990" and so on into this format.
2. **`Contact.birthdayMonthDay`:** a derived `"MM-DD"`, set whenever `birthday` changes (in create, update and import). Index it with `{ workspaceId: 1, birthdayMonthDay: 1 }`.
3. **POST, PATCH, GET and the CSV export** of contacts include `birthday`.
4. **`GET /contacts/birthdays?days=7`** (declare it **before** `/:id`):
   - `days` is 0–31, default 7.
   - "Today" means HK today.
   - Leave out archived contacts.
   - In non-leap years, show `02-29` birthdays on 28 Feb.
   - Populate `companyId` with `name`.
   - Return:
     ```json
     { "date": "2026-11-27",
       "today":    [{ "_id", "firstName", "lastName", "email", "birthday", "companyId": { "name" } }],
       "upcoming": [{ "...same", "nextBirthday": "2026-11-29", "inDays": 2 }] }
     ```
   - `upcoming` covers the next `days` days, sorted by `inDays`; `today` is `inDays` 0.
   - Any signed-in user can call it.
5. **Not now:** an automatic birthday email or task. The client hasn't asked for one, but a `contact_birthday` automation trigger could come later.

---

## D. Contact tags (editable)

The client asked: "Can we edit the tags list on our end? If they evolve in the future."

1. **New model `ContactTag`:**
   ```js
   { workspaceId, key, label, description, group: "segment" | "source",
     isActive: true, isSystem: false, sortOrder: 0 }
   ```
   - Unique index on `{ workspaceId, key }`.
2. **Seed from `TAG_CATALOGUE`** (`src/utils/contactTags.js`) on first access per workspace (or in the migration):
   - Insert only the missing keys; **never overwrite** a label the team has edited.
   - Source tags get `isSystem: true`, because the CRM adds them automatically.
   - The built-in list (keys, labels, groups) matches the frontend's `src/utils/contactTags.js`.
3. **Routes:**
   - **`GET /contact-tags?includeInactive=true`:**
     - Any signed-in user.
     - Returns `items`, sorted by group (segment first), then `sortOrder`, then `label`.
     - Without `includeInactive`, only active tags.
   - **`POST /contact-tags {label, description, group}`:**
     - Admin only.
     - `key` = the label lowercased, with anything that isn't a letter or digit turned into `_` and trimmed, max 50 characters. It must match the existing `TAG_PATTERN`.
     - Errors: `409 TAG_EXISTS` when the key or the label (case-insensitive) already exists, including archived tags. `400 INVALID_TAG` when the key is empty.
     - Label max 50 characters, description max 200.
   - **`PATCH /contact-tags/:id {label?, description?, group?, isActive?, sortOrder?}`:**
     - Admin only.
     - **`key` never changes,** so renaming a tag renames it on every contact at once.
     - `group` can't change for `isSystem` tags.
     - Same 409 for a duplicate label.
   - **No DELETE.** Archiving (`isActive: false`) hides the tag from pickers, and contacts keep it.
   - Write an audit log entry for each create and edit.
4. **`GET /contacts/tag-catalogue`:** return the workspace's DB list in place of the constant, keeping `pattern` and `maxPerContact`.
5. **Contact `tags` validation stays as it is.** Any key matching the pattern is accepted, so older custom tags keep working.
6. **Wherever the backend shows a tag label** (reports, exports, timeline `changes`), use the DB label.

---

## E. Xero invoices on deals, contacts and companies

**What the frontend does:**
- It calls `GET /invoices?contactId=…` (or `companyId=` or `dealId=`) with `sort=createdAt&order=desc&limit=20`. This already works with the generic resource list.
- An invoice opens in Xero when `provider === "xero"` and `externalId` is set, using `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=<externalId>`.
- If `metadata.onlineInvoiceUrl` is set, that link is used instead.

**The gap:**
- Today the CRM only **pushes** CRM-made invoices to Xero (`xero.controller.js`).
- Invoices the team creates **in Xero** never reach the CRM, so the tab is empty for most clients.

**Please add a pull sync:**

1. **`POST /integrations/xero/sync-invoices`** (admin), plus a job every 30 minutes while Xero is connected:
   - Fetch `GET /api.xro/2.0/Invoices` with `If-Modified-Since` set to the last sync time, `where=Type=="ACCREC"`, paged.
   - The first run covers invoices **from 1 Jan 2026** onwards, matching the reports' start.
2. **Upsert** on `{ workspaceId, provider: "xero", externalId: InvoiceID }`:
   - Copy `invoiceNumber`, `total`, `subtotal`, `tax`, `currency`, `dueAt`, `paidAt` (FullyPaidOnDate) and `description` (the first line item).
   - Map the status:

     | Xero | CRM |
     |---|---|
     | DRAFT, SUBMITTED | `draft` |
     | AUTHORISED (unpaid) | `awaiting`, or `overdue` once past due |
     | PAID | `paid` |
     | VOIDED, DELETED | `cancelled` |

   - Set `source: "xero_sync"`.
   - `createdBy` is required. Use the admin who connected Xero, or the workspace owner.
3. **Matching the Xero contact to the CRM:**
   - `Contact.EmailAddress` to a CRM contact's email (case-insensitive). The contact's `companyId` gives the company.
   - Otherwise `Contact.Name` to a CRM company name (case-insensitive), which sets `companyId` only.
   - Store `metadata.xeroContactId`.
   - Don't create new CRM contacts from Xero.
   - Unmatched invoices are still saved, unlinked. Count them in the sync result.
4. **Deals:**
   - Link an invoice to a deal only when the CRM created it from the deal (that already happens on push), or when the Xero `Reference` contains the deal number, e.g. `#3337`.
5. **Optional:** fetch `GET /Invoices/{id}/OnlineInvoice` for unpaid invoices and store `metadata.onlineInvoiceUrl`.
6. **Never write back to Xero during the pull.**
7. **Sync result:** return `{ fetched, created, updated, linkedToContact, linkedToCompany, unmatched }` and keep the last result in `Integration.metadata`.

**Also check `GET /invoices` permissions:** an operator (sales) role probably needs read access. The frontend shows "You don't have access to invoices." on a 403.

---

## F. Membership on the contact page

- **No code change needed.** The frontend calls `GET /memberships?contactId=…` (and `companyId=` on companies) and shows the live one (active, trial or paused): plan name, since, renews or ends, monthly value, seats and member code.
- **Please check the data:**
  - Do real members have `Membership` records with a `planId`?
  - Are they created when a membership deal is won? If not, the card says "Not a member" for everyone.
  - Let us know whether memberships are created by hand, by import, or not at all yet.

---

## G. Not in this round (for planning only)

- **Eventbrite:** the client is choosing between two options. We recommended option 1, an Eventbrite webhook (`order.placed`) that creates or updates the contact and adds an `event_<id>` tag. Don't build it until they confirm.
- **Email and WhatsApp test:** this is a test session, not a build. It needs the Gmail API enabled (done on 25 Nov) and a connected WhatsApp Business number.
- **Meeting room booking flow:** the client says it "doesn't seem to work" and will go through it with us. Have the room booking logs ready.

## H. When you're done

Reply with:
- each part (A–E) marked done, partly done or not done;
- the commit hash;
- any field or name that differs from this spec;
- whether `npm run migrate -- --apply` is needed (indexes for notes, birthdays and tags).
