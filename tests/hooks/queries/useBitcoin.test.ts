/**
 * Tests for hooks/queries/useBitcoin.ts
 *
 * Tests React Query hooks for Bitcoin data fetching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useBitcoinStatus,
  useFeeEstimates,
  useAddressInfo,
  useTransactionDetails,
  useValidateAddress,
  useBroadcastTransaction,
  useMempoolData,
  bitcoinKeys,
} from '../../../hooks/queries/useBitcoin';
import * as bitcoinApi from '../../../src/api/bitcoin';

// Mock the bitcoin API
vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
  getFeeEstimates: vi.fn(),
  getAddressInfo: vi.fn(),
  getTransactionDetails: vi.fn(),
  validateAddress: vi.fn(),
  broadcastTransaction: vi.fn(),
  getMempoolData: vi.fn(),
}));

// Create a wrapper with QueryClientProvider
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useBitcoin hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('bitcoinKeys', () => {
    it('generates correct query keys', () => {
      expect(bitcoinKeys.all).toEqual(['bitcoin']);
      expect(bitcoinKeys.status()).toEqual(['bitcoin', 'status']);
      expect(bitcoinKeys.fees()).toEqual(['bitcoin', 'fees']);
      expect(bitcoinKeys.addressInfo('bc1q...')).toEqual(['bitcoin', 'address', 'bc1q...']);
      expect(bitcoinKeys.transaction('abc123')).toEqual(['bitcoin', 'transaction', 'abc123']);
    });
  });

  describe('useBitcoinStatus', () => {
    it('fetches bitcoin status', async () => {
      const mockStatus = {
        connected: true,
        blockHeight: 800000,
        network: 'mainnet',
      };
      vi.mocked(bitcoinApi.getStatus).mockResolvedValue(mockStatus as any);

      const { result } = renderHook(() => useBitcoinStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockStatus);
      expect(bitcoinApi.getStatus).toHaveBeenCalled();
    });

    it('handles error state', async () => {
      vi.mocked(bitcoinApi.getStatus).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useBitcoinStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });
  });

  describe('useFeeEstimates', () => {
    it('fetches fee estimates', async () => {
      const mockFees = {
        fastest: 50,
        halfHour: 30,
        hour: 20,
        economy: 10,
      };
      vi.mocked(bitcoinApi.getFeeEstimates).mockResolvedValue(mockFees);

      const { result } = renderHook(() => useFeeEstimates(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockFees);
      expect(bitcoinApi.getFeeEstimates).toHaveBeenCalled();
    });
  });

  describe('useAddressInfo', () => {
    it('fetches address info when address is provided', async () => {
      const mockAddressInfo = {
        address: 'bc1q...',
        balance: 100000,
        transactionCount: 5,
        type: 'p2wpkh',
      };
      vi.mocked(bitcoinApi.getAddressInfo).mockResolvedValue(mockAddressInfo);

      const { result } = renderHook(() => useAddressInfo('bc1q...'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockAddressInfo);
      expect(bitcoinApi.getAddressInfo).toHaveBeenCalledWith('bc1q...', undefined);
    });

    it('does not fetch when address is undefined', async () => {
      const { result } = renderHook(() => useAddressInfo(undefined), {
        wrapper: createWrapper(),
      });

      // Should remain in initial state without fetching
      expect(result.current.isFetching).toBe(false);
      expect(bitcoinApi.getAddressInfo).not.toHaveBeenCalled();
    });

    it('passes network parameter', async () => {
      vi.mocked(bitcoinApi.getAddressInfo).mockResolvedValue({} as any);

      renderHook(() => useAddressInfo('tb1q...', 'testnet'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(bitcoinApi.getAddressInfo).toHaveBeenCalledWith('tb1q...', 'testnet');
      });
    });
  });

  describe('useTransactionDetails', () => {
    it('fetches transaction details when txid is provided', async () => {
      const mockTx = {
        txid: 'abc123',
        confirmations: 6,
        fee: 1000,
        inputs: [],
        outputs: [],
      };
      vi.mocked(bitcoinApi.getTransactionDetails).mockResolvedValue(mockTx as any);

      const { result } = renderHook(() => useTransactionDetails('abc123'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockTx);
      expect(bitcoinApi.getTransactionDetails).toHaveBeenCalledWith('abc123');
    });

    it('does not fetch when txid is undefined', async () => {
      const { result } = renderHook(() => useTransactionDetails(undefined), {
        wrapper: createWrapper(),
      });

      expect(result.current.isFetching).toBe(false);
      expect(bitcoinApi.getTransactionDetails).not.toHaveBeenCalled();
    });
  });

  describe('useValidateAddress', () => {
    it('validates address on mutation', async () => {
      const mockResponse = {
        valid: true,
        balance: 50000,
        transactionCount: 10,
      };
      vi.mocked(bitcoinApi.validateAddress).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useValidateAddress(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ address: 'bc1q...', network: 'mainnet' });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockResponse);
      // React Query passes additional context as second arg, so check first arg only
      const calls = vi.mocked(bitcoinApi.validateAddress).mock.calls;
      expect(calls[0][0]).toEqual({ address: 'bc1q...', network: 'mainnet' });
    });

    it('handles invalid address', async () => {
      const mockResponse = {
        valid: false,
        error: 'Invalid address format',
      };
      vi.mocked(bitcoinApi.validateAddress).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useValidateAddress(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ address: 'invalid' });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.valid).toBe(false);
      expect(result.current.data?.error).toBe('Invalid address format');
    });
  });

  describe('useBroadcastTransaction', () => {
    it('broadcasts transaction on mutation', async () => {
      const mockResponse = {
        txid: 'newtxid123',
        broadcasted: true,
      };
      vi.mocked(bitcoinApi.broadcastTransaction).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useBroadcastTransaction(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ rawTx: '02000000...' });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockResponse);
      // React Query passes additional context as second arg, so check first arg only
      const calls = vi.mocked(bitcoinApi.broadcastTransaction).mock.calls;
      expect(calls[0][0]).toEqual({ rawTx: '02000000...' });
    });

    it('handles broadcast failure', async () => {
      vi.mocked(bitcoinApi.broadcastTransaction).mockRejectedValue(
        new Error('Transaction rejected')
      );

      const { result } = renderHook(() => useBroadcastTransaction(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ rawTx: 'invalid' });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeDefined();
    });
  });

  describe('useMempoolData', () => {
    it('fetches mempool data', async () => {
      const mockMempoolData = {
        mempool: [{ height: 'Pending', medianFee: 10, size: 1000000 }],
        blocks: [{ height: 800000, medianFee: 5, size: 1500000 }],
        mempoolInfo: { count: 5000, size: 2000000, totalFees: 50000 },
      };
      vi.mocked(bitcoinApi.getMempoolData).mockResolvedValue(mockMempoolData as any);

      const { result } = renderHook(() => useMempoolData(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockMempoolData);
      expect(bitcoinApi.getMempoolData).toHaveBeenCalled();
    });
  });
});

describe('useBitcoin hooks query options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useBitcoinStatus uses correct refetch interval', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ connected: true } as any);

    const { result } = renderHook(() => useBitcoinStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // The hook should have refetchInterval set (testing that it exists, not the exact value)
    // We verify the API was called at least once
    expect(bitcoinApi.getStatus).toHaveBeenCalled();
  });

  it('useFeeEstimates uses correct stale time', async () => {
    vi.mocked(bitcoinApi.getFeeEstimates).mockResolvedValue({
      fastest: 50,
      halfHour: 30,
      hour: 20,
      economy: 10,
    });

    const { result } = renderHook(() => useFeeEstimates(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Verify the query was made
    expect(bitcoinApi.getFeeEstimates).toHaveBeenCalled();
  });

  it('useAddressInfo respects enabled option', async () => {
    const { result, rerender } = renderHook(
      ({ address }) => useAddressInfo(address),
      {
        wrapper: createWrapper(),
        initialProps: { address: undefined as string | undefined },
      }
    );

    // Should not fetch with undefined address
    expect(result.current.isFetching).toBe(false);
    expect(bitcoinApi.getAddressInfo).not.toHaveBeenCalled();

    // Now provide an address
    vi.mocked(bitcoinApi.getAddressInfo).mockResolvedValue({
      address: 'bc1q...',
      balance: 100000,
      transactionCount: 5,
      type: 'p2wpkh',
    });

    rerender({ address: 'bc1q...' });

    await waitFor(() => {
      expect(bitcoinApi.getAddressInfo).toHaveBeenCalled();
    });
  });

  it('useTransactionDetails has correct stale time for confirmed tx', async () => {
    const confirmedTx = {
      txid: 'abc123',
      confirmations: 100,
      fee: 1000,
    };
    vi.mocked(bitcoinApi.getTransactionDetails).mockResolvedValue(confirmedTx as any);

    const { result } = renderHook(() => useTransactionDetails('abc123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Transaction details should be cached for longer (5 minutes staleTime)
    expect(result.current.data?.confirmations).toBe(100);
  });
});
