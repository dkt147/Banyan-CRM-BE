import { env } from "../config/env.js";
export function setRefreshCookie(res, token) {
  res.cookie("banyan_refresh_token", token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/api/v1/auth",
  });
}
export function clearRefreshCookie(res) {
  res.clearCookie("banyan_refresh_token", {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: "/api/v1/auth",
  });
}
