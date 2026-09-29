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
import { validate } from "../middleware/validate.middleware.js";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
} from "../validators/auth.validators.js";
const r = Router();
r.post("/register", validate(registerSchema), registerController);
r.post("/login", validate(loginSchema), loginController);
r.post("/refresh", validate(refreshSchema), refreshController);
r.post("/logout", logoutController);
r.get("/me", requireAuth, meController);
r.patch("/profile", requireAuth, updateProfileController);
export default r;
