import { Booking } from "../models/Booking.js";
import { Company } from "../models/Company.js";
import { Contact } from "../models/Contact.js";
import { Deal } from "../models/Deal.js";
import { escapeRegex } from "../utils/phone.js";
import { contactSearchFilter, withRelatedCounts } from "./contact.service.js";
import { displayStatus } from "./booking.service.js";

/*
 * Global search (brief 6.1): contacts (with their company, booking and deal counts),
 * companies, deals and bookings. A booking matches on its own title/room or on its
 * contact, so searching a person's name also returns their bookings.
 */
const name = (c) => (c ? [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "" : "");

export async function globalSearch(workspaceId, q, limit = 5) {
  const term = String(q || "").trim().slice(0, 200);
  if (term.length < 2) return { query: term, contacts: [], companies: [], deals: [], bookings: [] };
  const rx = { $regex: escapeRegex(term), $options: "i" };
  const contactFilter = { workspaceId, isArchived: false, ...(await contactSearchFilter(workspaceId, term)) };
  const matchedContactIds = await Contact.find(contactFilter).limit(200).distinct("_id");

  const [contacts, companies, deals, bookings] = await Promise.all([
    Contact.find(contactFilter).populate("companyId", "name").sort({ updatedAt: -1 }).limit(limit),
    Company.find({ workspaceId, isArchived: false, $or: [{ name: rx }, { legalName: rx }, { email: rx }] }).select("name industry").limit(limit).lean(),
    Deal.find({ workspaceId, $or: [{ title: rx }, { contactId: { $in: matchedContactIds } }, ...(/^\d+$/.test(term) ? [{ dealNumber: Number(term) }] : [])] })
      .select("title status value currency dealNumber contactId").populate("contactId", "firstName lastName email").sort({ updatedAt: -1 }).limit(limit).lean(),
    Booking.find({ workspaceId, $or: [{ title: rx }, { resourceName: rx }, { contactId: { $in: matchedContactIds } }] })
      .select("title resourceName bookingType status holdExpiresAt startAt contactId").populate("contactId", "firstName lastName email").sort({ startAt: -1 }).limit(limit).lean(),
  ]);

  const now = new Date();
  return {
    query: term,
    contacts: (await withRelatedCounts(workspaceId, contacts)).map((c) => ({
      id: String(c._id),
      label: name(c),
      email: c.email || "",
      phone: c.phone || "",
      company: c.companyId?._id ? { id: String(c.companyId._id), label: c.companyId.name } : null,
      bookingCount: c.bookingCount,
      dealCount: c.dealCount,
      nextBookingAt: c.nextBookingAt,
    })),
    companies: companies.map((c) => ({ id: String(c._id), label: c.name, sublabel: c.industry || "" })),
    deals: deals.map((d) => ({ id: String(d._id), label: d.title, sublabel: name(d.contactId), status: d.status, dealNumber: d.dealNumber || null })),
    bookings: bookings.map((b) => ({
      id: String(b._id),
      label: b.title || b.resourceName || "Booking",
      sublabel: [name(b.contactId), b.resourceName].filter(Boolean).join(" · "),
      status: displayStatus(b, now),
      date: b.startAt,
    })),
  };
}
