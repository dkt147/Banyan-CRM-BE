import mongoose from "mongoose";
import { normalizePhone } from "../utils/phone.js";
const schema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    lastName: { type: String, trim: true, default: "" },
    email: { type: String, lowercase: true, trim: true, index: true },
    phone: String,
    whatsapp: String,
    // Digits-only copy of phone (or WhatsApp when phone is empty). Used for
    // email-then-phone contact matching on website bookings and for search.
    phoneNormalized: { type: String, default: null },
    jobTitle: String,
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    tags: [String],
    source: String,
    language: { type: String, default: "en" },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    notes: String,
    isArchived: { type: Boolean, default: false, index: true },
    // Monthly meeting-room allowance in hours (0 = no credit tracking).
    meetingRoomCreditHours: { type: Number, default: 0, min: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Consent and engagement (Developer Brief v2.1, section 5 / 6.4 / 6.5).
    marketingConsentAt: { type: Date, default: null },
    consentSource: { type: String, default: null },
    consentText: { type: String, default: null },
    consentIp: { type: String, default: null },
    unsubscribedAt: { type: Date, default: null },
    lastEngagedAt: { type: Date, default: null },
    whatsappOptInAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);
schema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});
schema.pre("validate", function setPhoneNormalized() {
  if (this.isModified("phone") || this.isModified("whatsapp") || this.isNew)
    this.phoneNormalized = normalizePhone(this.phone) || normalizePhone(this.whatsapp);
});
// Keep phoneNormalized in sync for findOneAndUpdate/updateOne paths used by services.
function syncPhoneOnUpdate() {
  const update = this.getUpdate() || {};
  const set = update.$set || update;
  if (!("phone" in set) && !("whatsapp" in set)) return;
  const phone = "phone" in set ? set.phone : undefined;
  const whatsapp = "whatsapp" in set ? set.whatsapp : undefined;
  const normalized = normalizePhone(phone) || normalizePhone(whatsapp);
  // Only overwrite when both values are known from this update or a value resolved.
  if (normalized || ("phone" in set && "whatsapp" in set)) {
    if (update.$set) update.$set.phoneNormalized = normalized;
    else update.phoneNormalized = normalized;
    this.setUpdate(update);
  }
}
schema.pre("findOneAndUpdate", syncPhoneOnUpdate);
schema.pre("updateOne", syncPhoneOnUpdate);
schema.index({ workspaceId: 1, email: 1 });
schema.index({ workspaceId: 1, phoneNormalized: 1 });
schema.index({ workspaceId: 1, lastEngagedAt: 1 });
// The contact's own `language` field ("zh", …) must not be read as the text-search
// language: MongoDB rejects unsupported values and the write fails. The migration drops
// the old index (firstName_text_lastName_text_email_text) that had this problem.
schema.index(
  { firstName: "text", lastName: "text", email: "text" },
  { name: "contact_text_search", default_language: "none", language_override: "textSearchLanguage" },
);
export const Contact = mongoose.model("Contact", schema);
