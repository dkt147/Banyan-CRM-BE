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
/** A Mongoose field error as a message that never contains the submitted value. */
function mongoFieldMessage(e) {
  const p = e.path;
  const n = e.properties?.maxlength ?? e.properties?.minlength ?? e.properties?.max ?? e.properties?.min;
  switch (e.kind) {
    case "maxlength": return `${p} is too long (max ${n} characters).`;
    case "minlength": return `${p} is too short (min ${n} characters).`;
    case "max": return `${p} is too large (max ${n}).`;
    case "min": return `${p} is too small (min ${n}).`;
    case "required": return `${p} is required.`;
    case "enum": return `${p} has a value that isn't allowed.`;
    case "regexp": return `${p} has an invalid format.`;
    default: return `${p} is invalid.`;
  }
}

export function errorHandler(err, _req, res, _next) {
  let status = err.statusCode || 500,
    code = err.code || "INTERNAL_ERROR",
    message = err.message || "Internal server error",
    details = err.details || null;
  const coded = err instanceof ZodError ? err.issues.find((i) => i.params?.code) : null;
  if (coded) {
    // A schema that names its own error code (e.g. INVALID_TAG) and its details.
    status = 400;
    code = coded.params.code;
    message = coded.message;
    const { code: _c, ...rest } = coded.params;
    details = { ...rest, path: coded.path };
  } else if (err instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Validation failed.";
    details = err.issues;
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = "MONGO_VALIDATION_ERROR";
    // Never echo submitted values: Mongoose messages can include them, and they may hold
    // personal data or very large text.
    details = Object.values(err.errors).map((e) => ({
      path: e.path,
      message: mongoFieldMessage(e),
    }));
    message = details.length === 1 ? details[0].message : "Validation failed.";
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = "INVALID_ID";
    message = "Invalid identifier.";
  } else if (err?.code === 11000) {
    status = 409;
    code = "DUPLICATE_RESOURCE";
    message = "A record with the same unique value already exists.";
    details = err.keyValue ? { fields: Object.keys(err.keyValue) } : null;
  } else if (err?.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "The request is too large.";
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "The request body isn't valid JSON.";
  }
  if (process.env.NODE_ENV !== "production") console.error(err);
  res
    .status(status)
    .json({ success: false, code, message, ...(details ? { details } : {}) });
}
