// Seeds the Availability screen with demo bookings, room credits and inbound website bookings.
// Dates are relative to today, so the five-day window always has data. Re-running replaces the demo rows.
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDatabase } from "../config/database.js";
import { Workspace } from "../models/Workspace.js";
import { User } from "../models/User.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Booking } from "../models/Booking.js";

const DEMO_TAG = "banyan-availability-demo-v1";
const DAY = 24 * 60 * 60 * 1000;

async function resolveWorkspace() {
  if (env.PUBLIC_ENQUIRY_WORKSPACE_ID && mongoose.isValidObjectId(env.PUBLIC_ENQUIRY_WORKSPACE_ID)) {
    const ws = await Workspace.findOne({ _id: env.PUBLIC_ENQUIRY_WORKSPACE_ID, isActive: true });
    if (ws) return ws;
  }
  const ws = await Workspace.findOne({ slug: env.PUBLIC_ENQUIRY_WORKSPACE_SLUG, isActive: true })
    || await Workspace.findOne({ isActive: true }).sort({ createdAt: 1 });
  if (!ws) throw new Error("No active workspace found.");
  return ws;
}

async function findOrCreateCompany(workspaceId, createdBy, name, creditHours) {
  return Company.findOneAndUpdate(
    { workspaceId, name },
    { $setOnInsert: { workspaceId, name, createdBy }, $set: { meetingRoomCreditHours: creditHours } },
    { upsert: true, new: true },
  );
}

async function findOrCreateContact(workspaceId, createdBy, firstName, lastName, companyId, createdDaysAgo, creditHours = 0) {
  let contact = await Contact.findOne({ workspaceId, firstName, lastName });
  if (!contact) {
    contact = await Contact.create({ workspaceId, firstName, lastName, companyId, createdBy, meetingRoomCreditHours: creditHours });
    // Backdate so the inbound panel can tell returning clients from brand-new ones.
    await Contact.collection.updateOne({ _id: contact._id }, { $set: { createdAt: new Date(Date.now() - createdDaysAgo * DAY) } });
  } else if (creditHours) {
    await Contact.updateOne({ _id: contact._id }, { $set: { meetingRoomCreditHours: creditHours } });
  }
  return contact;
}

try {
  await connectDatabase();
  const workspace = await resolveWorkspace();
  const owner = await User.findOne({ workspaceId: workspace._id, isActive: true, role: "admin" }).sort({ createdAt: 1 })
    || await User.findOne({ workspaceId: workspace._id, isActive: true }).sort({ createdAt: 1 });
  if (!owner) throw new Error(`No active user in workspace "${workspace.name}".`);
  const w = workspace._id, by = owner._id;

  await Booking.deleteMany({ workspaceId: w, notes: DEMO_TAG });

  const today = new Date();
  const at = (dayOffset, hour, minute = 0) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, hour, minute);

  const saltwater = await findOrCreateCompany(w, by, "Saltwater Design Co.", 8);
  const novo = await findOrCreateCompany(w, by, "Novo Health Ltd", 8);
  const meridian = await findOrCreateCompany(w, by, "Meridian Legal", 0);
  const fiona = await findOrCreateContact(w, by, "Fiona", "Ng", meridian._id, 30);
  const marcus = await findOrCreateContact(w, by, "Marcus", "Oyelaran", null, 90, 4);
  const kenneth = await findOrCreateContact(w, by, "Kenneth", "Yau", null, 0);
  const ho = await findOrCreateContact(w, by, "Ho Wing", "Sze", null, 60);

  // Grid bookings matching the reference week (day 0 = today).
  const grid = [
    { title: "Harbour Room", subtitle: "Fiona Ng · 10 pax", resourceName: "Harbour Room", bookingType: "meeting_room", attendees: 10, contactId: fiona._id, companyId: meridian._id, start: at(0, 11), end: at(0, 13), status: "confirmed" },
    { title: "Viewing 1204B", subtitle: "Meridian Legal", resourceName: "Viewing 1204B", bookingType: "viewing", companyId: meridian._id, start: at(0, 15), end: at(0, 16), status: "confirmed" },
    { title: "Podcast studio", subtitle: "Sonder Media", resourceName: "Podcast studio", bookingType: "podcast", start: at(1, 9), end: at(1, 11), status: "confirmed" },
    { title: "Terrace Room", subtitle: "Kestrel · 6 pax", resourceName: "Terrace Room", bookingType: "meeting_room", attendees: 6, start: at(1, 13), end: at(1, 15), status: "confirmed" },
    { title: "Trial day", subtitle: "Talia Berger", resourceName: "Trial day", bookingType: "trial", start: at(2, 9), end: at(2, 11), status: "confirmed" },
    { title: "Harbour Room", subtitle: "Novo Health", resourceName: "Harbour Room", bookingType: "meeting_room", companyId: novo._id, start: at(2, 15), end: at(2, 17), status: "confirmed" },
    { title: "Photoshoot", subtitle: "Harbour Pictures", resourceName: "Photoshoot", bookingType: "photoshoot", start: at(3, 11), end: at(3, 13), status: "confirmed" },
    { title: "Photoshoot cont.", subtitle: "Harbour Pictures", resourceName: "Photoshoot", bookingType: "photoshoot", start: at(3, 13), end: at(3, 15), status: "confirmed" },
    // Provisional hold on the event space; overlaps the Aurora launch setup on Saturday.
    { title: "Hold — Lumen", subtitle: "Lumen Studio", resourceName: "Event space", bookingType: "event_space", start: at(3, 18), end: at(4, 20), status: "held", holdExpiresAt: at(3, 23, 59) },
    { title: "Event space", subtitle: "Aurora launch", resourceName: "Event space", bookingType: "event_space", start: at(4, 18), end: at(5, 1), status: "confirmed" },
  ];
  for (const row of grid) {
    await Booking.create({ ...row, workspaceId: w, createdBy: by, source: "manual", notes: DEMO_TAG, currency: "HKD" });
  }

  // Meeting-room hours used earlier this month, so the credit bars have real usage.
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const usage = [
    { companyId: saltwater._id, hours: 7.5 },
    { companyId: novo._id, hours: 3 },
    { contactId: marcus._id, hours: 1 },
  ];
  for (const [i, u] of usage.entries()) {
    const start = new Date(monthStart.getTime() + (i + 1) * DAY + 10 * 3600000);
    const end = new Date(start.getTime() + u.hours * 3600000);
    await Booking.create({ workspaceId: w, createdBy: by, resourceName: "Harbour Room", bookingType: "meeting_room", startAt: start, endAt: end, status: "completed", ...u, notes: DEMO_TAG });
  }

  // Inbound bookings from the website platform (source "website").
  const inbound = [
    { label: "Day pass", contact: kenneth, bookingType: "day_pass", minutesAgo: 4 },
    { label: "Meeting room", contact: fiona, bookingType: "meeting_room", minutesAgo: 22, attendees: 4 },
    { label: "Day pass", contact: ho, bookingType: "day_pass", minutesAgo: 95 },
  ];
  for (const row of inbound) {
    const createdAt = new Date(Date.now() - row.minutesAgo * 60000);
    const b = await Booking.create({
      workspaceId: w, createdBy: by, source: "website", notes: DEMO_TAG,
      bookingType: row.bookingType, resourceName: row.bookingType === "day_pass" ? "Day pass" : "Harbour Room",
      contactId: row.contact._id, attendees: row.attendees, status: "confirmed",
      // Next week, so these requests never clash with the grid shown today.
      startAt: at(7, 10), endAt: at(7, 12),
    });
    await Booking.collection.updateOne({ _id: b._id }, { $set: { createdAt } });
  }

  console.log(`Availability demo seeded for workspace "${workspace.name}": ${grid.length} grid bookings, ${usage.length} credit usages, ${inbound.length} inbound.`);
  process.exit(0);
} catch (error) {
  console.error("Availability demo seed failed:", error.message);
  process.exit(1);
}
