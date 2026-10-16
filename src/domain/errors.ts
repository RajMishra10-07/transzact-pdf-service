export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Unauthorized request') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden access to resource') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, details);
  }
}

export class RenderingTimeoutError extends AppError {
  constructor(message = 'Document rendering exceeded time limit') {
    super(message, 504);
  }
}

export class LargeDocumentMemoryError extends AppError {
  constructor(message = 'Document complexity exceeds safe memory limits') {
    super(message, 422);
  }
}

export class IntegrityVerificationError extends AppError {
  constructor(message = 'PDF checksum verification failed: file content does not match recorded SHA-256') {
    super(message, 409);
  }
}
