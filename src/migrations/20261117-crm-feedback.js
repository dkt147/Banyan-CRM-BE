/*
 * CRM feedback round (17 Nov 2026):
 *  1. Deal.closedAt: index, and backfill for won/lost deals from stageChangedAt || updatedAt.
 *  2. Contact tags: normalise legacy values (lowercase, spaces/hyphens → "_", de-duplicate),
 *     e.g. "Active Member" → "active_member", "test-booking" → "test_booking".
 * Down removes the index only (normalised tags and backfilled dates are kept).
 */
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { normalizeTags } from "../utils/contactTags.js";

export const id = "20261117-crm-feedback";
const CLOSED_INDEX = "workspaceId_1_status_1_closedAt_1";

export async function up({ apply, log }) {
  if (apply) await Deal.collection.createIndex({ workspaceId: 1, status: 1, closedAt: 1 }, { name: CLOSED_INDEX });
  log(`${apply ? "created" : "would create"} index deals.${CLOSED_INDEX}`);

  const missing = { status: { $in: ["won", "lost"] }, $or: [{ closedAt: null }, { closedAt: { $exists: false } }] };
  const toBackfill = await Deal.collection.countDocuments(missing);
  if (apply && toBackfill)
    await Deal.collection.updateMany(missing, [{ $set: { closedAt: { $ifNull: ["$stageChangedAt", "$updatedAt"] } } }]);
  log(`${apply ? "backfilled" : "would backfill"} closedAt on ${toBackfill} won/lost deal(s)`);

  let changed = 0;
  const cursor = Contact.collection.find({ "tags.0": { $exists: true } }, { projection: { tags: 1 } });
  for await (const c of cursor) {
    const next = normalizeTags(c.tags || []).slice(0, 30);
    if (JSON.stringify(next) === JSON.stringify(c.tags)) continue;
    changed += 1;
    if (apply) await Contact.collection.updateOne({ _id: c._id }, { $set: { tags: next } });
    if (changed <= 5) log(`  ${c._id}: ${JSON.stringify(c.tags)} → ${JSON.stringify(next)}`);
  }
  log(`${apply ? "normalised" : "would normalise"} tags on ${changed} contact(s)`);
}

export async function down({ apply, log }) {
  const names = new Set((await Deal.collection.indexes().catch(() => [])).map((i) => i.name));
  if (names.has(CLOSED_INDEX) && apply) await Deal.collection.dropIndex(CLOSED_INDEX);
  log(`${apply ? "dropped" : "would drop"} index deals.${CLOSED_INDEX}`);
}
