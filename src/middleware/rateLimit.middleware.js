import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { verifyAccessToken } from "../utils/tokens.js";

/*
 * Rate limits (decision 2026-11-10: industry best practice).
 *
 * - Signed-in API traffic is limited per user, not per IP: Banyan staff share one office
 *   IP, and a per-IP cap made the whole team share 300 requests per 15 minutes.
 * - Requests without a valid token get a tighter per-IP limit.
 * - Login is limited per IP + email (brute force) and per IP (credential stuffing);
 *   successful logins do not count.
 * - Webhooks are exempt (signature-verified and idempotent); public endpoints keep their
 *   own route limiters.
 *
 * Counters live in memory, so they are per process. With more than one API instance,
 * move them to a shared store (e.g. rate-limit-redis).
 * Behind a reverse proxy, set TRUST_PROXY_HOPS so req.ip is the real client address.
 */
const MINUTE = 60 * 1000;

function tooMany(code, message) {
  return (_req, res) => res.status(429).json({ success: false, code, message });
}

function tokenSubject(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const payload = verifyAccessToken(header.slice(7));
    return payload.type === "access" && payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

const EXEMPT_PREFIXES = ["/api/v1/webhooks", "/api/v1/public", "/api/v1/health"];

/** General API limit: 300 requests/minute per signed-in user, 60/minute per anonymous IP. */
export const apiLimiter = rateLimit({
  windowMs: MINUTE,
  limit: (req) => (tokenSubject(req) ? 300 : 60),
  keyGenerator: (req) => {
    const sub = tokenSubject(req);
    return sub ? `user:${sub}` : `ip:${ipKeyGenerator(req.ip)}`;
  },
  skip: (req) => EXEMPT_PREFIXES.some((prefix) => req.path.startsWith(prefix)),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooMany("RATE_LIMITED", "Too many requests. Please wait a moment and try again."),
});

/** Login: 10 failed attempts per 15 minutes for one email from one IP. */
export const loginAccountLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || "").trim().toLowerCase()}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooMany("LOGIN_RATE_LIMITED", "Too many failed sign-in attempts. Try again in 15 minutes."),
});

/** Login: 50 failed attempts per 15 minutes from one IP, across all emails. */
export const loginIpLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 50,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooMany("LOGIN_RATE_LIMITED", "Too many failed sign-in attempts from this network. Try again later."),
});

/** Token refresh: generous, because a whole office refreshes from one IP. */
export const refreshLimiter = rateLimit({
  windowMs: 15 * MINUTE,
  limit: 300,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooMany("RATE_LIMITED", "Too many session refreshes. Please wait a moment."),
});

/** Registration (only reachable where it is enabled): 5 per hour per IP. */
export const registerLimiter = rateLimit({
  windowMs: 60 * MINUTE,
  limit: 5,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: tooMany("RATE_LIMITED", "Too many registration attempts."),
});
