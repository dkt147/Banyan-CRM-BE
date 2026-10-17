import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createPublicInvoiceCheckout,
  getPublicInvoice,
} from "../controllers/publicInvoicePayment.controller.js";

const router = Router();
const publicPaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    success: false,
    code: "PUBLIC_PAYMENT_RATE_LIMITED",
    message: "Too many payment requests. Please wait and try again.",
  }),
});

router.get("/:token", publicPaymentLimiter, getPublicInvoice);
router.post("/:token/checkout", publicPaymentLimiter, createPublicInvoiceCheckout);

export default router;
