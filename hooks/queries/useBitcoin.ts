import { useQuery, keepPreviousData } from '@tanstack/react-query';
import * as bitcoinApi from '../../src/api/bitcoin';
import { createQueryKeys } from './factory';

// Query key factory for bitcoin-related queries
export const bitcoinKeys = {
  ...createQueryKeys('bitcoin'),
  status: () => ['bitcoin', 'status'] as const,
  fees: () => ['bitcoin', 'fees'] as const,
  mempool: () => ['bitcoin', 'mempool'] as const,
};

/**
 * Hook to fetch Bitcoin network status
 */
export function useBitcoinStatus() {
  return useQuery({
    queryKey: bitcoinKeys.status(),
    queryFn: bitcoinApi.getStatus,
    // Refetch status every 60 seconds
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch current fee estimates
 */
export function useFeeEstimates() {
  return useQuery({
    queryKey: bitcoinKeys.fees(),
    queryFn: bitcoinApi.getFeeEstimates,
    // Fees change frequently, refetch every 30 seconds
    refetchInterval: 30_000,
    // Keep stale time short for fees
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch mempool and block data for visualization
 */
export function useMempoolData() {
  return useQuery({
    queryKey: bitcoinKeys.mempool(),
    queryFn: bitcoinApi.getMempoolData,
    // Mempool changes frequently, refetch every 30 seconds
    refetchInterval: 30_000,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}
