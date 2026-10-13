import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  createStripeCheckoutSession,
  createStripePaymentIntent,
} from "../controllers/stripe.controller.js";
import { resourceRouter } from "./resource.routes.js";
import { Payment } from "../models/Payment.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";

const r = Router();
r.post("/stripe/payment-intents", requireAuth, createStripePaymentIntent);
r.post("/stripe/checkout-sessions", requireAuth, createStripeCheckoutSession);

// Stripe records are owned by signed webhook events, not editable CRM forms.
r.use(
  "/",
  requireAuth,
  asyncHandler(async (req, _res, next) => {
    if (req.method === "POST" && req.path === "/" && String(req.body?.provider || "").toLowerCase() === "stripe") {
      throw new AppError(
        "Stripe payment records are created by the Stripe payment flow.",
        409,
        "STRIPE_PAYMENT_WEBHOOK_MANAGED",
      );
    }

    const match = /^\/([a-f0-9]{24})\/?$/i.exec(req.path);
    if (["PATCH", "DELETE"].includes(req.method) && match) {
      const payment = await Payment.findOne({
        _id: match[1],
        workspaceId: req.workspaceId,
      }).select("provider");
      if (payment?.provider === "stripe") {
        throw new AppError(
          "Stripe payment records cannot be changed manually; their status is managed by verified webhooks.",
          409,
          "STRIPE_PAYMENT_WEBHOOK_MANAGED",
        );
      }
    }

    next();
  }),
);

r.use(resourceRouter(resourceRegistry["payments"].service));
export default r;
