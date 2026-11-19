import helmet from "helmet";
import cors from "cors";
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

const appCors = cors({
  origin(origin, callback) {
    // Requests without an Origin header (e.g. backend-to-backend calls) are not browser CORS requests.
    if (!origin || allowedOrigins.has(normalizedOrigin(origin))) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
});
// Public form submissions: each form has its own allowedOrigins, checked in the route
// (routes/publicForms.routes.js). The CORS layer reflects any origin, without credentials.
const publicFormCors = cors({ origin: true, credentials: false, methods: ["GET", "POST", "OPTIONS"] });

export const securityMiddleware = [
  helmet(),
  (req, res, next) => (req.path.startsWith("/api/v1/public/forms/") ? publicFormCors : appCors)(req, res, next),
  // Rate limiting moved to rateLimit.middleware.js (per-user API limit, login limits,
  // webhooks exempt). The old global 300-per-15-minutes-per-IP limit made a shared
  // office IP lock out the whole team.
];
