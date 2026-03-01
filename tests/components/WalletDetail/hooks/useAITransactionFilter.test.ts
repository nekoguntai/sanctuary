import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAITransactionFilter } from '../../../../components/WalletDetail/hooks/useAITransactionFilter';

const transactions = [
  {
    id: 'tx-1',
    txid: 'txid-1',
    type: 'received',
    amount: 50_000,
    confirmations: 1,
    timestamp: 1_700_000_000,
    labels: [{ name: 'salary' }],
  },
  {
    id: 'tx-2',
    txid: 'txid-2',
    type: 'sent',
    amount: -12_000,
    confirmations: 0,
    timestamp: 1_700_000_100,
    labels: [{ name: 'groceries' }],
  },
  {
    id: 'tx-3',
    txid: 'txid-3',
    type: 'consolidation',
    amount: -90_000,
    confirmations: 6,
    timestamp: 1_700_000_200,
    labels: [{ name: 'savings' }],
  },
];

describe('useAITransactionFilter', () => {
  it('returns original transactions when no active transaction filter exists', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));
    expect(result.current.filteredTransactions).toHaveLength(3);
    expect(result.current.aiAggregationResult).toBeNull();
  });

  it('filters by type/label/amount/confirmations', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        filter: {
          type: 'receive',
          label: 'sal',
          amount: { '>=': 10_000, '<=': 60_000 },
          confirmations: 1,
        },
      });
    });

    expect(result.current.filteredTransactions).toHaveLength(1);
    expect(result.current.filteredTransactions[0].txid).toBe('txid-1');
  });

  it('applies sort and limit', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        sort: { field: 'amount', order: 'desc' },
        limit: 2,
      });
    });

    expect(result.current.filteredTransactions).toHaveLength(2);
    expect(result.current.filteredTransactions.map((tx) => tx.txid)).toEqual(['txid-3', 'txid-1']);
  });

  it('calculates all supported aggregations', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'sum',
      });
    });
    expect(result.current.aiAggregationResult).toBe(152_000);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'count',
      });
    });
    expect(result.current.aiAggregationResult).toBe(3);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'max',
      });
    });
    expect(result.current.aiAggregationResult).toBe(90_000);

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'min',
      });
    });
    expect(result.current.aiAggregationResult).toBe(12_000);
  });

  it('returns null aggregation for unsupported aggregation values', () => {
    const { result } = renderHook(() => useAITransactionFilter({ transactions: transactions as any }));

    act(() => {
      result.current.setAiQueryFilter({
        type: 'transactions',
        aggregation: 'unknown' as any,
      });
    });

    expect(result.current.aiAggregationResult).toBeNull();
  });
});
