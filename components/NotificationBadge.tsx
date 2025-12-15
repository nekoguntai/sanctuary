/**
 * Notification Badge Component
 *
 * Displays a badge with notification count. Used in sidebar and navigation.
 */

import React from 'react';

interface NotificationBadgeProps {
  count: number;
  severity?: 'info' | 'warning' | 'critical';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  maxCount?: number;
  showZero?: boolean;
  pulse?: boolean;
}

export const NotificationBadge: React.FC<NotificationBadgeProps> = ({
  count,
  severity = 'warning',
  size = 'sm',
  className = '',
  maxCount = 9,
  showZero = false,
  pulse = false,
}) => {
  if (count === 0 && !showZero) return null;

  const displayCount = count > maxCount ? `${maxCount}+` : count.toString();

  const sizeClasses = {
    sm: 'h-4 min-w-4 text-[10px]',
    md: 'h-5 min-w-5 text-xs',
    lg: 'h-6 min-w-6 text-sm',
  };

  const severityClasses = {
    info: 'bg-primary-500 text-white',
    warning: 'bg-rose-400 dark:bg-rose-500 text-white',
    critical: 'bg-rose-600 text-white',
  };

  return (
    <span
      className={`
        inline-flex items-center justify-center rounded-full font-bold
        ${sizeClasses[size]}
        ${severityClasses[severity]}
        ${pulse ? 'animate-pulse' : ''}
        ${className}
      `.trim()}
      style={{ padding: '0 4px' }}
    >
      {displayCount}
    </span>
  );
};

/**
 * Notification Dot Component
 *
 * A simple dot indicator without a count.
 */
interface NotificationDotProps {
  severity?: 'info' | 'warning' | 'critical';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  pulse?: boolean;
  visible?: boolean;
}

export const NotificationDot: React.FC<NotificationDotProps> = ({
  severity = 'warning',
  size = 'sm',
  className = '',
  pulse = true,
  visible = true,
}) => {
  if (!visible) return null;

  const sizeClasses = {
    sm: 'h-2 w-2',
    md: 'h-2.5 w-2.5',
    lg: 'h-3 w-3',
  };

  const severityClasses = {
    info: 'bg-primary-500',
    warning: 'bg-rose-400 dark:bg-rose-500',
    critical: 'bg-rose-600',
  };

  return (
    <span
      className={`
        inline-block rounded-full
        ${sizeClasses[size]}
        ${severityClasses[severity]}
        ${pulse ? 'animate-pulse' : ''}
        ${className}
      `.trim()}
    />
  );
};

export default NotificationBadge;
