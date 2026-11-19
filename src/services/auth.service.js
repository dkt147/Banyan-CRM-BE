import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { RefreshToken } from "../models/RefreshToken.js";
import { AppError } from "../utils/AppError.js";
import {
  hashToken,
  newTokenId,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/tokens.js";

const ROTATION_GRACE_MS = 30 * 1000;

function publicUser(user) {
  const o = user.toObject();
  delete o.passwordHash;
  return o;
}
export async function register(
  { name, email, password, workspaceName, workspaceSlug },
  meta = {},
) {
  if (await User.findOne({ email }))
    throw new AppError("Email is already registered.", 409, "EMAIL_EXISTS");
  const slug = (workspaceSlug || workspaceName || `${name}-workspace`)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (await Workspace.findOne({ slug }))
    throw new AppError(
      "Workspace slug is already in use.",
      409,
      "WORKSPACE_EXISTS",
    );
  const workspace = await Workspace.create({
    name: workspaceName || `${name}'s Workspace`,
    slug,
  });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    workspaceId: workspace._id,
    name,
    email,
    passwordHash,
    role: "admin",
  });
  workspace.createdBy = user._id;
  await workspace.save();
  const tokens = await issueTokens(user, meta);
  return { user: publicUser(user), ...tokens };
}
export async function login({ email, password }, meta = {}) {
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    throw new AppError(
      "Invalid email or password.",
      401,
      "INVALID_CREDENTIALS",
    );
  if (!user.isActive)
    throw new AppError("User account is inactive.", 403, "USER_INACTIVE");
  user.lastLoginAt = new Date();
  await user.save();
  return { user: publicUser(user), ...(await issueTokens(user, meta)) };
}
export async function issueTokens(user, meta = {}) {
  const tokenId = newTokenId(),
    refreshToken = signRefreshToken(user, tokenId);
  const decoded = verifyRefreshToken(refreshToken);
  const doc = await RefreshToken.create({
    workspaceId: user.workspaceId,
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(decoded.exp * 1000),
    userAgent: meta.userAgent || null,
    ipAddress: meta.ipAddress || null,
  });
  return { accessToken: signAccessToken(user), refreshToken, refreshTokenId: doc._id };
}
export async function rotateRefreshToken(raw, meta = {}) {
  if (!raw)
    throw new AppError("Refresh token is required.", 401, "REFRESH_REQUIRED");
  const payload = verifyRefreshToken(raw);
  if (payload.type !== "refresh")
    throw new AppError("Invalid refresh token.", 401, "INVALID_REFRESH_TOKEN");
  const existing = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
  // Rotation grace: two tabs can refresh with the same token at once. A token rotated in the last
  // ROTATION_GRACE_MS (not logged out: replacedByTokenId is set) still gets a fresh pair.
  const inGrace =
    existing?.revokedAt &&
    existing.replacedByTokenId &&
    Date.now() - existing.revokedAt.getTime() <= ROTATION_GRACE_MS;
  if (!existing || existing.expiresAt <= new Date() || (existing.revokedAt && !inGrace))
    throw new AppError(
      "Refresh token is invalid or expired.",
      401,
      "INVALID_REFRESH_TOKEN",
    );
  const user = await User.findById(payload.sub).select("+passwordHash");
  if (!user || !user.isActive)
    throw new AppError("User account is inactive.", 401, "USER_INACTIVE");
  const next = await issueTokens(user, meta);
  if (!existing.revokedAt) {
    existing.revokedAt = new Date();
    existing.replacedByTokenId = next.refreshTokenId;
    await existing.save();
  }
  return { user: publicUser(user), ...next };
}
export async function logout(raw) {
  if (raw)
    await RefreshToken.findOneAndUpdate(
      { tokenHash: hashToken(raw), revokedAt: null },
      { revokedAt: new Date() },
    );
}
