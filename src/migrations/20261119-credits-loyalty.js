/*
 * Meeting room credits (19 Nov, §5): CreditLedger indexes, including one "use" and one "refund"
 * per booking ref. Company loyalty tiers are seeded lazily (only when a workspace has none).
 */
import { CreditLedger } from "../models/CreditLedger.js";

export const id = "20261119-credits-loyalty";

export async function up({ apply, log }) {
  if (apply) await CreditLedger.createIndexes();
  log(`${apply ? "created" : "would create"} indexes for creditledgers`);
}

export async function down({ apply, log }) {
  log(`${apply ? "kept" : "would keep"} creditledgers indexes (dropping them is not needed to revert)`);
}
