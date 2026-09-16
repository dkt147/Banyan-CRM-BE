import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { verifyAccessToken } from "../utils/tokens.js";

export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    }

    const payload = verifyAccessToken(token);

    if (payload.type !== "access") {
      throw new AppError("Invalid access token.", 401, "INVALID_ACCESS_TOKEN");
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new AppError("User account is inactive or unavailable.", 401, "USER_INACTIVE");
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError("Invalid or expired access token.", 401, "INVALID_ACCESS_TOKEN"));
  }
}
