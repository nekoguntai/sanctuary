/**
 * Service Layer Errors
 *
 * Domain-specific error types for service layer.
 * These errors are translated to HTTP responses by route handlers.
 */

/**
 * Base service error class
 */
export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/**
 * Resource not found error (404)
 */
export class NotFoundError extends ServiceError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} '${identifier}' not found`
      : `${resource} not found`;
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Access forbidden error (403)
 */
export class ForbiddenError extends ServiceError {
  constructor(message: string = 'You do not have permission to perform this action') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * Conflict error (409) - e.g., duplicate resource
 */
export class ConflictError extends ServiceError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends ServiceError {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super('VALIDATION_ERROR', message, 400);
    this.name = 'ValidationError';
  }
}

/**
 * Type guard for ServiceError
 */
export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/**
 * Convert service error to HTTP response format
 */
export function toHttpError(error: ServiceError): { status: number; body: { error: string; message: string } } {
  return {
    status: error.statusCode,
    body: {
      error: error.code,
      message: error.message,
    },
  };
}
