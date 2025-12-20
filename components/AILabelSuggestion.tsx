/**
 * AI Label Suggestion Component
 *
 * Provides AI-powered label suggestions for transactions.
 * Can be integrated into transaction detail views or label editors.
 */

import React, { useState } from 'react';
import { Brain, Loader2, AlertCircle } from 'lucide-react';
import * as aiApi from '../src/api/ai';
import { Transaction } from '../types';
import { createLogger } from '../utils/logger';

const log = createLogger('AILabelSuggestion');

interface AILabelSuggestionProps {
  transaction: Transaction;
  existingLabels?: string[];
  onSuggestionAccepted?: (suggestion: string) => void;
  className?: string;
}

export const AILabelSuggestion: React.FC<AILabelSuggestionProps> = ({
  transaction,
  existingLabels = [],
  onSuggestionAccepted,
  className = '',
}) => {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGetSuggestion = async () => {
    setLoading(true);
    setError(null);
    setSuggestion(null);

    try {
      // Determine direction
      const direction = transaction.type === 'received' ? 'receive' : 'send';

      // Get first address (simplified - could be improved to show all addresses)
      const address = transaction.addresses && transaction.addresses.length > 0
        ? transaction.addresses[0]
        : undefined;

      // Request suggestion from AI
      const result = await aiApi.suggestLabel({
        amount: Math.abs(transaction.amount),
        direction,
        address,
        date: transaction.date,
        existingLabels,
      });

      setSuggestion(result.suggestion);
    } catch (err: any) {
      log.error('Failed to get AI label suggestion', { error: err });

      // Check if AI is not enabled/configured
      if (err.message?.includes('503') || err.message?.includes('not enabled')) {
        setError('AI is not enabled or configured. Please configure it in System Settings.');
      } else if (err.message?.includes('429')) {
        setError('Too many requests. Please try again in a moment.');
      } else {
        setError('Failed to get suggestion. AI may be unavailable.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptSuggestion = () => {
    if (suggestion && onSuggestionAccepted) {
      onSuggestionAccepted(suggestion);
      setSuggestion(null);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Suggest Button */}
      {!suggestion && !error && (
        <button
          onClick={handleGetSuggestion}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Getting suggestion...
            </>
          ) : (
            <>
              <Brain className="w-4 h-4" />
              Suggest with AI
            </>
          )}
        </button>
      )}

      {/* Suggestion Display */}
      {suggestion && (
        <div className="p-3 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Brain className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                <span className="text-sm font-medium text-primary-900 dark:text-primary-100">
                  AI Suggestion
                </span>
              </div>
              <p className="text-sm text-primary-700 dark:text-primary-300 font-medium">
                {suggestion}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAcceptSuggestion}
                className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Use This
              </button>
              <button
                onClick={() => setSuggestion(null)}
                className="px-3 py-1.5 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 text-sm font-medium rounded-lg transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-rose-700 dark:text-rose-300">
                {error}
              </p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30 p-1 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AILabelSuggestion;
