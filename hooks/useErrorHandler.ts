/**
 * Error Handler Hook
 *
 * Centralized error handling using the notification system.
 * Replaces scattered alert() calls with consistent toast notifications.
 */

import { useCallback } from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import { ApiError } from '../src/api/client';

interface ErrorHandlerOptions {
  defaultTitle?: string;
  defaultDuration?: number;
}

/**
 * Hook for centralized error handling and success notifications.
 *
 * @example
 * const { handleError, showSuccess, showInfo } = useErrorHandler();
 *
 * try {
 *   await someOperation();
 *   showSuccess('Operation completed');
 * } catch (error) {
 *   handleError(error, 'Operation Failed');
 * }
 */
export const useErrorHandler = (options: ErrorHandlerOptions = {}) => {
  const { addNotification } = useNotifications();
  const { defaultTitle = 'Error', defaultDuration = 5000 } = options;

  /**
   * Handle and display an error notification.
   * Automatically extracts message from ApiError, Error, or string.
   */
  const handleError = useCallback(
    (error: unknown, customTitle?: string) => {
      let message = 'An unexpected error occurred';

      if (error instanceof ApiError) {
        message = error.message;
      } else if (error instanceof Error) {
        message = error.message;
      } else if (typeof error === 'string') {
        message = error;
      }

      addNotification({
        type: 'error',
        title: customTitle || defaultTitle,
        message,
        duration: defaultDuration,
      });
    },
    [addNotification, defaultTitle, defaultDuration]
  );

  /**
   * Display a success notification.
   */
  const showSuccess = useCallback(
    (message: string, title = 'Success') => {
      addNotification({
        type: 'success',
        title,
        message,
        duration: 3000,
      });
    },
    [addNotification]
  );

  /**
   * Display an info notification.
   */
  const showInfo = useCallback(
    (message: string, title = 'Info') => {
      addNotification({
        type: 'info',
        title,
        message,
        duration: 4000,
      });
    },
    [addNotification]
  );

  return { handleError, showSuccess, showInfo };
};
