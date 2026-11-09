import { Router } from "express";
import {
  registerController,
  loginController,
  refreshController,
  logoutController,
  meController,
  updateProfileController,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { loginAccountLimiter, loginIpLimiter, refreshLimiter, registerLimiter } from "../middleware/rateLimit.middleware.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
} from "../validators/auth.validators.js";
const r = Router();
// Disabled in production unless ALLOW_PUBLIC_REGISTRATION=true (team members are
// added by an Admin from Members).
const registrationEnabled = (_req, _res, next) =>
  env.ALLOW_PUBLIC_REGISTRATION ? next() : next(new AppError("Registration is disabled. Ask a workspace admin for an account.", 403, "REGISTRATION_DISABLED"));
r.post("/register", registrationEnabled, registerLimiter, validate(registerSchema), registerController);
r.post("/login", loginIpLimiter, loginAccountLimiter, validate(loginSchema), loginController);
r.post("/refresh", refreshLimiter, validate(refreshSchema), refreshController);
r.post("/logout", logoutController);
r.get("/me", requireAuth, meController);
r.patch("/profile", requireAuth, updateProfileController);
export default r;
