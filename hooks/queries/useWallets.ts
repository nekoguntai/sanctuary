import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as walletsApi from '../../src/api/wallets';
import * as transactionsApi from '../../src/api/transactions';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as devicesApi from '../../src/api/devices';

// Stable empty arrays to prevent re-renders when data is loading
const EMPTY_TRANSACTIONS: Awaited<ReturnType<typeof transactionsApi.getTransactions>> = [];
const EMPTY_PENDING: Awaited<ReturnType<typeof transactionsApi.getPendingTransactions>> = [];

// Query key factory for wallet-related queries
// Note: Params are spread into the key array to ensure stable references
export const walletKeys = {
  all: ['wallets'] as const,
  lists: () => [...walletKeys.all, 'list'] as const,
  detail: (id: string) => [...walletKeys.all, 'detail', id] as const,
  utxos: (id: string) => [...walletKeys.all, 'utxos', id] as const,
  addresses: (id: string) => [...walletKeys.all, 'addresses', id] as const,
  transactions: (id: string, params?: { page?: number; limit?: number; offset?: number }) =>
    [...walletKeys.all, 'transactions', id, params?.page, params?.limit, params?.offset] as const,
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
 * Hook to import a wallet
 */
export function useImportWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: walletsApi.importWallet,
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
 * Returns a stable function reference to prevent re-renders
 */
export function useInvalidateWallet() {
  const queryClient = useQueryClient();

  return useCallback((walletId: string) => {
    queryClient.invalidateQueries({ queryKey: walletKeys.detail(walletId) });
    queryClient.invalidateQueries({ queryKey: walletKeys.utxos(walletId) });
    queryClient.invalidateQueries({ queryKey: walletKeys.transactions(walletId) });
    queryClient.invalidateQueries({ queryKey: walletKeys.addresses(walletId) });
    queryClient.invalidateQueries({ queryKey: walletKeys.balance(walletId) });
  }, [queryClient]);
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
 *
 * Uses single useQuery with Promise.all to avoid render loop from useQueries
 */
export function useRecentTransactions(walletIds: string[], limit: number = 10) {
  // Create stable key from wallet IDs
  const walletIdsKey = walletIds.join(',');

  const query = useQuery({
    queryKey: ['recentTransactions', walletIdsKey, limit],
    queryFn: async () => {
      if (walletIds.length === 0) return [];
      // Fetch all wallets in parallel, single state update when all complete
      const results = await Promise.all(
        walletIds.map((walletId) => transactionsApi.getTransactions(walletId, { limit: 5 }))
      );
      // Aggregate and sort
      return results
        .flat()
        .sort((a, b) => {
          const timeA = a.blockTime ? new Date(a.blockTime).getTime() : Date.now();
          const timeB = b.blockTime ? new Date(b.blockTime).getTime() : Date.now();
          return timeB - timeA;
        })
        .slice(0, limit);
    },
    enabled: walletIds.length > 0,
  });

  return {
    data: query.data ?? EMPTY_TRANSACTIONS,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Hook to fetch pending (unconfirmed) transactions across all wallets
 * Used for block queue visualization showing user's transactions in mempool
 * Refreshes every 30 seconds to match mempool data updates
 *
 * Uses single useQuery with Promise.all to avoid render loop from useQueries
 */
export function usePendingTransactions(walletIds: string[]) {
  // Create stable key from wallet IDs
  const walletIdsKey = walletIds.join(',');

  const query = useQuery({
    queryKey: ['pendingTransactions', walletIdsKey],
    queryFn: async () => {
      if (walletIds.length === 0) return [];
      // Fetch all wallets in parallel, single state update when all complete
      const results = await Promise.all(
        walletIds.map((walletId) => transactionsApi.getPendingTransactions(walletId))
      );
      // Aggregate and sort by fee rate (higher first)
      return results.flat().sort((a, b) => b.feeRate - a.feeRate);
    },
    enabled: walletIds.length > 0,
    refetchInterval: 30000, // 30 seconds
    staleTime: 15000, // Consider data stale after 15 seconds
  });

  return {
    data: query.data ?? EMPTY_PENDING,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Helper to invalidate all wallets data
 * Returns a stable function reference to prevent re-renders
 */
export function useInvalidateAllWallets() {
  const queryClient = useQueryClient();

  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: walletKeys.all });
  }, [queryClient]);
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

type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';

// Helper to get timeframe start date
function getTimeframeStartDate(timeframe: Timeframe): Date {
  const now = new Date();
  switch (timeframe) {
    case '1D':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case '1W':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '1M':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '1Y':
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    case 'ALL':
    default:
      return new Date(0); // Beginning of time
  }
}

/**
 * Hook to fetch all transactions from all wallets for balance history chart
 * Matches the Dashboard chart behavior with timeframe filtering
 *
 * Uses single useQuery with Promise.all to avoid render loop from useQueries
 */
export function useBalanceHistory(
  walletIds: string[],
  totalBalance: number,
  timeframe: Timeframe
) {
  // Create stable key from wallet IDs
  const walletIdsKey = walletIds.join(',');

  const query = useQuery({
    queryKey: ['balanceHistory', walletIdsKey, timeframe],
    queryFn: async () => {
      if (walletIds.length === 0) return [];

      // Fetch all transactions from all wallets
      const results = await Promise.all(
        walletIds.map((walletId) => transactionsApi.getTransactions(walletId, { limit: 1000 }))
      );

      // Aggregate all transactions
      const allTransactions = results.flat();

      // Get timeframe start date
      const startDate = getTimeframeStartDate(timeframe);

      // Filter transactions within timeframe (exclude consolidations for chart)
      const filteredTransactions = allTransactions
        .filter((tx) => {
          if (!tx.blockTime) return false;
          const txDate = new Date(tx.blockTime);
          return txDate >= startDate;
        })
        .sort((a, b) => {
          const timeA = a.blockTime ? new Date(a.blockTime).getTime() : 0;
          const timeB = b.blockTime ? new Date(b.blockTime).getTime() : 0;
          return timeA - timeB; // Oldest first for building history
        });

      // Build chart data points
      if (filteredTransactions.length === 0) {
        // No transactions in range - return flat line
        return [
          { name: 'Start', value: totalBalance },
          { name: 'Now', value: totalBalance },
        ];
      }

      // Calculate running balance backwards from current total
      let runningBalance = totalBalance;
      const chartData: { name: string; value: number }[] = [];

      // Start with current balance
      chartData.push({ name: 'Now', value: totalBalance });

      // Work backwards through transactions to reconstruct history
      for (let i = filteredTransactions.length - 1; i >= 0; i--) {
        const tx = filteredTransactions[i];
        // Subtract the transaction amount to get balance before
        runningBalance -= tx.amount;
        const txDate = new Date(tx.blockTime!);
        chartData.unshift({
          name: txDate.toLocaleDateString(),
          value: runningBalance,
        });
      }

      return chartData;
    },
    enabled: walletIds.length > 0,
    staleTime: 60000, // Consider stale after 1 minute
  });

  // Memoize default data to prevent re-renders when query.data is undefined
  const defaultData = useMemo(() => [
    { name: 'Start', value: totalBalance },
    { name: 'Now', value: totalBalance },
  ], [totalBalance]);

  return {
    data: query.data ?? defaultData,
    isLoading: query.isLoading,
    isError: query.isError,
  };
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
