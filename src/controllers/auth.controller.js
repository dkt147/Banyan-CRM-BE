import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from "../utils/cookies.js";
import {
  loginUser,
  logoutSession,
  refreshSession,
  registerUser
} from "../services/auth.service.js";

export const register = asyncHandler(async (req, res) => {
  const result = await registerUser(req.body);

  res.status(201).json({
    success: true,
    data: result
  });
});

export const login = asyncHandler(async (req, res) => {
  const result = await loginUser(req.body, {
    userAgent: req.get("user-agent"),
    ipAddress: req.ip
  });

  setRefreshCookie(res, result.refreshToken);

  res.json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.accessToken
    }
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies[REFRESH_COOKIE_NAME];
  const result = await refreshSession(token, {
    userAgent: req.get("user-agent"),
    ipAddress: req.ip
  });

  setRefreshCookie(res, result.refreshToken);

  res.json({
    success: true,
    data: {
      user: result.user,
      accessToken: result.accessToken
    }
  });
});

export const logout = asyncHandler(async (req, res) => {
  await logoutSession(req.cookies[REFRESH_COOKIE_NAME]);
  clearRefreshCookie(res);

  res.json({
    success: true,
    data: { message: "Logged out successfully." }
  });
});

export const me = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        id: req.user._id.toString(),
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        isActive: req.user.isActive,
        lastLoginAt: req.user.lastLoginAt,
        createdAt: req.user.createdAt,
        updatedAt: req.user.updatedAt
      }
    }
  });
});
