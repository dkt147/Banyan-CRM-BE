import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      type: "access",
      workspaceId: String(user.workspaceId),
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_EXPIRES_IN },
  );
}
export function signRefreshToken(user, tokenId) {
  return jwt.sign(
    {
      sub: String(user._id),
      jti: tokenId,
      type: "refresh",
      workspaceId: String(user.workspaceId),
    },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN },
  );
}
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
}
export function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
export function newTokenId() {
  return crypto.randomUUID();
}
