/*
 * Website day-pass purchases: one deal per Stripe Checkout Session (unique partial index on
 * Deal.metadata.stripeCheckoutSessionId), so webhook retries can never create a second deal.
 */
import { Deal } from "../models/Deal.js";

export const id = "20261118-day-pass-purchases";
const INDEX_NAME = "workspaceId_1_metadata.stripeCheckoutSessionId_1";

export async function up({ apply, log }) {
  const dupes = await Deal.collection.aggregate([
    { $match: { "metadata.stripeCheckoutSessionId": { $type: "string" } } },
    { $group: { _id: { w: "$workspaceId", s: "$metadata.stripeCheckoutSessionId" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray();
  if (dupes.length) throw new Error(`${dupes.length} checkout session(s) have more than one deal; merge them before applying.`);
  if (apply)
    await Deal.collection.createIndex(
      { workspaceId: 1, "metadata.stripeCheckoutSessionId": 1 },
      { name: INDEX_NAME, unique: true, partialFilterExpression: { "metadata.stripeCheckoutSessionId": { $type: "string" } } },
    );
  log(`${apply ? "created" : "would create"} index deals.${INDEX_NAME}`);
}

export async function down({ apply, log }) {
  const names = new Set((await Deal.collection.indexes().catch(() => [])).map((i) => i.name));
  if (names.has(INDEX_NAME) && apply) await Deal.collection.dropIndex(INDEX_NAME);
  log(`${apply ? "dropped" : "would drop"} index deals.${INDEX_NAME}`);
}
