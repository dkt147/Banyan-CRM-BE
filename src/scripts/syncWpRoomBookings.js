/*
 * Import WordPress room bookings into the CRM cache (upsert by ref, safe to re-run).
 *
 *   npm run sync:room-bookings                                   incremental (updated_since), first run backfills
 *   npm run sync:room-bookings -- --from 2026-01-01 --to 2027-02-28   re-read a date range, month by month
 */
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { syncWpIncremental, syncWpRange } from "../services/wpRoomBooking.service.js";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  await connectDatabase();
  const from = arg("from");
  const to = arg("to");
  const result = from || to ? await syncWpRange(from, to) : await syncWpIncremental();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("[sync:room-bookings] failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
