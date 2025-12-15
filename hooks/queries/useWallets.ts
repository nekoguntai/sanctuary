import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import * as walletsApi from '../../src/api/wallets';
import * as transactionsApi from '../../src/api/transactions';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as devicesApi from '../../src/api/devices';

// Query key factory for wallet-related queries
export const walletKeys = {
  all: ['wallets'] as const,
  lists: () => [...walletKeys.all, 'list'] as const,
  detail: (id: string) => [...walletKeys.all, 'detail', id] as const,
  utxos: (id: string) => [...walletKeys.all, 'utxos', id] as const,
  addresses: (id: string) => [...walletKeys.all, 'addresses', id] as const,
  transactions: (id: string, params?: { page?: number; limit?: number }) =>
    [...walletKeys.all, 'transactions', id, params] as const,
  balance: (id: string) => [...walletKeys.all, 'balance', id] as const,
};

/**
 * Hook to fetch all wallets for the current user
 */
export function useWallets() {
  return useQuery({
    queryKey: walletKeys.lists(),
    queryFn: walletsApi.getWallets,
  });
}

/**
 * Hook to fetch a single wallet by ID
 */
export function useWallet(id: string | undefined) {
  return useQuery({
    queryKey: walletKeys.detail(id!),
    queryFn: () => walletsApi.getWallet(id!),
    enabled: !!id,
  });
}

/**
 * Hook to fetch UTXOs for a wallet
 */
export function useWalletUtxos(walletId: string | undefined) {
  return useQuery({
    queryKey: walletKeys.utxos(walletId!),
    queryFn: () => transactionsApi.getUTXOs(walletId!),
    enabled: !!walletId,
  });
}

/**
 * Hook to fetch addresses for a wallet
 */
export function useWalletAddresses(walletId: string | undefined) {
  return useQuery({
    queryKey: walletKeys.addresses(walletId!),
    queryFn: () => transactionsApi.getAddresses(walletId!),
    enabled: !!walletId,
  });
}

/**
 * Hook to create a new wallet
 */
export function useCreateWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: walletsApi.createWallet,
    onSuccess: () => {
      // Invalidate wallet list to refetch
      queryClient.invalidateQueries({ queryKey: walletKeys.lists() });
    },
  });
}

/**
 * Hook to delete a wallet
 */
export function useDeleteWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (walletId: string) => walletsApi.deleteWallet(walletId),
    onSuccess: (_data, walletId) => {
      // Invalidate wallet list
      queryClient.invalidateQueries({ queryKey: walletKeys.lists() });
      // Remove the specific wallet from cache
      queryClient.removeQueries({ queryKey: walletKeys.detail(walletId) });
    },
  });
}

/**
 * Hook to sync a wallet
 */
export function useSyncWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (walletId: string) => bitcoinApi.syncWallet(walletId),
    onSuccess: (_data, walletId) => {
      // Invalidate wallet data after sync
      queryClient.invalidateQueries({ queryKey: walletKeys.detail(walletId) });
      queryClient.invalidateQueries({ queryKey: walletKeys.utxos(walletId) });
      queryClient.invalidateQueries({ queryKey: walletKeys.transactions(walletId) });
    },
  });
}

/**
 * Hook to generate new addresses for a wallet
 */
export function useGenerateAddresses() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ walletId, count }: { walletId: string; count: number }) =>
      transactionsApi.generateAddresses(walletId, count),
    onSuccess: (_data, { walletId }) => {
      queryClient.invalidateQueries({ queryKey: walletKeys.addresses(walletId) });
    },
  });
}

/**
 * Helper to invalidate all wallet data (useful after WebSocket updates)
 */
export function useInvalidateWallet() {
  const queryClient = useQueryClient();

  return (walletId: string) => {
    queryClient.invalidateQueries({ queryKey: walletKeys.detail(walletId) });
    queryClient.invalidateQueries({ queryKey: walletKeys.utxos(walletId) });
    queryClient.invalidateQueries({ queryKey: walletKeys.transactions(walletId) });
    queryClient.invalidateQueries({ queryKey: walletKeys.addresses(walletId) });
    queryClient.invalidateQueries({ queryKey: walletKeys.balance(walletId) });
  };
}

/**
 * Hook to fetch transactions for a specific wallet
 */
export function useWalletTransactions(
  walletId: string | undefined,
  params?: { limit?: number; offset?: number }
) {
  return useQuery({
    queryKey: walletKeys.transactions(walletId!, params),
    queryFn: () => transactionsApi.getTransactions(walletId!, params),
    enabled: !!walletId,
  });
}

/**
 * Hook to fetch recent transactions across all wallets
 * Aggregates transactions from multiple wallets and sorts by timestamp
 */
export function useRecentTransactions(walletIds: string[], limit: number = 10) {
  const queries = useQueries({
    queries: walletIds.map((walletId) => ({
      queryKey: walletKeys.transactions(walletId, { limit: 5 }),
      queryFn: () => transactionsApi.getTransactions(walletId, { limit: 5 }),
      enabled: walletIds.length > 0,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);

  // Aggregate and sort all transactions
  const transactions = queries
    .flatMap((q) => q.data || [])
    .sort((a, b) => {
      const timeA = a.blockTime ? new Date(a.blockTime).getTime() : Date.now();
      const timeB = b.blockTime ? new Date(b.blockTime).getTime() : Date.now();
      return timeB - timeA;
    })
    .slice(0, limit);

  return {
    data: transactions,
    isLoading,
    isError,
    refetch: () => queries.forEach((q) => q.refetch()),
  };
}

/**
 * Helper to invalidate all wallets data
 */
export function useInvalidateAllWallets() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: walletKeys.all });
  };
}

/**
 * Hook to fetch devices for a wallet
 * Fetches all devices and filters to those associated with the wallet
 */
export function useWalletDevices(walletId: string | undefined) {
  return useQuery({
    queryKey: [...walletKeys.detail(walletId!), 'devices'] as const,
    queryFn: async () => {
      const allDevices = await devicesApi.getDevices();
      return allDevices.filter((d) => d.wallets?.some((w) => w.wallet.id === walletId));
    },
    enabled: !!walletId,
  });
}

/**
 * Hook to fetch wallet stats
 */
export function useWalletStats(walletId: string | undefined) {
  return useQuery({
    queryKey: [...walletKeys.detail(walletId!), 'stats'] as const,
    queryFn: () => walletsApi.getWalletStats(walletId!),
    enabled: !!walletId,
  });
}

/**
 * Hook to fetch wallet share info
 */
export function useWalletShareInfo(walletId: string | undefined) {
  return useQuery({
    queryKey: [...walletKeys.detail(walletId!), 'share'] as const,
    queryFn: () => walletsApi.getWalletShareInfo(walletId!),
    enabled: !!walletId,
  });
}

/**
 * Hook to update a wallet
 */
export function useUpdateWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ walletId, data }: { walletId: string; data: walletsApi.UpdateWalletRequest }) =>
      walletsApi.updateWallet(walletId, data),
    onSuccess: (_data, { walletId }) => {
      queryClient.invalidateQueries({ queryKey: walletKeys.detail(walletId) });
      queryClient.invalidateQueries({ queryKey: walletKeys.lists() });
    },
  });
}
