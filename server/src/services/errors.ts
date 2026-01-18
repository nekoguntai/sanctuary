/**
 * Service Layer Errors
 *
 * Re-exports error types from the central errors module for backward compatibility.
 * New code should import directly from '../errors'.
 *
 * @deprecated Import from '../errors' instead for new code.
 */

import {
  ApiError,
  NotFoundError as ApiNotFoundError,
  ForbiddenError as ApiForbiddenError,
  ConflictError as ApiConflictError,
  ValidationError as ApiValidationError,
  ErrorCodes,
} from '../errors';

// Re-export base class for backward compatibility
export { ApiError as ServiceError };

/**
 * Resource not found error (404)
 * Wrapper that maintains the original constructor signature.
 */
export class NotFoundError extends ApiNotFoundError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} '${identifier}' not found`
      : `${resource} not found`;
    super(message, ErrorCodes.NOT_FOUND);
  }
}

/**
 * Access forbidden error (403)
 */
export class ForbiddenError extends ApiForbiddenError {
  constructor(message: string = 'You do not have permission to perform this action') {
    super(message, ErrorCodes.FORBIDDEN);
  }
}

/**
 * Conflict error (409) - e.g., duplicate resource
 */
export class ConflictError extends ApiConflictError {
  constructor(message: string) {
    super(message, ErrorCodes.CONFLICT);
  }
}

/**
 * Validation error (400)
 * Wrapper that maintains the original constructor signature with optional field.
 */
export class ValidationError extends ApiValidationError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, ErrorCodes.VALIDATION_ERROR, field ? { field } : undefined);
    this.field = field;
  }
}

/**
 * Type guard for ServiceError (ApiError)
 */
export function isServiceError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Convert service error to HTTP response format
 */
export function toHttpError(error: ApiError): { status: number; body: { error: string; message: string } } {
  return {
    status: error.statusCode,
    body: {
      error: error.code,
      message: error.message,
    },
  };
}
