import { env } from "../config/env.js";

// The CRM (vercel.app) and the API (onrender.com) are different sites: the cookie only travels with
// SameSite=None, which browsers accept only together with Secure. Safari may still block it, so the
// refresh token is also returned in the response body (auth.controller.js).
function cookieOptions() {
  const sameSite = String(env.COOKIE_SAME_SITE || "lax").toLowerCase();
  return { httpOnly: true, secure: env.COOKIE_SECURE || sameSite === "none", sameSite, path: "/api/v1/auth" };
}

export function setRefreshCookie(res, token) {
  res.cookie("banyan_refresh_token", token, { ...cookieOptions(), maxAge: 30 * 24 * 60 * 60 * 1000 });
}
export function clearRefreshCookie(res) {
  res.clearCookie("banyan_refresh_token", cookieOptions());
}
