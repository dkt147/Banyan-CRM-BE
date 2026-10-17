import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

function normalizedOrigin(value) {
  if (!value) return "";
  try { return new URL(value.trim()).origin; } catch { return ""; }
}

const allowedOrigins = new Set(
  [env.CLIENT_URL, env.PUBLIC_WEBSITE_URL, ...env.CORS_ALLOWED_ORIGINS.split(",")]
    .map(normalizedOrigin)
    .filter(Boolean),
);

export const securityMiddleware = [
  helmet(),
  cors({
    origin(origin, callback) {
      // Requests without an Origin header (e.g. backend-to-backend calls) are not browser CORS requests.
      if (!origin || allowedOrigins.has(normalizedOrigin(origin))) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }),
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
];
