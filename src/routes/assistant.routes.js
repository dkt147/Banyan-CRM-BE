import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth.middleware.js";
import * as controller from "../controllers/assistant.controller.js";

const router = Router();
router.use(requireAuth);
router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  keyGenerator: (req) => String(req.user._id),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: "AI_RATE_LIMITED", message: "Too many assistant requests. Please wait a minute and try again." },
}));
router.get("/status", controller.status);
router.post("/chat", controller.chat);
export default router;
