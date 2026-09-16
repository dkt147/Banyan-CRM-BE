import { z } from "zod";

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8).max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  password,
  role: z.enum(["admin", "manager", "operator"]).default("operator")
});

export const loginSchema = z.object({
  email,
  password
});
