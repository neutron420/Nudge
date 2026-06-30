import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import logger from "../../config/logger.js";

// Add custom properties to Request interface via global declaration
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: {
        userId: string;
        sessionId: string;
      };
    }
  }
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: any;

  constructor(statusCode: number, code: string, message: string, details: any = null) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = "BAD_REQUEST", details: any = null) {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, code = "UNAUTHORIZED") {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, code = "FORBIDDEN") {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code = "NOT_FOUND") {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(409, code, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string, code = "TOO_MANY_REQUESTS") {
    super(429, code, message);
  }
}

// Request ID middleware
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const reqId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  req.requestId = reqId;
  res.setHeader("x-request-id", reqId);
  next();
};

// Global error handling middleware
export const errorHandlerMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId = req.requestId || "unknown";

  if (err instanceof AppError) {
    logger.warn({
      msg: `API Warning: ${err.message}`,
      code: err.code,
      statusCode: err.statusCode,
      requestId,
      details: err.details,
    });

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId,
        details: err.details,
      },
    });
    return;
  }

  // Handle unexpected/system errors
  logger.error({
    msg: "Unhandled Internal Server Error",
    error: err.message || err,
    stack: err.stack,
    requestId,
  });

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
      requestId,
      details: process.env.NODE_ENV === "development" ? err.stack : null,
    },
  });
};
