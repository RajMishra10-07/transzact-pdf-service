import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../domain/errors.js';
import { logger } from '../../utils/logger.js';

export function errorHandlerMiddleware(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const correlationId = req.headers['x-correlation-id'] as string;

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    logger.warn({ correlationId, issues: err.issues }, 'Request validation failed');
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  // Handle Domain/Operational errors
  if (err instanceof AppError) {
    logger.warn({ correlationId, statusCode: err.statusCode, message: err.message }, err.name);
    res.status(err.statusCode).json({
      error: {
        code: err.name,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // Unhandled / Internal Server Errors
  logger.error({ correlationId, err: err.message, stack: err.stack }, 'Unhandled internal server error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred. Please contact system support.',
    },
  });
}
