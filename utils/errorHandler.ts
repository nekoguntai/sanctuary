/**
 * Error Handler Utility
 *
 * Provides standardized error handling across the application with consistent
 * logging and optional UI feedback through notifications.
 *
 * ================================================================================
 * USAGE
 * ================================================================================
 *
 * For components with notification support (using useErrorHandler hook):
 *   import { useErrorHandler } from '../hooks/useErrorHandler';
 *
 *   const { handleError } = useErrorHandler();
 *
 *   try {
 *     await someOperation();
 *   } catch (error) {
 *     handleError(error, 'Operation Failed');
 *   }
 *
 * For utilities or contexts without access to hooks:
 *   import { logError } from '../utils/errorHandler';
 *   import { createLogger } from '../utils/logger';
 *
 *   const log = createLogger('MyComponent');
 *
 *   try {
 *     await someOperation();
 *   } catch (error) {
 *     logError(log, error, 'Failed to perform operation');
 *     // Optionally rethrow or handle as needed
 *   }
 *
 * ================================================================================
 */

import { Logger } from './logger';
import { ApiError } from '../src/api/client';

/**
 * Options for error handling
 */
export interface ErrorHandlerOptions {
  /**
   * Custom fallback message if error message extraction fails
   */
  fallbackMessage?: string;

  /**
   * Additional context to include in logs
   */
  context?: Record<string, unknown>;

  /**
   * Whether to suppress logging (default: false)
   */
  silent?: boolean;
}

/**
 * Extract a user-friendly error message from an unknown error
 *
 * @param error - The error object (can be Error, ApiError, string, or unknown)
 * @param fallbackMessage - Message to use if extraction fails
 * @returns User-friendly error message string
 */
export function extractErrorMessage(error: unknown, fallbackMessage = 'An unexpected error occurred'): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return fallbackMessage;
}

/**
 * Log an error with consistent formatting and context
 *
 * This function should be used for error logging that doesn't require UI feedback.
 * For UI feedback, use the useErrorHandler hook instead.
 *
 * @param logger - Logger instance (from createLogger)
 * @param error - The error to log
 * @param message - Context message describing what failed
 * @param options - Additional options for error handling
 * @returns The extracted error message
 *
 * @example
 * const log = createLogger('WalletService');
 *
 * try {
 *   await fetchWallet(id);
 * } catch (error) {
 *   logError(log, error, 'Failed to fetch wallet', { walletId: id });
 * }
 */
export function logError(
  logger: Logger,
  error: unknown,
  message: string,
  options: ErrorHandlerOptions = {}
): string {
  const { fallbackMessage, context, silent = false } = options;

  const errorMessage = extractErrorMessage(error, fallbackMessage);

  if (!silent) {
    const logContext = {
      error,
      errorMessage,
      ...context,
    };

    logger.error(message, logContext);
  }

  return errorMessage;
}

/**
 * Check if an error is an AbortError (from fetch abort)
 *
 * @param error - The error to check
 * @returns true if the error is an AbortError
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Check if an error is a network error
 *
 * @param error - The error to check
 * @returns true if the error appears to be network-related
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('network') ||
           message.includes('fetch') ||
           message.includes('connection');
  }
  return false;
}

/**
 * Check if an error is a 404 Not Found error
 *
 * @param error - The error to check
 * @returns true if the error is a 404
 */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * Check if an error is an authentication error (401/403)
 *
 * @param error - The error to check
 * @returns true if the error is authentication-related
 */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
