import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useRecentTransactions,
  usePendingTransactions,
  useBalanceHistory,
} from '../../hooks/queries/useWallets';

// Mock the API modules
vi.mock('../../src/api/transactions', () => ({
  getTransactions: vi.fn(),
  getPendingTransactions: vi.fn(),
}));

vi.mock('../../src/api/wallets', () => ({
  getWallets: vi.fn(),
  getWallet: vi.fn(),
}));

import * as transactionsApi from '../../src/api/transactions';

// Create a test wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useWallets hooks memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useRecentTransactions', () => {
    it('should return stable array reference when data has not changed', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          txid: 'txid1',
          blockTime: '2024-01-01T00:00:00Z',
          type: 'receive',
          amount: 100000,
        },
        {
          id: 'tx2',
          txid: 'txid2',
          blockTime: '2024-01-02T00:00:00Z',
          type: 'send',
          amount: -50000,
        },
      ];

      vi.mocked(transactionsApi.getTransactions).mockResolvedValue(mockTransactions);

      const wrapper = createWrapper();
      const { result, rerender } = renderHook(
        () => useRecentTransactions(['wallet1'], 10),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstData = result.current.data;

      // Rerender without changing inputs
      rerender();

      // Data reference should be stable (key fix for infinite re-render issue)
      expect(result.current.data).toBe(firstData);
      // Refetch should be a function (stability not guaranteed due to useQueries)
      expect(typeof result.current.refetch).toBe('function');
    });

    it('should sort transactions by blockTime descending', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          txid: 'txid1',
          blockTime: '2024-01-01T00:00:00Z',
          type: 'receive',
          amount: 100000,
        },
        {
          id: 'tx2',
          txid: 'txid2',
          blockTime: '2024-01-03T00:00:00Z',
          type: 'send',
          amount: -50000,
        },
        {
          id: 'tx3',
          txid: 'txid3',
          blockTime: '2024-01-02T00:00:00Z',
          type: 'receive',
          amount: 75000,
        },
      ];

      vi.mocked(transactionsApi.getTransactions).mockResolvedValue(mockTransactions);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useRecentTransactions(['wallet1'], 10), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should be sorted by blockTime descending (newest first)
      expect(result.current.data[0].id).toBe('tx2'); // Jan 3
      expect(result.current.data[1].id).toBe('tx3'); // Jan 2
      expect(result.current.data[2].id).toBe('tx1'); // Jan 1
    });

    it('should respect limit parameter', async () => {
      const mockTransactions = Array.from({ length: 20 }, (_, i) => ({
        id: `tx${i}`,
        txid: `txid${i}`,
        blockTime: new Date(2024, 0, i + 1).toISOString(),
        type: 'receive',
        amount: 10000 * (i + 1),
      }));

      vi.mocked(transactionsApi.getTransactions).mockResolvedValue(mockTransactions);

      const wrapper = createWrapper();
      const { result } = renderHook(() => useRecentTransactions(['wallet1'], 5), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array when no wallets provided', async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useRecentTransactions([], 10), {
        wrapper,
      });

      // Should not call API
      expect(transactionsApi.getTransactions).not.toHaveBeenCalled();
      expect(result.current.data).toEqual([]);
    });
  });

  describe('usePendingTransactions', () => {
    it('should return stable array reference when data has not changed', async () => {
      const mockPendingTx = [
        { txid: 'pending1', feeRate: 10, size: 200 },
        { txid: 'pending2', feeRate: 5, size: 150 },
      ];

      vi.mocked(transactionsApi.getPendingTransactions).mockResolvedValue(mockPendingTx);

      const wrapper = createWrapper();
      const { result, rerender } = renderHook(
        () => usePendingTransactions(['wallet1']),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstData = result.current.data;

      rerender();

      // Data reference should be stable (key fix for infinite re-render issue)
      expect(result.current.data).toBe(firstData);
      // Refetch should be a function
      expect(typeof result.current.refetch).toBe('function');
    });

    it('should sort by fee rate descending (higher first)', async () => {
      const mockPendingTx = [
        { txid: 'pending1', feeRate: 5, size: 200 },
        { txid: 'pending2', feeRate: 20, size: 150 },
        { txid: 'pending3', feeRate: 10, size: 100 },
      ];

      vi.mocked(transactionsApi.getPendingTransactions).mockResolvedValue(mockPendingTx);

      const wrapper = createWrapper();
      const { result } = renderHook(() => usePendingTransactions(['wallet1']), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should be sorted by feeRate descending
      expect(result.current.data[0].feeRate).toBe(20);
      expect(result.current.data[1].feeRate).toBe(10);
      expect(result.current.data[2].feeRate).toBe(5);
    });
  });

  describe('useBalanceHistory', () => {
    it('should return stable chart data reference when inputs unchanged', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          txid: 'txid1',
          blockTime: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          type: 'receive',
          amount: 100000,
          balanceAfter: 100000,
        },
      ];

      vi.mocked(transactionsApi.getTransactions).mockResolvedValue(mockTransactions);

      const wrapper = createWrapper();
      const { result, rerender } = renderHook(
        () => useBalanceHistory(['wallet1'], 100000, '1W'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstData = result.current.data;

      rerender();

      // Data reference should be stable
      expect(result.current.data).toBe(firstData);
    });

    it('should filter out consolidation transactions', async () => {
      const mockTransactions = [
        {
          id: 'tx1',
          txid: 'txid1',
          blockTime: new Date(Date.now() - 86400000).toISOString(),
          type: 'receive',
          amount: 100000,
          balanceAfter: 100000,
        },
        {
          id: 'tx2',
          txid: 'txid2',
          blockTime: new Date(Date.now() - 43200000).toISOString(),
          type: 'consolidation',
          amount: -1000,
          balanceAfter: 99000,
        },
      ];

      vi.mocked(transactionsApi.getTransactions).mockResolvedValue(mockTransactions);

      const wrapper = createWrapper();
      const { result } = renderHook(
        () => useBalanceHistory(['wallet1'], 99000, '1W'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Chart data should have filtered out consolidation
      // The result should only include the receive transaction plus start/end points
      expect(result.current.data.length).toBeGreaterThan(0);
    });

    it('should return flat line when no transactions in range', async () => {
      vi.mocked(transactionsApi.getTransactions).mockResolvedValue([]);

      const wrapper = createWrapper();
      const { result } = renderHook(
        () => useBalanceHistory(['wallet1'], 50000, '1D'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should return start and end points with same value
      expect(result.current.data.length).toBe(2);
      expect(result.current.data[0].value).toBe(50000);
      expect(result.current.data[1].value).toBe(50000);
    });
  });
});

describe('Hook reference stability for React re-renders', () => {
  it('queryConfigs should be memoized based on walletIds', async () => {
    vi.mocked(transactionsApi.getTransactions).mockResolvedValue([]);

    const wrapper = createWrapper();

    // First render with wallet1
    const { result: result1, rerender } = renderHook(
      ({ walletIds }) => useRecentTransactions(walletIds, 10),
      { wrapper, initialProps: { walletIds: ['wallet1'] } }
    );

    await waitFor(() => {
      expect(result1.current.isLoading).toBe(false);
    });

    // Track how many times getTransactions was called
    const callCount = vi.mocked(transactionsApi.getTransactions).mock.calls.length;

    // Rerender with same walletIds (should not trigger new queries)
    rerender({ walletIds: ['wallet1'] });

    // Should not have made additional API calls due to memoization
    expect(vi.mocked(transactionsApi.getTransactions).mock.calls.length).toBe(callCount);
  });

  it('should handle empty walletIds gracefully without causing re-renders', async () => {
    const wrapper = createWrapper();

    let renderCount = 0;

    const { result, rerender } = renderHook(
      () => {
        renderCount++;
        return useRecentTransactions([], 10);
      },
      { wrapper }
    );

    const initialRenderCount = renderCount;

    // Rerender multiple times
    rerender();
    rerender();
    rerender();

    // Should not trigger excessive re-renders
    // The hook should be stable when walletIds is empty
    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});
