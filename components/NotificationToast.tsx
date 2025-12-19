import React, { useEffect, useState } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, CheckCircle, TrendingUp, Activity } from 'lucide-react';

export type NotificationType = 'transaction' | 'balance' | 'confirmation' | 'block' | 'success' | 'error' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  duration?: number; // milliseconds, undefined = persistent
  data?: any;
}

interface NotificationToastProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ notification, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (notification.duration) {
      const timer = setTimeout(() => {
        handleDismiss();
      }, notification.duration);

      return () => clearTimeout(timer);
    }
  }, [notification.duration]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(notification.id);
    }, 300); // Match exit animation duration
  };

  const getIcon = () => {
    // Use theme colors: success (green) for receives/confirmations, warning (gold) for sends
    switch (notification.type) {
      case 'transaction':
        return notification.data?.type === 'received' ? (
          <ArrowDownLeft className="w-5 h-5 text-success-600 dark:text-success-400" />
        ) : (
          <ArrowUpRight className="w-5 h-5 text-warning-600 dark:text-warning-400" />
        );
      case 'balance':
        return <TrendingUp className="w-5 h-5 text-primary-600 dark:text-primary-400" />;
      case 'confirmation':
        return <CheckCircle className="w-5 h-5 text-success-600 dark:text-success-400" />;
      case 'block':
        return <Activity className="w-5 h-5 text-primary-600 dark:text-primary-400" />;
      case 'success':
        return <CheckCircle className="w-5 h-5 text-success-600 dark:text-success-400" />;
      case 'error':
        return <X className="w-5 h-5 text-rose-600 dark:text-rose-400" />;
      default:
        return <Activity className="w-5 h-5 text-primary-600 dark:text-primary-400" />;
    }
  };

  const getColors = () => {
    // Use theme colors for notifications - success (green) for receives, warning (gold) for sends
    // Use surface templates for neutral notifications to ensure proper dark mode handling
    switch (notification.type) {
      case 'transaction':
        return notification.data?.type === 'received'
          ? 'bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-700'
          : 'bg-warning-50 dark:bg-warning-900/30 border-warning-200 dark:border-warning-700';
      case 'balance':
        return 'surface-secondary border-primary-200 dark:border-primary-700';
      case 'confirmation':
        return 'bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-700';
      case 'block':
        return 'surface-secondary border-primary-200 dark:border-primary-700';
      case 'success':
        return 'bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-700';
      case 'error':
        return 'bg-rose-50 dark:bg-rose-950/80 border-rose-300 dark:border-rose-700';
      default:
        return 'surface-secondary border-primary-200 dark:border-primary-700';
    }
  };

  return (
    <div
      className={`
        flex items-start space-x-3 p-4 rounded-xl border shadow-xl backdrop-blur-sm
        ${getColors()}
        ${isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right'}
        transition-all duration-300
      `}
      role="alert"
    >
      <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-50">
          {notification.title}
        </p>
        <p className="text-xs text-sanctuary-600 dark:text-sanctuary-400 mt-1">
          {notification.message}
        </p>
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 p-1 rounded-lg hover:bg-sanctuary-200/50 dark:hover:bg-sanctuary-700/50 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4 text-sanctuary-500" />
      </button>
    </div>
  );
};

interface NotificationContainerProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

export const NotificationContainer: React.FC<NotificationContainerProps> = ({
  notifications,
  onDismiss,
}) => {
  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col space-y-3 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="space-y-3 pointer-events-auto">
        {notifications.map((notification) => (
          <NotificationToast
            key={notification.id}
            notification={notification}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
};

// Utility function to generate notification ID
export const generateNotificationId = (): string => {
  return `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
