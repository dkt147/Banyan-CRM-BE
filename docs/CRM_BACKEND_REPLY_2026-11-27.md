# Backend reply: client feedback of 26 Nov

**For:** the CRM frontend team (`Banyan-CRM-Admin`).
**From:** the backend, answering "Backend round: client feedback of 26 Nov 2026".

A–E are done, and 92 tests pass. F is a data check: the answer is below. Everything takes effect once this backend is pushed and Render has deployed. The commit hash is in the user's message.

| Part | Status |
|---|---|
| A Notes | Done |
| B Detailed timeline | Done |
| C Birthdays | Done |
| D Contact tags | Done |
| E Xero invoices | Done |
| F Memberships | Checked: there are none yet (see F) |

## Where this differs from the spec

- **Admin-only routes** (`POST`/`PATCH /contact-tags`, `POST /integrations/xero/sync-invoices`) use the existing `workspace.manage` permission, which only admins have.
- **Sync result storage:** the Xero sync result is kept in `Integration.config.invoiceSync = { lastSyncAt, lastResult, lastError }`, because `Integration` has no `metadata` field. `GET /integrations/xero/status` now returns it as `invoiceSync`.
- **Sync result fields:** the result also has `linkedToDeal` and `onlineLinks`.
- **`GET /contacts/tag-catalogue`** returns **all** tags, including archived ones, each with `isActive`. That way the labels of archived tags still show on the contacts that have them. Hide `isActive: false` tags in pickers. Each tag also has `automatic` (the same as `isSystem`) for older screens.
- **`GET /contacts/birthdays`:** `upcoming` includes today's birthdays, with `inDays: 0`. `today` lists the same contacts without `nextBirthday` and `inDays`.
- **Extra error codes:**

  | Code | When |
  |---|---|
  | `400 NOTE_TARGET_REQUIRED` | the notes list doesn't get exactly one id, or a new note has no id |
  | `400 TAG_KEY_IMMUTABLE` | a PATCH tries to change `key` |
  | `400 TAG_SYSTEM_GROUP` | a PATCH changes the group of a built-in source tag |
  | `400 VALIDATION_ERROR` | `days` outside 0–31 on birthdays, or a tag description over 200 characters |

- **Bulk tagging:** there's no bulk endpoint on the backend. Tag changes go through `PATCH /contacts/:id`, and each one is logged ("Tags changed").
- **Tag labels:** the backend shows tag labels only in the timeline `changes`. The reports and exports don't print tag labels; contact CSV export happens in the frontend. The timeline uses the database labels.
- **Note responses** also carry `editedAt`, `editedBy { _id, name }` and `occurredAt`.

## A. Notes

The routes are as specified, under `/api/v1/notes`.

- **Storage:** each note is an `Activity` with `type: "note"`, `subject: "Note"`, `body` and `userId`. Notes appear on the timeline automatically.
- **Linking:**
  - a deal note copies the deal's contact and company;
  - a contact note copies the contact's company.

  The Notes tab on all three pages finds it.
- **Errors:**

  | Code | When |
  |---|---|
  | `400 NOTE_EMPTY` / `400 NOTE_TOO_LONG` | the body is empty after trimming, or over 5000 characters |
  | `404 NOT_FOUND` | an id isn't in the workspace, or the note doesn't exist |
  | `403 NOT_NOTE_AUTHOR` | someone other than the author or an admin edits or deletes |
  | `403` | read-only users try to write |

- **Edits** set `metadata.editedAt` and `metadata.editedBy`.
- **Deletes** are hard deletes, with the audit entry `note.deleted` (the body is in `before`).
- **Notes count:** `GET /related/:type/:id` now has `sections.notes.total` for contact, company and deal.

## B. Detailed timeline

- **Which saves:** every save of a deal, contact, company or task writes **one** Activity, and only when something actually changed. The before and after values are compared; the payload's keys aren't trusted.
- **Metadata:** each Activity carries `metadata.changed` (field names) and `metadata.changes: [{ field, label, from, to }]`. `from` and `to` are readable strings, or `null` for empty.
- **Titles:**
  - deals: "Stage changed", "Deal marked won", "Deal marked lost", "Deal reopened", "Moved to <pipeline>" or "Deal details updated";
  - contacts: "Contact updated", or "Tags changed" when only the tags changed;
  - companies: "Company updated", or "Tags changed";
  - tasks: "Task completed" or "Task updated". Snoozing logs "Task updated" too.
- **How values are shown:**
  - stage, pipeline, user, contact and company names;
  - money as `HK$1,800`;
  - dates as `1 Dec 2026`, with `, 10:00` added only for date-times that aren't at midnight in Hong Kong;
  - `Yes` / `No`;
  - tag labels from the database;
  - birthdays as `14 Mar 1990`;
  - status as `Won`, `Lost`, `Open` and so on;
  - long text cut to 200 characters with "…".
- **Fields left out:** `updatedAt`, `metadata`, `lastActivityAt`, `stageChangedAt`, `closedAt`, `completedAt`, `phoneNormalized`, `birthdayMonthDay` and other internal fields.
- **Moving pipelines:** moving a deal to another pipeline also lists the stage change in the same Activity.
- **`/related` activity items:**
  - new fields: `type`, `user: { id, name } | null`, `changes`, `changed`, and `body` (notes only, up to 5000 characters);
  - up to 50 items, newest first;
  - `sections.activities.total` is the true count.

## C. Birthdays

- **`Contact.birthday`:** `"MM-DD"` or `"YYYY-MM-DD"`, checked as a real date.
  - `02-29` is allowed without a year, and with a year only in a leap year. The year must be from 1900 to now.
  - `null` or `""` clears it.
  - Otherwise `400 INVALID_BIRTHDAY`.
- **`birthdayMonthDay`** is kept in sync by the model on every create, update and import path. It's indexed with `{ workspaceId: 1, birthdayMonthDay: 1 }`.
- **`GET /contacts/birthdays?days=7`:**
  - shape: `{ date, today: [...], upcoming: [...{ nextBirthday, inDays }] }`;
  - `companyId` is populated with `name`;
  - archived contacts are left out;
  - "today" is Hong Kong today;
  - in non-leap years, 29 Feb birthdays show on 28 Feb.

## D. Contact tags

- **Seeding:** `ContactTag` is filled from `TAG_CATALOGUE` the first time a workspace uses it. Only missing keys are inserted, so edited labels are never overwritten. Source tags get `isSystem: true`.
- **`GET /contact-tags[?includeInactive=true]`** → `{ items }`, sorted segment first, then `sortOrder`, then `label`.
- **Each item:** `{ _id, id, key, label, description, group, isActive, isSystem, automatic, sortOrder }`.
- **`POST /contact-tags`** (admin):
  - the key is made from the label (`"Corporate Partner!"` → `corporate_partner`);
  - `409 TAG_EXISTS` when the key or the label (case-insensitive) is already used, archived tags included;
  - `400 INVALID_TAG` when the label has no letter or digit.
- **`PATCH /contact-tags/:id`** (admin): label, description, group, `isActive` and `sortOrder` can change; `key` never does.
- **No DELETE.**
- **Audit:** `contact_tag.created` and `contact_tag.updated`.
- **Validating contact tags is unchanged:** any key matching the pattern is still accepted.

## E. Xero invoices

**Running it:** `POST /integrations/xero/sync-invoices` (admin) runs a pull straight away. A job also runs every 30 minutes, starting 2.5 minutes after the server starts, for every workspace with Xero connected.

**Fetching:**
- **First run:** ACCREC invoices dated from 1 Jan 2026 onwards.
- **Later runs:** `If-Modified-Since` the last sync, minus 5 minutes of overlap.
- Pages of 100.
- Xero contact emails come from `GET /Contacts?IDs=…`, 50 at a time.

**Saving:**
- Invoices are upserted on `{ workspaceId, provider: "xero", externalId: InvoiceID }`.
- New invoices get `source: "xero_sync"`, and `createdBy` is the admin who connected Xero, or failing that the workspace owner.
- Status mapping: DRAFT and SUBMITTED → `draft`; AUTHORISED → `awaiting`, or `overdue` once past due; PAID → `paid`; VOIDED and DELETED → `cancelled`.
- Copied fields: `invoiceNumber`, `total`, `subtotal`, `tax`, `currency`, `dueAt`, `paidAt` (`FullyPaidOnDate`) and `description` (the first line item).
- `metadata` also has `xeroContactId`, `xeroContactName`, `xeroReference`, `xeroStatus`, `xeroAmountDue` and `xeroUpdatedAt`.

**Linking** (only when the CRM invoice has no link yet):
- by the Xero contact's email, to a CRM contact, which also gives its company;
- otherwise by the Xero contact's name, to a CRM company;
- to a deal through `#<dealNumber>` in the Reference.

Invoices the CRM pushed keep their deal. No CRM contacts are created. Unmatched invoices are saved without links and counted as `unmatched`.

**Safety:**
- A CRM invoice already marked **paid** (e.g. through Stripe) is never moved back to unpaid by Xero.
- The sync **never writes to Xero**.

**`metadata.onlineInvoiceUrl`:** fetched for unpaid invoices, at most 20 per run. Invoices without an online link are skipped quietly.

**Result:** `{ fetched, created, updated, linkedToContact, linkedToCompany, linkedToDeal, unmatched, onlineLinks }`.

**Permissions:** `GET /invoices` already works for every signed-in role, including operators. No change was needed.

## F. Memberships (production data, checked read-only)

- **Data:** there are **0 `Membership` records and 0 membership plans** in production. There are also no won deals yet in the membership, private office or virtual office pipelines, and no contact is tagged `active_member`.
- **Code:** nothing in the backend creates a membership when a deal is won. Memberships can only be created by hand (`POST /memberships`), and none have been.
- **So:** the contact page's membership card will say "Not a member" for everyone until memberships are entered. Either staff add them by hand (plans first), or we build "create the membership when a membership deal is won" in a later round. That needs the client's plans and prices.

## Migration

Run `npm run migrate -- --apply` if `MONGODB_AUTO_INDEX=false` on Render. Otherwise the server builds the indexes on start-up. The migration is `20261127-notes-tags-birthdays`, and creates:
- Activity `{ workspaceId, type, contactId|companyId|dealId, occurredAt }`;
- Contact `{ workspaceId, birthdayMonthDay }`;
- ContactTag `{ workspaceId, key }`, unique;
- Invoice `{ workspaceId, provider, externalId }`.

Tags need no migration: they're seeded on first use.
