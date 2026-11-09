import mongoose from "mongoose";
import { Contact } from "../models/Contact.js";
import { Company } from "../models/Company.js";
import { Deal } from "../models/Deal.js";
import { Resource } from "../models/Resource.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { findOrCreateContact } from "./contactMatching.service.js";

// Statuses that can expire when holdExpiresAt passes.
export const EXPIRING_STATUSES = ["held", "pending_payment"];
// Statuses that occupy a resource (before expiry is considered).
export const ACTIVE_BOOKING_STATUSES = ["held", "pending", "pending_payment", "confirmed"];
// Statuses the calendar hides unless the user asks for them.
export const HIDDEN_BY_DEFAULT_STATUSES = ["cancelled", "expired"];

/** Status shown to users: a hold or unpaid booking whose hold time has passed is expired. */
export function displayStatus(booking, now = new Date()) {
  if (
    EXPIRING_STATUSES.includes(booking.status) &&
    booking.holdExpiresAt &&
    new Date(booking.holdExpiresAt) <= now
  )
    return "expired";
  return booking.status;
}

/** Mongo filter for bookings that currently block a slot (expired holds do not). */
export function activeBookingFilter(now = new Date()) {
  return {
    $or: [
      { status: { $in: ACTIVE_BOOKING_STATUSES.filter((s) => !EXPIRING_STATUSES.includes(s)) } },
      {
        status: { $in: EXPIRING_STATUSES },
        $or: [{ holdExpiresAt: null }, { holdExpiresAt: { $gt: now } }],
      },
    ],
  };
}

export function isActiveBooking(booking, now = new Date()) {
  return ACTIVE_BOOKING_STATUSES.includes(booking.status) && displayStatus(booking, now) !== "expired";
}

const isObjectId = (value) => mongoose.isValidObjectId(value) && String(value).length === 24;

async function websiteOwnerId(workspaceId, fallbackUserId) {
  if (fallbackUserId) return fallbackUserId;
  const admin = await User.findOne({ workspaceId, role: "admin", isActive: true }).sort({ createdAt: 1 }).select("_id");
  if (!admin) throw new AppError("No active CRM user is available to own website bookings.", 503, "BOOKING_OWNER_NOT_CONFIGURED");
  return admin._id;
}

/**
 * Validate and complete the contact/company/deal/resource links of a booking payload.
 *
 * - source "google": a contact is optional (unlinked Google Calendar events).
 * - source "website": contactId, or contact details { email, phone, firstName, lastName }
 *   which are matched email-first, then phone, else a contact is created.
 * - anything else (staff-created): an existing contactId is required.
 *
 * mode "create" always enforces the rule; mode "update" only checks fields present in the payload.
 */
export async function prepareBookingPayload(workspaceId, userId, payload = {}, { mode = "create", existing = null } = {}) {
  const data = { ...payload };
  const contactDetails = data.contact && typeof data.contact === "object" ? data.contact : null;
  delete data.contact;
  for (const key of ["contactId", "companyId", "dealId", "resourceId"])
    if (data[key] === "") data[key] = null;

  const source = data.source || existing?.source || "manual";
  const touchesContact = mode === "create" || "contactId" in data || contactDetails;

  if (touchesContact) {
    if (data.contactId) {
      if (!isObjectId(data.contactId)) throw new AppError("Invalid contact.", 400, "INVALID_CONTACT");
      const contact = await Contact.findOne({ _id: data.contactId, workspaceId }).select("companyId");
      if (!contact) throw new AppError("Contact not found.", 404, "CONTACT_NOT_FOUND");
      if (!data.companyId && !existing?.companyId && contact.companyId) data.companyId = contact.companyId;
    } else if (source === "website" && contactDetails) {
      try {
        const ownerId = await websiteOwnerId(workspaceId, userId);
        const { contact, created, matchedBy } = await findOrCreateContact(workspaceId, ownerId, contactDetails, {
          source: "website",
          tags: ["website_booking"],
        });
        data.contactId = contact._id;
        if (!data.companyId && contact.companyId) data.companyId = contact.companyId;
        data.metadata = { ...(data.metadata || {}), contactMatch: created ? "created" : matchedBy };
      } catch (error) {
        if (error.code === "CONTACT_IDENTIFIER_REQUIRED") throw new AppError(error.message, 400, error.code);
        throw error;
      }
    } else if (source !== "google") {
      throw new AppError(
        source === "website"
          ? "Website bookings need the guest's email or phone so they can be linked to a contact."
          : "Select an existing contact for this booking.",
        400,
        "BOOKING_CONTACT_REQUIRED",
      );
    }
  }

  if (data.companyId) {
    if (!isObjectId(data.companyId) || !(await Company.exists({ _id: data.companyId, workspaceId })))
      throw new AppError("Company not found.", 404, "COMPANY_NOT_FOUND");
  }
  if (data.dealId) {
    if (!isObjectId(data.dealId) || !(await Deal.exists({ _id: data.dealId, workspaceId })))
      throw new AppError("Deal not found.", 404, "DEAL_NOT_FOUND");
  }
  if (data.resourceId) {
    const resource = isObjectId(data.resourceId)
      ? await Resource.findOne({ _id: data.resourceId, workspaceId }).select("name")
      : null;
    if (!resource) throw new AppError("Resource not found.", 404, "RESOURCE_NOT_FOUND");
    if (!data.resourceName) data.resourceName = resource.name;
  } else if (data.resourceName && mode === "create") {
    // Link to a configured resource with the same name when one exists.
    const resource = await Resource.findOne({ workspaceId, name: data.resourceName }).select("_id");
    if (resource) data.resourceId = resource._id;
  }
  return data;
}
