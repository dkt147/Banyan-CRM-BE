import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { RefreshToken } from "../models/RefreshToken.js";
import { AppError } from "../utils/AppError.js";
import {
  createAccessToken,
  createRefreshToken,
  hashToken,
  verifyRefreshToken
} from "../utils/tokens.js";

const BCRYPT_ROUNDS = 12;

export async function registerUser({ name, email, password, role }) {
  const existing = await User.findOne({ email });
  if (existing) {
    throw new AppError("An account with this email already exists.", 409, "EMAIL_EXISTS");
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({ name, email, passwordHash, role });

  return {
    user: sanitizeUser(user),
    accessToken: createAccessToken(user)
  };
}

export async function loginUser({ email, password }, meta = {}) {
  const user = await User.findOne({ email }).select("+passwordHash");

  if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError("Invalid email or password.", 401, "INVALID_CREDENTIALS");
  }

  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken(user);

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: getRefreshExpiry(refreshToken),
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null
  });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken
  };
}

export async function refreshSession(refreshToken, meta = {}) {
  if (!refreshToken) {
    throw new AppError("Refresh token is required.", 401, "REFRESH_TOKEN_REQUIRED");
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError("Invalid or expired refresh token.", 401, "INVALID_REFRESH_TOKEN");
  }

  const stored = await RefreshToken.findOne({
    tokenHash: hashToken(refreshToken),
    revokedAt: null
  });

  if (!stored || stored.userId.toString() !== payload.sub || stored.expiresAt <= new Date()) {
    throw new AppError("Invalid or expired refresh token.", 401, "INVALID_REFRESH_TOKEN");
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw new AppError("User account is inactive or unavailable.", 401, "USER_INACTIVE");
  }

  const newRefreshToken = createRefreshToken(user);
  const replacement = await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(newRefreshToken),
    expiresAt: getRefreshExpiry(newRefreshToken),
    userAgent: meta.userAgent ?? stored.userAgent ?? null,
    ipAddress: meta.ipAddress ?? stored.ipAddress ?? null
  });

  stored.revokedAt = new Date();
  stored.replacedByTokenId = replacement._id;
  await stored.save();

  return {
    user: sanitizeUser(user),
    accessToken: createAccessToken(user),
    refreshToken: newRefreshToken
  };
}

export async function logoutSession(refreshToken) {
  if (!refreshToken) return;

  await RefreshToken.updateOne(
    { tokenHash: hashToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

function getRefreshExpiry(token) {
  const decoded = verifyRefreshToken(token);
  return new Date(decoded.exp * 1000);
}

export function sanitizeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}
