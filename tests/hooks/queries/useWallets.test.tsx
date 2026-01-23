/**
 * useWallets Hook Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useWallets,
  useWallet,
  useCreateWallet,
  useDeleteWallet,
  useSyncWallet,
  useGenerateAddresses,
  walletKeys,
} from '../../../hooks/queries/useWallets';

vi.mock('../../../src/api/wallets', () => ({
  getWallets: vi.fn(),
  getWallet: vi.fn(),
  createWallet: vi.fn(),
  deleteWallet: vi.fn(),
  importWallet: vi.fn(),
}));

vi.mock('../../../src/api/transactions', () => ({
  getUTXOs: vi.fn(),
  getAddresses: vi.fn(),
  generateAddresses: vi.fn(),
  getTransactions: vi.fn(),
  getPendingTransactions: vi.fn(),
}));

vi.mock('../../../src/api/bitcoin', () => ({
  syncWallet: vi.fn(),
}));

import * as walletsApi from '../../../src/api/wallets';
import * as transactionsApi from '../../../src/api/transactions';
import * as bitcoinApi from '../../../src/api/bitcoin';

const mockGetWallets = vi.mocked(walletsApi.getWallets);
const mockGetWallet = vi.mocked(walletsApi.getWallet);
const mockCreateWallet = vi.mocked(walletsApi.createWallet);
const mockDeleteWallet = vi.mocked(walletsApi.deleteWallet);
const mockSyncWallet = vi.mocked(bitcoinApi.syncWallet);
const mockGenerateAddresses = vi.mocked(transactionsApi.generateAddresses);

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('walletKeys', () => {
  it('builds stable keys', () => {
    expect(walletKeys.all).toEqual(['wallets']);
    expect(walletKeys.lists()).toEqual(['wallets', 'list']);
    expect(walletKeys.detail('w1')).toEqual(['wallets', 'detail', 'w1']);
    expect(walletKeys.transactions('w1', { page: 1, limit: 10, offset: 0 })).toEqual([
      'wallets',
      'transactions',
      'w1',
      1,
      10,
      0,
    ]);
  });
});

describe('Wallet Query Hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  it('fetches wallets', async () => {
    mockGetWallets.mockResolvedValue([{ id: 'w1', name: 'Wallet 1', balance: 0 } as any]);

    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useWallets(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.id).toBe('w1');
  });

  it('fetches wallet detail when id is provided', async () => {
    mockGetWallet.mockResolvedValue({ id: 'w2', name: 'Wallet 2', balance: 0 } as any);

    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useWallet('w2'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetWallet).toHaveBeenCalledWith('w2');
  });

  it('creates wallet and invalidates list', async () => {
    mockCreateWallet.mockResolvedValue({ id: 'w3', name: 'Wallet 3', balance: 0 } as any);

    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useCreateWallet(), { wrapper });

    await result.current.mutateAsync({ name: 'Wallet 3', type: 'single_sig', scriptType: 'native_segwit' } as any);
    expect(mockCreateWallet).toHaveBeenCalled();
  });

  it('deletes wallet and removes detail cache', async () => {
    mockDeleteWallet.mockResolvedValue({} as any);

    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useDeleteWallet(), { wrapper });

    await result.current.mutateAsync('w4');
    expect(mockDeleteWallet).toHaveBeenCalledWith('w4');
  });

  it('syncs wallet and invalidates related queries', async () => {
    mockSyncWallet.mockResolvedValue({} as any);

    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useSyncWallet(), { wrapper });

    await result.current.mutateAsync('w5');
    expect(mockSyncWallet).toHaveBeenCalledWith('w5');
  });

  it('generates addresses and invalidates address list', async () => {
    mockGenerateAddresses.mockResolvedValue({} as any);

    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useGenerateAddresses(), { wrapper });

    await result.current.mutateAsync({ walletId: 'w6', count: 3 });
    expect(mockGenerateAddresses).toHaveBeenCalledWith('w6', 3);
  });
});
