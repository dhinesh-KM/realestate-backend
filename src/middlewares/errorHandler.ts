import { Request, Response, NextFunction } from 'express';
import { PrismaClientKnownRequestError, PrismaClientValidationError } from '@prisma/client/runtime/library';
import { ZodError } from 'zod';
import { AppError } from '../shared/apiError';
import { logger } from '../shared/logger';
import { env } from '../config/env';

/**
 * Global error handler — the single source of truth for all error responses.
 *
 * Design contract:
 * - AppError (isOperational: true)  → send error message to client
 * - Everything else                 → send generic message, log full error
 * - Never expose stack traces, SQL, or Prisma internals to clients
 * - Every response includes a requestId for log correlation
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Default to 500
  let statusCode = 500;
  let message = 'Something went wrong. Please try again later.';
  let errors: Record<string, string>[] | undefined;
  let isOperational = false;

  // ── Known operational error ──────────────────────────────────
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    errors = err.errors;
    isOperational = err.isOperational;
  }

  // ── Zod validation error ─────────────────────────────────────
  else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    isOperational = true;
  }

  // ── Prisma known errors ──────────────────────────────────────
  else if (err instanceof PrismaClientKnownRequestError) {
    isOperational = true;
    switch ((err as PrismaClientKnownRequestError).code) {
      case 'P2002':
        statusCode = 409;
        const field = ((err as PrismaClientKnownRequestError).meta?.target as string[])?.[0] ?? 'field';
        message = `${field} already exists`;
        break;
      case 'P2025':
        statusCode = 404;
        message = 'Record not found';
        break;
      case 'P2003':
        statusCode = 422;
        message = 'Related record not found';
        break;
      case 'P2014':
        statusCode = 422;
        message = 'Invalid relation';
        break;
      default:
        statusCode = 500;
        message = 'Database error';
        isOperational = false;
    }
  }

  // ── Prisma validation error ──────────────────────────────────
  else if (err instanceof PrismaClientValidationError) {
    statusCode = 400;
    message = 'Invalid data provided';
    isOperational = true;
  }

  // ── JWT errors are handled in authenticate middleware ─────────
  // They arrive here as AppError already

  // ── Log ──────────────────────────────────────────────────────
  const requestId = (req as any).requestId;

  if (!isOperational) {
    // Programmer error — log full details, never expose to client
    logger.error('Unhandled error', {
      requestId,
      error: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
      ip: req.ip,
    });
  } else if (statusCode >= 500) {
    logger.error('Operational 5xx', { requestId, error: err.message });
  } else {
    logger.warn('Client error', { requestId, statusCode, error: err.message });
  }

  // ── Response ─────────────────────────────────────────────────
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    ...(errors && { errors }),
    ...(requestId && { requestId }),
    // Include stack only in development for non-operational errors
    ...(env.NODE_ENV === 'development' && !isOperational && { stack: err.stack }),
  });
};