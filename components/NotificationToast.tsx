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
    switch (notification.type) {
      case 'transaction':
        return notification.data?.type === 'received' ? (
          <ArrowDownLeft className="w-5 h-5 text-green-600" />
        ) : (
          <ArrowUpRight className="w-5 h-5 text-blue-600" />
        );
      case 'balance':
        return <TrendingUp className="w-5 h-5 text-primary-600" />;
      case 'confirmation':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'block':
        return <Activity className="w-5 h-5 text-purple-600" />;
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <X className="w-5 h-5 text-rose-600" />;
      default:
        return <Activity className="w-5 h-5 text-blue-600" />;
    }
  };

  const getColors = () => {
    switch (notification.type) {
      case 'transaction':
        return notification.data?.type === 'received'
          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-500/20'
          : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-500/20';
      case 'balance':
        return 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-500/20';
      case 'confirmation':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-500/20';
      case 'block':
        return 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-500/20';
      case 'success':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-500/20';
      case 'error':
        return 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-500/20';
      default:
        return 'surface-secondary/50 border-sanctuary-200 dark:border-sanctuary-700';
    }
  };

  return (
    <div
      className={`
        flex items-start space-x-3 p-4 rounded-xl border shadow-lg
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
