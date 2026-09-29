import mongoose from "mongoose";
import { ZodError } from "zod";
import { AppError } from "../utils/AppError.js";

export function notFoundHandler(req, _res, next) {
  next(
    new AppError(
      `Route not found: ${req.method} ${req.originalUrl}`,
      404,
      "NOT_FOUND",
    ),
  );
}
export function errorHandler(err, _req, res, _next) {
  let status = err.statusCode || 500,
    code = err.code || "INTERNAL_ERROR",
    message = err.message || "Internal server error",
    details = err.details || null;
  if (err instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Validation failed.";
    details = err.issues;
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = "MONGO_VALIDATION_ERROR";
    details = Object.values(err.errors).map((e) => ({
      path: e.path,
      message: e.message,
    }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = "INVALID_ID";
    message = "Invalid identifier.";
  } else if (err?.code === 11000) {
    status = 409;
    code = "DUPLICATE_RESOURCE";
    message = "A record with the same unique value already exists.";
    details = err.keyValue;
  }
  if (process.env.NODE_ENV !== "production") console.error(err);
  res
    .status(status)
    .json({ success: false, code, message, ...(details ? { details } : {}) });
}
