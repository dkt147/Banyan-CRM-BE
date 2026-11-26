/*
 * Client feedback 26 Nov: indexes for notes (Activity by type + contact/company/deal), birthdays
 * (Contact.birthdayMonthDay), editable contact tags (ContactTag, unique per workspace + key) and the
 * Xero invoice pull (Invoice by provider + externalId). Tags are seeded lazily on first use.
 */
import { Activity } from "../models/Activity.js";
import { Contact } from "../models/Contact.js";
import { ContactTag } from "../models/ContactTag.js";
import { Invoice } from "../models/Invoice.js";

export const id = "20261127-notes-tags-birthdays";

export async function up({ apply, log }) {
  if (apply) {
    for (const key of ["contactId", "companyId", "dealId"])
      await Activity.collection.createIndex({ workspaceId: 1, type: 1, [key]: 1, occurredAt: -1 });
    await Contact.collection.createIndex({ workspaceId: 1, birthdayMonthDay: 1 });
    await ContactTag.createIndexes();
    await Invoice.collection.createIndex({ workspaceId: 1, provider: 1, externalId: 1 });
  }
  log(`${apply ? "created" : "would create"} note, birthday, contact tag and Xero invoice indexes`);
}

export async function down({ apply, log }) {
  log(`${apply ? "kept" : "would keep"} the indexes (dropping them is not needed to revert)`);
}
