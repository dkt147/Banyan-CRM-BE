import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

export const securityMiddleware = [
  helmet(),
  cors({ origin: env.CLIENT_URL, credentials: true }),
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
];
