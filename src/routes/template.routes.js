import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth.middleware.js";
import { makeResourceController } from "../controllers/resource.controller.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";
import { AppError } from "../utils/AppError.js";

// Limits match models/Template.js. Checked before saving so an oversized body gets a clear 413
// instead of a Mongoose maxlength error.
export const TEMPLATE_BODY_MAX = 512000;
export const TEMPLATE_SUBJECT_MAX = 998;

function templateSizeGuard(req, _res, next) {
  const { body, subject } = req.body || {};
  if (typeof body === "string" && body.length > TEMPLATE_BODY_MAX)
    return next(new AppError("This message is over 500 KB, the most an email can be.", 413, "TEMPLATE_TOO_LARGE"));
  if (typeof subject === "string" && subject.length > TEMPLATE_SUBJECT_MAX)
    return next(new AppError(`The subject is too long (max ${TEMPLATE_SUBJECT_MAX} characters).`, 413, "TEMPLATE_TOO_LARGE"));
  next();
}

// Email and WhatsApp templates: Admin edits, Sales uses, Read-only has no access (brief 7).
const c = makeResourceController(resourceRegistry.templates.service);
const r = Router();
r.use(requireAuth);
r.get("/", requirePermission("templates.use"), c.list);
r.get("/:id", requirePermission("templates.use"), c.get);
r.post("/", requirePermission("templates.manage"), templateSizeGuard, c.create);
r.patch("/:id", requirePermission("templates.manage"), templateSizeGuard, c.update);
r.delete("/:id", requirePermission("templates.manage"), c.remove);
export default r;
