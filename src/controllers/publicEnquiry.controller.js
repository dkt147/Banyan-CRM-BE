import { publicEnquirySchema } from "../validators/publicEnquiry.validators.js";
import { createPublicEnquiry } from "../services/publicEnquiry.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean);
  if (typeof value === "string") return value.split(/[;,\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeBody(body = {}) {
  let firstName = asString(body.firstName ?? body.first_name);
  let lastName = asString(body.lastName ?? body.last_name);
  const fullName = asString(body.fullName ?? body.full_name ?? body.name);
  if ((!firstName || !lastName) && fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (!firstName) firstName = parts.shift() || "";
    if (!lastName) lastName = parts.join(" ");
  }
  return {
    firstName,
    lastName,
    email: asString(body.email ?? body.emailAddress ?? body.email_address),
    phone: asString(body.phone ?? body.phoneNumber ?? body.phone_number),
    interests: asStringArray(body.interestedIn ?? body.interested_in ?? body.interests ?? body.services ?? body.interest),
    notes: asString(body.notes ?? body.additionalNotes ?? body.additional_notes ?? body.message),
  };
}

export const createPublicEnquiryController = asyncHandler(async (req, res) => {
  // Quietly accept honeypot submissions without storing fake leads.
  const honeypot = req.body?._honeypot ?? req.body?.website_confirm;
  if (typeof honeypot === "string" && honeypot.trim()) {
    return res.status(201).json({
      success: true,
      message: "Thank you. Your enquiry has been received.",
      data: { received: true },
    });
  }

  const payload = publicEnquirySchema.parse(normalizeBody(req.body));
  const data = await createPublicEnquiry(payload);
  return res.status(201).json({
    success: true,
    message: "Thank you. Your enquiry has been received.",
    data,
  });
});
