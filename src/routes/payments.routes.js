import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { createStripePaymentIntent } from "../controllers/stripe.controller.js";
import { resourceRouter } from "./resource.routes.js";
import { resourceRegistry } from "../utils/resourceRegistry.js";

const r = Router();
r.post("/stripe/payment-intents", requireAuth, createStripePaymentIntent);
r.use(resourceRouter(resourceRegistry["payments"].service));
export default r;
