import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { verifyAccessToken } from "../utils/tokens.js";
import { READ_ONLY_ALLOWED_WRITES, can, roleGroup } from "../utils/permissions.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token)
      throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    const payload = verifyAccessToken(token);
    if (payload.type !== "access")
      throw new AppError("Invalid access token.", 401, "INVALID_ACCESS_TOKEN");
    const user = await User.findById(payload.sub).select("+passwordHash");
    if (!user || !user.isActive)
      throw new AppError(
        "User account is inactive or unavailable.",
        401,
        "USER_INACTIVE",
      );
    if (!user.workspaceId)
      throw new AppError(
        "User is not associated with a workspace.",
        403,
        "WORKSPACE_REQUIRED",
      );
    req.user = user;
    req.workspaceId = user.workspaceId;
    // Read-only role (brief section 7): no creates, edits or deletes anywhere.
    if (
      roleGroup(user.role) === "read_only" &&
      !SAFE_METHODS.has(req.method) &&
      !READ_ONLY_ALLOWED_WRITES.some((rx) => rx.test(req.originalUrl.split("?")[0]))
    )
      throw new AppError("Your role is read-only.", 403, "READ_ONLY");
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(
      new AppError(
        "Invalid or expired access token.",
        401,
        "INVALID_ACCESS_TOKEN",
      ),
    );
  }
}

export function requireRoles(...roles) {
  return (req, _res, next) =>
    roles.includes(req.user.role)
      ? next()
      : next(
          new AppError(
            "You do not have permission for this action.",
            403,
            "FORBIDDEN",
          ),
        );
}

/** Allows the request only when the user's role has the permission (utils/permissions.js). */
export function requirePermission(permission) {
  return (req, _res, next) =>
    can(req.user, permission)
      ? next()
      : next(new AppError("You do not have permission for this action.", 403, "FORBIDDEN"));
}
