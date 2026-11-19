/*
 * Contact tag catalogue (feedback 17 Nov, #3). Mirrors Banyan-CRM-Admin src/utils/contactTags.js.
 * Tags are lowercase snake_case keys; staff may add custom ones that match TAG_PATTERN.
 * Add any new automatic (system) tag here so GET /contacts/tag-catalogue lists it.
 */
export const TAG_PATTERN = /^[a-z0-9_]{1,50}$/;
export const MAX_TAGS_PER_CONTACT = 30;

export const TAG_CATALOGUE = [
  { key: "prospect", group: "segment", label: "Prospect", description: "Interested, not yet a customer." },
  { key: "active_member", group: "segment", label: "Active member", description: "Has a current membership or office." },
  { key: "past_member", group: "segment", label: "Past member", description: "Membership has ended." },
  { key: "event_client", group: "segment", label: "Event client", description: "Has hired the venue or event space." },
  { key: "broker_agent", group: "segment", label: "Broker / agent", description: "Refers clients to Banyan." },
  { key: "ngo", group: "segment", label: "NGO", description: "Non-profit organisation." },
  { key: "vip", group: "segment", label: "VIP", description: "Priority contact." },
  { key: "website_enquiry", group: "source", label: "Website enquiry", description: "Sent the website enquiry form.", automatic: true },
  { key: "website_booking", group: "source", label: "Website booking", description: "Booked through the website.", automatic: true },
  { key: "room_booking", group: "source", label: "Room booking", description: "Booked a meeting room through WordPress.", automatic: true },
  { key: "test_booking", group: "source", label: "Test booking", description: "Created by a Stripe test-mode booking; safe to ignore.", automatic: true },
  { key: "email_lead", group: "source", label: "Email lead", description: "First contact came by email.", automatic: true },
  { key: "whatsapp_lead", group: "source", label: "WhatsApp lead", description: "First contact came by WhatsApp.", automatic: true },
  { key: "form_submission", group: "source", label: "Form submission", description: "Sent a CRM form.", automatic: true },
  { key: "newsletter", group: "source", label: "Newsletter", description: "Signed up for the newsletter (also added to Flodesk).", automatic: true },
  { key: "walk_in", group: "source", label: "Walk-in", description: "Filled in the walk-in form at reception.", automatic: true },
];

/** "Active Member" / "active-member" / " ACTIVE member " -> "active_member". */
export function normalizeTag(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);
}

/** Normalise and de-duplicate a tag list, dropping values that end up empty. */
export function normalizeTags(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(normalizeTag).filter(Boolean))];
}
