import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
import * as bitcoinApi from '../../src/api/bitcoin';

// Query key factory for bitcoin-related queries
export const bitcoinKeys = {
  all: ['bitcoin'] as const,
  status: () => [...bitcoinKeys.all, 'status'] as const,
  fees: () => [...bitcoinKeys.all, 'fees'] as const,
  addressInfo: (address: string) => [...bitcoinKeys.all, 'address', address] as const,
  transaction: (txid: string) => [...bitcoinKeys.all, 'transaction', txid] as const,
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
 * Hook to fetch address info from blockchain
 */
export function useAddressInfo(address: string | undefined, network?: string) {
  return useQuery({
    queryKey: bitcoinKeys.addressInfo(address!),
    queryFn: () => bitcoinApi.getAddressInfo(address!, network),
    enabled: !!address,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to fetch transaction details from blockchain
 */
export function useTransactionDetails(txid: string | undefined) {
  return useQuery({
    queryKey: bitcoinKeys.transaction(txid!),
    queryFn: () => bitcoinApi.getTransactionDetails(txid!),
    enabled: !!txid,
    // Transaction details rarely change once confirmed
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook to validate a Bitcoin address
 */
export function useValidateAddress() {
  return useMutation({
    mutationFn: bitcoinApi.validateAddress,
  });
}

/**
 * Hook to broadcast a transaction
 */
export function useBroadcastTransaction() {
  return useMutation({
    mutationFn: bitcoinApi.broadcastTransaction,
  });
}

/**
 * Hook to fetch mempool and block data for visualization
 */
export function useMempoolData() {
  return useQuery({
    queryKey: [...bitcoinKeys.all, 'mempool'] as const,
    queryFn: bitcoinApi.getMempoolData,
    // Mempool changes frequently, refetch every 30 seconds
    refetchInterval: 30_000,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}
