import { asyncHandler } from "../utils/asyncHandler.js";
import {
  register,
  login,
  rotateRefreshToken,
  logout,
} from "../services/auth.service.js";
import { clearRefreshCookie, setRefreshCookie } from "../utils/cookies.js";
import { User } from "../models/User.js";
export const registerController = asyncHandler(async (req, res) => {
  const out = await register(req.body, {
    userAgent: req.get("user-agent"),
    ipAddress: req.ip,
  });
  setRefreshCookie(res, out.refreshToken);
  res.status(201).json({
    success: true,
    data: { user: out.user, accessToken: out.accessToken },
  });
});
export const loginController = asyncHandler(async (req, res) => {
  const out = await login(req.body, {
    userAgent: req.get("user-agent"),
    ipAddress: req.ip,
  });
  setRefreshCookie(res, out.refreshToken);
  res.json({
    success: true,
    data: { user: out.user, accessToken: out.accessToken },
  });
});
export const refreshController = asyncHandler(async (req, res) => {
  const raw = req.cookies.banyan_refresh_token || req.body.refreshToken;
  const out = await rotateRefreshToken(raw, {
    userAgent: req.get("user-agent"),
    ipAddress: req.ip,
  });
  setRefreshCookie(res, out.refreshToken);
  res.json({
    success: true,
    data: { user: out.user, accessToken: out.accessToken },
  });
});
export const logoutController = asyncHandler(async (req, res) => {
  await logout(req.cookies.banyan_refresh_token || req.body.refreshToken);
  clearRefreshCookie(res);
  res.json({ success: true, message: "Logged out successfully." });
});
export const meController = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ success: true, data: { user } });
});
export const updateProfileController = asyncHandler(async (req, res) => {
  const allowed = ["name", "phone", "jobTitle", "avatarUrl", "preferences"];
  const patch = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k)),
  );
  const user = await User.findByIdAndUpdate(req.user._id, patch, {
    new: true,
    runValidators: true,
  });
  res.json({ success: true, data: { user } });
});
