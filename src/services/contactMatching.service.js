import { Contact } from "../models/Contact.js";
import { normalizePhone } from "../utils/phone.js";

/**
 * Find an existing workspace contact by email first, then by phone (digits only).
 * Returns { contact, matchedBy } where matchedBy is "email" | "phone" | null.
 * Archived contacts are still matched so a returning client is not duplicated.
 */
export async function findContactByEmailOrPhone(workspaceId, { email, phone } = {}) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (cleanEmail) {
    const contact = await Contact.findOne({ workspaceId, email: cleanEmail }).sort({ isArchived: 1, createdAt: 1 });
    if (contact) return { contact, matchedBy: "email" };
  }
  const digits = normalizePhone(phone);
  if (digits) {
    const contact = await Contact.findOne({ workspaceId, phoneNormalized: digits }).sort({ isArchived: 1, createdAt: 1 });
    if (contact) return { contact, matchedBy: "phone" };
  }
  return { contact: null, matchedBy: null };
}

/**
 * Website intake: find a contact (email first, then phone) or create one.
 * Never overwrites an existing contact's name/email; only fills blanks.
 */
export async function findOrCreateContact(workspaceId, ownerId, details = {}, { source = "website", tags = [] } = {}) {
  const email = String(details.email || "").trim().toLowerCase() || undefined;
  const phone = String(details.phone || "").trim() || undefined;
  if (!email && !normalizePhone(phone)) {
    const error = new Error("An email address or phone number is required to identify the contact.");
    error.code = "CONTACT_IDENTIFIER_REQUIRED";
    throw error;
  }

  const { contact, matchedBy } = await findContactByEmailOrPhone(workspaceId, { email, phone });
  if (contact) {
    let changed = false;
    if (!contact.email && email) { contact.email = email; changed = true; }
    if (!contact.phone && phone) { contact.phone = phone; changed = true; }
    const nextTags = [...new Set([...(contact.tags || []), ...tags])];
    if (nextTags.length !== (contact.tags || []).length) { contact.tags = nextTags; changed = true; }
    if (changed) await contact.save();
    return { contact, created: false, matchedBy };
  }

  const created = await Contact.create({
    workspaceId,
    ownerId,
    firstName: String(details.firstName || "").trim() || (email ? email.split("@")[0] : "Guest"),
    lastName: String(details.lastName || "").trim(),
    email,
    phone,
    source,
    tags,
    language: "en",
  });
  return { contact: created, created: true, matchedBy: null };
}
