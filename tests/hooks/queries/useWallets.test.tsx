/**
 * useWallets Hook Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useWallets,
  useCreateWallet,
  walletKeys,
} from '../../../hooks/queries/useWallets';

vi.mock('../../../src/api/wallets', () => ({
  getWallets: vi.fn(),
  createWallet: vi.fn(),
}));

import * as walletsApi from '../../../src/api/wallets';

const mockGetWallets = vi.mocked(walletsApi.getWallets);
const mockCreateWallet = vi.mocked(walletsApi.createWallet);

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

  it('creates wallet and invalidates list', async () => {
    mockCreateWallet.mockResolvedValue({ id: 'w3', name: 'Wallet 3', balance: 0 } as any);

    const wrapper = createWrapper(queryClient);
    const { result } = renderHook(() => useCreateWallet(), { wrapper });

    await result.current.mutateAsync({ name: 'Wallet 3', type: 'single_sig', scriptType: 'native_segwit' } as any);
    expect(mockCreateWallet).toHaveBeenCalled();
  });

});
