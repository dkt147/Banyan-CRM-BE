import { z } from "zod";
const password = z.string().min(8).max(128);
export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password,
  workspaceName: z.string().min(2).max(150).optional(),
  workspaceSlug: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});
export const loginSchema = z.object({ email: z.string().email(), password });
export const refreshSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});
