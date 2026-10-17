import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createPublicEnquiryController } from "../controllers/publicEnquiry.controller.js";

const router = Router();

const enquiryRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    success: false,
    code: "ENQUIRY_RATE_LIMITED",
    message: "Too many enquiries were submitted from this connection. Please try again later.",
  }),
});

// This endpoint is intentionally public because it is called from the marketing website.
// Validation, origin allowlisting, a honeypot, and a stricter per-IP limit protect intake.
router.post("/", enquiryRateLimiter, createPublicEnquiryController);

export default router;
