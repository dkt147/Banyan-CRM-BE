/*
 * WordPress room bookings: unique index on Booking.externalRef (the WordPress "BNY-…" ref),
 * so webhook + sync upserts can never create duplicates.
 */
import { Booking } from "../models/Booking.js";

export const id = "20261111-wp-room-bookings";
const INDEX_NAME = "workspaceId_1_externalRef_1";

export async function up({ apply, log }) {
  if (apply)
    await Booking.collection.createIndex(
      { workspaceId: 1, externalRef: 1 },
      { name: INDEX_NAME, unique: true, partialFilterExpression: { externalRef: { $type: "string" } } },
    );
  log(`${apply ? "created" : "would create"} index bookings.${INDEX_NAME}`);
}

export async function down({ apply, log }) {
  const names = new Set((await Booking.collection.indexes().catch(() => [])).map((i) => i.name));
  if (names.has(INDEX_NAME) && apply) await Booking.collection.dropIndex(INDEX_NAME);
  log(`${apply ? "dropped" : "would drop"} index bookings.${INDEX_NAME}`);
}
