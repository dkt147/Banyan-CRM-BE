/*
 * POST /api/v1/public/forms/:slug — public submissions of CRM forms (embed snippet or fetch).
 * Accepts JSON or application/x-www-form-urlencoded (checkbox groups as key[]).
 * Protection: form publicKey, Origin allowlist (form.allowedOrigins), honeypot, per-IP rate limit.
 * HTML form posts are redirected back to the page with ?submitted=1; JSON requests get JSON.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/AppError.js";
import {
  allowedOriginsFor,
  findPublicForm,
  isHoneypot,
  normalizeOrigin,
  processFormSubmission,
  recordSpam,
} from "../services/formSubmission.service.js";

const router = Router();

const formRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    success: false,
    code: "FORM_RATE_LIMITED",
    message: "Too many submissions were sent from this connection. Please try again later.",
  }),
});

const wantsJson = (req) => req.is("application/json") || /application\/json/.test(req.get("accept") || "");

/** Back to the page the form was on, with ?submitted=1 (or ?form_error=…), only on an allowed origin. */
function redirectBack(req, res, allowed, params) {
  const referer = req.get("referer");
  if (!referer || !allowed.has(normalizeOrigin(referer))) return false;
  const url = new URL(referer);
  for (const k of ["submitted", "form_error"]) url.searchParams.delete(k);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  res.redirect(303, url.toString());
  return true;
}

router.post(
  "/:slug",
  formRateLimiter,
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const publicKey = body.publicKey || req.query.key || req.get("x-form-key");
    const form = await findPublicForm(req.params.slug, publicKey);
    if (!form) throw new AppError("Form not found.", 404, "FORM_NOT_FOUND");

    // Browsers send Origin on cross-site POSTs (form posts and fetch); fall back to Referer.
    const origin = normalizeOrigin(req.get("origin")) || normalizeOrigin(req.get("referer"));
    const allowed = allowedOriginsFor(form);
    if (!origin || !allowed.has(origin)) throw new AppError("This form cannot be submitted from this website.", 403, "FORM_ORIGIN_NOT_ALLOWED");

    const meta = { ip: req.ip, userAgent: req.get("user-agent"), sourceUrl: req.get("referer") };
    const thanks = "Thank you. Your submission has been received.";
    if (isHoneypot(body)) {
      await recordSpam(form, meta);
      if (!wantsJson(req) && redirectBack(req, res, allowed, { submitted: "1" })) return;
      return res.status(201).json({ success: true, message: thanks, data: { received: true } });
    }

    try {
      await processFormSubmission(form, body, meta);
    } catch (error) {
      if (!wantsJson(req) && error.statusCode === 400 && redirectBack(req, res, allowed, { form_error: error.message.slice(0, 200) })) return;
      throw error;
    }
    if (!wantsJson(req) && redirectBack(req, res, allowed, { submitted: "1" })) return;
    res.status(201).json({ success: true, message: thanks, data: { received: true } });
  }),
);

export default router;
