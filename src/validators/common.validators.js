import { z } from "zod";
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid object id");
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
});
