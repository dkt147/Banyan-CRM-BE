/**
 * Banyan's pipeline definitions sourced from the Banyan Workspace CRM
 * Functions & Connectivity Requirements document (page 2).
 *
 * Keys intentionally match the keys consumed by the existing website-enquiry
 * service: membership, private-office, and venue-hire. The fourth pipeline uses
 * the key "transactional".
 */
export const pipelineDefinitions = [
  {
    key: "membership",
    name: "Membership Pipeline",
    sortOrder: 0,
    stages: [
      "Enquiry",
      "Template Sent",
      "Trial Day Booked",
      "Trial Completed",
      "Agreement Sent",
      "Deposit Paid",
      "Active",
    ],
  },
  {
    key: "private-office",
    name: "Private Office Pipeline",
    sortOrder: 1,
    stages: [
      "Enquiry",
      "Template Sent",
      "Viewing Scheduled",
      "Viewing Completed",
      "Quote Sent",
      "Negotiation",
      "Agreement Signed",
      "Deposit Collected",
      "Move-In",
    ],
  },
  {
    key: "venue-hire",
    name: "Venue Hire Pipeline",
    sortOrder: 2,
    stages: [
      "Enquiry",
      "Availability Confirmed",
      "Quote Sent",
      "Agreement Signed",
      "Deposit Invoice Sent",
      "Deposit Received",
      "Event Confirmed",
    ],
  },
  {
    key: "transactional",
    name: "Transactional / Self-Serve",
    sortOrder: 3,
    stages: ["Booking Received", "Confirmed", "Completed"],
  },
];

export function keyForStage(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
