/**
 * useAITransactionFilter Hook
 *
 * Manages AI-driven transaction filtering, sorting, limiting, and aggregation.
 * Extracted from WalletDetail.tsx to isolate AI query filter concerns.
 */

import { useState, useMemo } from 'react';
import type { Transaction } from '../../../types';
import type { NaturalQueryResult } from '../../../src/api/ai';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseAITransactionFilterParams {
  /** Full (unfiltered) transaction list for this wallet */
  transactions: Transaction[];
}

export interface UseAITransactionFilterReturn {
  /** Current AI query filter (null = no filter active) */
  aiQueryFilter: NaturalQueryResult | null;
  /** Set or clear the AI query filter */
  setAiQueryFilter: (filter: NaturalQueryResult | null) => void;
  /** Transactions after applying the AI filter/sort/limit */
  filteredTransactions: Transaction[];
  /** Computed aggregation value (sum, count, max, min) or null */
  aiAggregationResult: number | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAITransactionFilter({
  transactions,
}: UseAITransactionFilterParams): UseAITransactionFilterReturn {
  const [aiQueryFilter, setAiQueryFilter] = useState<NaturalQueryResult | null>(null);

  // Apply AI query filter to transactions
  const filteredTransactions = useMemo(() => {
    if (!aiQueryFilter || aiQueryFilter.type !== 'transactions') {
      return transactions;
    }

    let result = [...transactions];

    // Apply filters
    if (aiQueryFilter.filter) {
      const filter = aiQueryFilter.filter;
      result = result.filter(tx => {
        // Type filter (receive/send)
        if (filter.type) {
          const txType = tx.type === 'received' ? 'receive' : tx.type === 'sent' ? 'send' : tx.type;
          if (txType !== filter.type) return false;
        }
        // Label filter
        if (filter.label) {
          const hasLabel = tx.labels?.some(l => l.name.toLowerCase().includes(filter.label.toLowerCase()));
          if (!hasLabel) return false;
        }
        // Amount filter
        if (filter.amount) {
          const absAmount = Math.abs(tx.amount);
          if (typeof filter.amount === 'object') {
            if (filter.amount['>'] && absAmount <= filter.amount['>']) return false;
            if (filter.amount['<'] && absAmount >= filter.amount['<']) return false;
            if (filter.amount['>='] && absAmount < filter.amount['>=']) return false;
            if (filter.amount['<='] && absAmount > filter.amount['<=']) return false;
          }
        }
        // Confirmations filter
        if (filter.confirmations !== undefined) {
          if (tx.confirmations !== filter.confirmations) return false;
        }
        return true;
      });
    }

    // Apply sort
    if (aiQueryFilter.sort) {
      const { field, order } = aiQueryFilter.sort;
      result.sort((a, b) => {
        let aVal: number | string = 0;
        let bVal: number | string = 0;
        if (field === 'amount') {
          aVal = Math.abs(a.amount);
          bVal = Math.abs(b.amount);
        } else if (field === 'date' || field === 'timestamp') {
          aVal = a.timestamp || 0;
          bVal = b.timestamp || 0;
        } else if (field === 'confirmations') {
          aVal = a.confirmations || 0;
          bVal = b.confirmations || 0;
        }
        return order === 'desc' ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1);
      });
    }

    // Apply limit
    if (aiQueryFilter.limit && aiQueryFilter.limit > 0) {
      result = result.slice(0, aiQueryFilter.limit);
    }

    return result;
  }, [transactions, aiQueryFilter]);

  // Compute aggregation result if requested
  const aiAggregationResult = useMemo(() => {
    if (!aiQueryFilter?.aggregation || filteredTransactions.length === 0) return null;

    const amounts = filteredTransactions.map(tx => Math.abs(tx.amount));
    switch (aiQueryFilter.aggregation) {
      case 'sum':
        return amounts.reduce((a, b) => a + b, 0);
      case 'count':
        return filteredTransactions.length;
      case 'max':
        return Math.max(...amounts);
      case 'min':
        return Math.min(...amounts);
      default:
        return null;
    }
  }, [filteredTransactions, aiQueryFilter?.aggregation]);

  return {
    aiQueryFilter,
    setAiQueryFilter,
    filteredTransactions,
    aiAggregationResult,
  };
}
