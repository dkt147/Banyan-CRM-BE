/*
 * Migration runner.
 *
 *   npm run migrate              dry run of all pending "up" steps (no writes)
 *   npm run migrate -- --apply   apply them
 *   npm run migrate -- --down --apply   revert the most recent applied migration
 *
 * Applied migrations are recorded in the "migrations" collection.
 * Always back up the database before running with --apply against shared data.
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import * as phase1 from "../migrations/20261109-phase1-foundation.js";
import * as wpRoomBookings from "../migrations/20261111-wp-room-bookings.js";

const MIGRATIONS = [phase1, wpRoomBookings];

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const direction = args.has("--down") ? "down" : "up";
const log = (msg) => console.log(`  ${msg}`);

async function main() {
  mongoose.set("strictQuery", true);
  // Importing the models would otherwise make Mongoose build their indexes as soon as
  // it connects, so even a dry run would change the database. Indexes are created only
  // by the migration's own steps, and only with --apply.
  mongoose.set("autoIndex", false);
  await mongoose.connect(env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  const ledger = mongoose.connection.collection("migrations");
  const applied = new Set((await ledger.find().toArray()).map((m) => m._id));
  console.log(`[migrate] ${direction}${apply ? "" : " (dry run — pass --apply to write)"}`);

  if (direction === "up") {
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) { console.log(`- ${m.id}: already applied`); continue; }
      console.log(`- ${m.id}`);
      await m.up({ apply, log });
      if (apply) await ledger.insertOne({ _id: m.id, appliedAt: new Date() });
    }
  } else {
    const last = [...MIGRATIONS].reverse().find((m) => applied.has(m.id));
    if (!last) console.log("- nothing to revert");
    else {
      console.log(`- ${last.id}`);
      await last.down({ apply, log });
      if (apply) await ledger.deleteOne({ _id: last.id });
    }
  }
}

main()
  .catch((error) => { console.error("[migrate] failed:", error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
