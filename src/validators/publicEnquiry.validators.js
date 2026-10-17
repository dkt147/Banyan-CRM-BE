import { z } from "zod";

/** Normalized fields accepted by the public Banyan Workspace enquiry form. */
export const publicEnquirySchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  email: z.string().trim().email("Enter a valid email address.").max(254).transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(40).optional().default(""),
  interests: z.array(z.string().trim().min(1).max(80)).min(1, "Select at least one service.").max(8),
  notes: z.string().trim().max(3000, "Additional notes must be 3,000 characters or fewer.").optional().default(""),
});
