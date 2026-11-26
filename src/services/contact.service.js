import mongoose from "mongoose";
import { createdRangeFilter } from "../utils/createdRange.js";
import { recordUpdate } from "./changeLog.service.js";
import { Contact } from "../models/Contact.js";
import { Company } from "../models/Company.js";
import { Deal } from "../models/Deal.js";
import { Booking } from "../models/Booking.js";
import { AppError } from "../utils/AppError.js";
import { escapeRegex, normalizePhone } from "../utils/phone.js";

/*
 * Contacts are workspace records: every CRM user in the workspace can find and open
 * them (deals, bookings and the calendar were already workspace-scoped). Previously
 * contacts were filtered by ownerId, so a contact created by the website intake or by
 * a colleague never appeared in another user's search (D1).
 */

// Partial, case-insensitive search across name, email and phone. Every word must match
// one of the fields, so "jane smi" finds Jane Smith; digits also match formatted phones.
export function buildContactSearchFilter(search, companyIdsByTerm = {}) {
  const terms = String(search || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!terms.length) return null;
  const and = terms.map((term) => {
    const rx = { $regex: escapeRegex(term), $options: "i" };
    const or = [
      { firstName: rx },
      { lastName: rx },
      { email: rx },
      { phone: rx },
      { whatsapp: rx },
    ];
    const digits = normalizePhone(term);
    if (digits) or.push({ phoneNormalized: { $regex: escapeRegex(digits) } });
    // Contact search also matches the contact's company name (brief 6.1).
    if (companyIdsByTerm[term]?.length) or.push({ companyId: { $in: companyIdsByTerm[term] } });
    return { $or: or };
  });
  return and.length === 1 ? and[0] : { $and: and };
}

export async function createContact(data, ownerId, workspaceId) {
  if (data.companyId) {
    const company = await Company.findOne({
      _id: data.companyId,
      workspaceId
    });

    if (!company) {
      throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
    }
  }

  const contact = await Contact.create({
    ...data,
    ownerId,
    workspaceId
  });

  return contact;
}

export async function getContacts({
  workspaceId,
  ownerId,
  page = 1,
  limit = 20,
  search,
  companyId,
  tag,
  isArchived = false,
  createdFrom,
  createdTo,
}) {
  const skip = (page - 1) * limit;

  const filter = {
    workspaceId,
    ...(isArchived === null ? {} : { isArchived }),
  };

  // Optional "my contacts" filter; only applied when requested.
  if (ownerId) {
    filter.ownerId = ownerId;
  }

  if (companyId) {
    filter.companyId = companyId;
  }

  // One tag or several ("a,b" from the validator arrives as an array): contact must have all.
  const tagList = Array.isArray(tag) ? tag : tag ? [tag] : [];
  if (tagList.length) {
    filter.tags = { $all: tagList };
  }

  const searchFilter = await contactSearchFilter(workspaceId, search);
  if (searchFilter) Object.assign(filter, searchFilter);

  const created = createdRangeFilter({ createdFrom, createdTo });
  if (created) Object.assign(filter, created);

  const [contacts, total] = await Promise.all([
    Contact.find(filter)
      .populate("companyId", "name industry")
      .populate("ownerId", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Contact.countDocuments(filter),
  ]);

  return {
    contacts: await withRelatedCounts(workspaceId, contacts),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/** Distinct tags used in the workspace, most used first: [{ key, count }]. */
export async function getContactTagCounts(workspaceId) {
  const rows = await Contact.aggregate([
    { $match: { workspaceId: new mongoose.Types.ObjectId(String(workspaceId)), isArchived: { $ne: true } } },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: 500 },
  ]);
  return rows.filter((r) => r._id).map((r) => ({ key: r._id, count: r.count }));
}

/** Search filter including company-name matches, scoped to the workspace. */
export async function contactSearchFilter(workspaceId, search) {
  const terms = String(search || "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!terms.length) return null;
  const companyIdsByTerm = {};
  await Promise.all(terms.map(async (term) => {
    companyIdsByTerm[term] = await Company.find({
      workspaceId,
      name: { $regex: escapeRegex(term), $options: "i" },
    }).limit(50).distinct("_id");
  }));
  return buildContactSearchFilter(search, companyIdsByTerm);
}

/**
 * Adds bookingCount, dealCount and nextBookingAt to contact rows with two grouped
 * queries for the whole page (no per-row requests), so search results show the
 * contact's bookings and deals (brief 6.1).
 */
export async function withRelatedCounts(workspaceId, contacts) {
  if (!contacts.length) return [];
  const ids = contacts.map((c) => c._id);
  const now = new Date();
  const [bookingRows, dealRows] = await Promise.all([
    Booking.aggregate([
      { $match: { workspaceId, contactId: { $in: ids } } },
      {
        $group: {
          _id: "$contactId",
          count: { $sum: 1 },
          next: {
            $min: {
              $cond: [
                { $and: [{ $gte: ["$startAt", now] }, { $in: ["$status", ["held", "pending", "pending_payment", "confirmed"]] }] },
                "$startAt",
                null,
              ],
            },
          },
        },
      },
    ]),
    Deal.aggregate([
      { $match: { workspaceId, contactId: { $in: ids } } },
      { $group: { _id: "$contactId", count: { $sum: 1 }, open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } } } },
    ]),
  ]);
  const bookings = new Map(bookingRows.map((r) => [String(r._id), r]));
  const deals = new Map(dealRows.map((r) => [String(r._id), r]));
  return contacts.map((c) => {
    const json = typeof c.toJSON === "function" ? c.toJSON() : c;
    const b = bookings.get(String(c._id));
    const d = deals.get(String(c._id));
    return {
      ...json,
      bookingCount: b?.count || 0,
      nextBookingAt: b?.next || null,
      dealCount: d?.count || 0,
      openDealCount: d?.open || 0,
    };
  });
}

export async function getContactById(contactId, workspaceId) {
  const contact = await Contact.findOne({
    _id: contactId,
    workspaceId,
  })
    .populate("companyId", "name industry website")
    .populate("ownerId", "name email");

  if (!contact) {
    throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  }

  return contact;
}

export async function updateContact(contactId, workspaceId, data, userId = null) {
  if (data.companyId) {
    const company = await Company.findOne({
      _id: data.companyId,
      workspaceId
    });

    if (!company) {
      throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
    }
  }

  const before = await Contact.findOne({ _id: contactId, workspaceId }).lean();
  if (!before) {
    throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  }

  const contact = await Contact.findOneAndUpdate(
    {
      _id: contactId,
      workspaceId,
    },
    {
      $set: data,
    },
    {
      new: true,
      runValidators: true,
    },
  ).populate("companyId", "name industry");

  if (!contact) {
    throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  }

  // Timeline (26 Nov, B1): what changed, by whom.
  await recordUpdate({
    workspaceId, userId, type: "contact_updated", before, after: contact.toObject({ depopulate: true }),
    subject: (changes) => (changes.length === 1 && changes[0].field === "tags" ? "Tags changed" : "Contact updated"),
    links: { contactId: contact._id, companyId: contact.companyId?._id || contact.companyId || undefined },
  });

  return contact;
}

export async function archiveContact(contactId, workspaceId) {
  const contact = await Contact.findOneAndUpdate(
    {
      _id: contactId,
      workspaceId,
    },
    {
      $set: {
        isArchived: true,
      },
    },
    {
      new: true,
    },
  );

  if (!contact) {
    throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  }

  return contact;
}

export async function deleteContact(contactId, workspaceId) {
  const contact = await Contact.findOne({
    _id: contactId,
    workspaceId,
  });

  if (!contact) {
    throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
  }

  const [dealCount, bookingCount] = await Promise.all([
    Deal.countDocuments({ contactId: contact._id }),
    Booking.countDocuments({ contactId: contact._id }),
  ]);

  if (dealCount > 0 || bookingCount > 0) {
    throw new AppError(
      "Contact cannot be deleted because it is linked to deals or bookings. Archive it instead.",
      409,
      "CONTACT_HAS_RELATIONS",
    );
  }

  await contact.deleteOne();

  return {
    id: contactId,
    deleted: true,
  };
}
