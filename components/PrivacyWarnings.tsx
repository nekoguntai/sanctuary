/**
 * Privacy Warnings Component
 *
 * Displays dismissible privacy warnings before sending a transaction.
 * Warnings are informational and do not block the transaction.
 */

import React from 'react';
import { AlertTriangle, X, Shield } from 'lucide-react';

export interface PrivacyWarning {
  type: 'address_linking' | 'round_amount' | 'address_reuse' | 'privacy_score_disparity' | 'dust_consolidation' | 'general';
  severity: 'low' | 'medium' | 'high';
  message: string;
}

interface PrivacyWarningsProps {
  warnings: PrivacyWarning[];
  onDismiss?: (type: string) => void;
  dismissedWarnings?: Set<string>;
  className?: string;
}

/**
 * Parse string warnings from the API into structured warnings
 */
export function parseWarnings(warningStrings: string[]): PrivacyWarning[] {
  return warningStrings.map((message) => {
    let type: PrivacyWarning['type'] = 'general';
    let severity: PrivacyWarning['severity'] = 'medium';

    // Detect warning type from message content
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('address') && lowerMessage.includes('link')) {
      type = 'address_linking';
      severity = 'high';
    } else if (lowerMessage.includes('round amount')) {
      type = 'round_amount';
      severity = 'medium';
    } else if (lowerMessage.includes('address reuse') || lowerMessage.includes('reused')) {
      type = 'address_reuse';
      severity = 'high';
    } else if (lowerMessage.includes('privacy score') || lowerMessage.includes('score')) {
      type = 'privacy_score_disparity';
      severity = 'low';
    } else if (lowerMessage.includes('dust')) {
      type = 'dust_consolidation';
      severity = 'low';
    }

    return { type, severity, message };
  });
}

export const PrivacyWarnings: React.FC<PrivacyWarningsProps> = ({
  warnings,
  onDismiss,
  dismissedWarnings = new Set(),
  className = '',
}) => {
  const activeWarnings = warnings.filter(w => !dismissedWarnings.has(w.type));

  if (activeWarnings.length === 0) return null;

  const getSeverityStyles = (severity: PrivacyWarning['severity']) => {
    switch (severity) {
      case 'high':
        return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50';
      case 'medium':
        return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800/50';
      case 'low':
        return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50';
    }
  };

  const getIconColor = (severity: PrivacyWarning['severity']) => {
    switch (severity) {
      case 'high':
        return 'text-amber-600 dark:text-amber-400';
      case 'medium':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'low':
        return 'text-blue-600 dark:text-blue-400';
    }
  };

  const getTextColor = (severity: PrivacyWarning['severity']) => {
    switch (severity) {
      case 'high':
        return 'text-amber-800 dark:text-amber-200';
      case 'medium':
        return 'text-yellow-800 dark:text-yellow-200';
      case 'low':
        return 'text-blue-800 dark:text-blue-200';
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2 text-xs text-sanctuary-500">
        <Shield className="w-3.5 h-3.5" />
        <span>Privacy Considerations</span>
      </div>
      {activeWarnings.map((warning, index) => (
        <div
          key={`${warning.type}-${index}`}
          className={`p-3 rounded-xl border flex items-start gap-3 ${getSeverityStyles(warning.severity)}`}
        >
          <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${getIconColor(warning.severity)}`} />
          <p className={`text-sm flex-1 ${getTextColor(warning.severity)}`}>
            {warning.message}
          </p>
          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(warning.type)}
              className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 flex-shrink-0"
              title="Dismiss warning"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default PrivacyWarnings;
