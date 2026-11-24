/*
 * Passwords (client meeting 25 Nov, §2): admins set a member's password; users change their own.
 * Either way every refresh token of that user is revoked (rotation grace included) and access
 * tokens issued before passwordChangedAt are refused by requireAuth.
 */
import bcrypt from "bcryptjs";
import { RefreshToken } from "../models/RefreshToken.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";

export const PASSWORD_RULE = "Use at least 8 characters, with at least one letter and one number.";

export function assertStrongPassword(password) {
  const p = typeof password === "string" ? password : "";
  if (p.length < 8 || p.length > 200 || !/[A-Za-z]/.test(p) || !/[0-9]/.test(p))
    throw new AppError(`That password is too weak. ${PASSWORD_RULE}`, 400, "WEAK_PASSWORD");
  return p;
}

/** Signs the user out everywhere: revokes all refresh tokens and ends the rotation grace. */
export async function revokeAllSessions(userId) {
  const now = new Date();
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } });
  await RefreshToken.updateMany({ userId, replacedByTokenId: { $ne: null } }, { $set: { replacedByTokenId: null } });
}

async function savePassword(user, password) {
  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(user._id);
  return user.passwordChangedAt;
}

/** POST /members/:id/password (users.manage). */
export async function adminSetPassword(actor, targetId, password) {
  if (String(actor._id) === String(targetId))
    throw new AppError("Use Change password to change your own password.", 400, "USE_CHANGE_PASSWORD");
  const user = await User.findOne({ _id: targetId, workspaceId: actor.workspaceId }).select("+passwordHash");
  if (!user) throw new AppError("Member not found", 404, "NOT_FOUND");
  if (!user.isActive) throw new AppError("This member is inactive. Reactivate them first, then set a password.", 409, "USER_INACTIVE");
  assertStrongPassword(password);
  const passwordChangedAt = await savePassword(user, password);
  return { id: String(user._id), passwordChangedAt };
}

/** POST /auth/change-password. A wrong current password is 400, never 401 (the app signs out on 401). */
export async function changeOwnPassword(userId, { currentPassword, newPassword } = {}) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new AppError("User not found.", 404, "NOT_FOUND");
  if (typeof currentPassword !== "string" || !currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash)))
    throw new AppError("Your current password isn't right.", 400, "INVALID_CURRENT_PASSWORD");
  assertStrongPassword(newPassword);
  if (await bcrypt.compare(newPassword, user.passwordHash))
    throw new AppError("The new password must be different from the current one.", 400, "SAME_PASSWORD");
  const passwordChangedAt = await savePassword(user, newPassword);
  return { id: String(user._id), passwordChangedAt };
}
