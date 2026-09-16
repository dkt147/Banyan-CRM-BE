import { AppError } from "../utils/AppError.js";

export function notFoundHandler(req, _res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, "NOT_FOUND"));
}

export function errorHandler(error, req, res, _next) {
  let statusCode = error.statusCode ?? 500;
  let code = error.code ?? "INTERNAL_SERVER_ERROR";
  let message = error.message ?? "Internal server error.";

  if (error.code === 11000) {
    statusCode = 409;
    code = "DUPLICATE_RESOURCE";
    message = "A resource with the same unique value already exists.";
  }

  if (error.name === "ValidationError") {
    statusCode = 400;
    code = "DATABASE_VALIDATION_ERROR";
  }

  if (error.name === "CastError") {
    statusCode = 400;
    code = "INVALID_ID";
    message = "Invalid resource identifier.";
  }

  const response = {
    success: false,
    error: {
      code,
      message
    }
  };

  if (error.details) response.error.details = error.details;

  if (process.env.NODE_ENV !== "production") {
    response.error.stack = error.stack;
  }

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);

  res.status(statusCode).json(response);
}
