/*
 * Client meeting 25 Nov: created-date indexes for the contact and deal lists (§1) and the day pass
 * collections (§3: one account per contact, entries by contact). createIndex only adds what's missing.
 */
import { Contact } from "../models/Contact.js";
import { DayPassAccount } from "../models/DayPassAccount.js";
import { DayPassEntry } from "../models/DayPassEntry.js";
import { Deal } from "../models/Deal.js";

export const id = "20261125-day-passes-dates";

export async function up({ apply, log }) {
  if (apply) {
    await Contact.collection.createIndex({ workspaceId: 1, createdAt: -1 });
    await Deal.collection.createIndex({ workspaceId: 1, createdAt: -1 });
    await DayPassAccount.createIndexes();
    await DayPassEntry.createIndexes();
  }
  log(`${apply ? "created" : "would create"} createdAt indexes on contacts and deals, and day pass indexes`);
}

export async function down({ apply, log }) {
  log(`${apply ? "kept" : "would keep"} the indexes (dropping them is not needed to revert)`);
}
