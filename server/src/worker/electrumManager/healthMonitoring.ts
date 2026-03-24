/**
 * Health Monitoring
 *
 * Connection health checks, subscription reconciliation, and metrics
 * reporting for the Electrum subscription manager.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { subscribeAddressBatch } from './addressSubscriptions';
import type { BitcoinNetwork, NetworkState } from './types';

const log = createLogger('WORKER:ELECTRUM_HEALTH');

/**
 * Check health of all connections and reconnect if needed.
 */
export async function checkHealth(
  networks: Map<BitcoinNetwork, NetworkState>,
  scheduleReconnect: (network: BitcoinNetwork) => void
): Promise<void> {
  for (const [network, state] of networks) {
    if (!state.connected) {
      log.debug(`Health check: ${network} disconnected`);
      continue;
    }

    // Verify connection is actually working
    try {
      // Simple ping by getting server version
      await state.client.getServerVersion();
      log.debug(`Health check: ${network} OK`);
    } catch (error) {
      log.warn(`Health check: ${network} failed`, { error: getErrorMessage(error) });
      state.connected = false;
      scheduleReconnect(network);
    }
  }
}

/**
 * Reconcile subscription state with database.
 *
 * Removes addresses that no longer exist in the database and
 * subscribes to any new addresses. This prevents unbounded memory
 * growth from deleted wallets/addresses.
 *
 * Uses cursor-based pagination to handle large deployments without
 * loading all addresses into memory at once.
 */
export async function reconcileSubscriptions(
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }>
): Promise<{ removed: number; added: number }> {
  log.info('Reconciling Electrum subscriptions with database...');

  const PAGE_SIZE = 2000;
  const dbAddressSet = new Set<string>();
  let removed = 0;
  let added = 0;
  let cursor: string | undefined;

  // First pass: Paginate through database addresses
  // - Build a set of all addresses (just strings, lightweight)
  // - Find and subscribe to new addresses in batches
  while (true) {
    const addresses = await prisma.address.findMany({
      select: {
        id: true,
        address: true,
        walletId: true,
        wallet: { select: { network: true } },
      },
      take: PAGE_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'asc' },
    });

    if (addresses.length === 0) break;

    // Collect new addresses to subscribe per network
    const newAddressesByNetwork = new Map<BitcoinNetwork, Array<{ address: string; walletId: string }>>();

    for (const addr of addresses) {
      // Add to set for removal check later
      dbAddressSet.add(addr.address);

      // Check if this is a new address we need to track
      if (!addressToWallet.has(addr.address)) {
        const network = (addr.wallet.network || 'mainnet') as BitcoinNetwork;

        if (!newAddressesByNetwork.has(network)) {
          newAddressesByNetwork.set(network, []);
        }
        newAddressesByNetwork.get(network)!.push({
          address: addr.address,
          walletId: addr.walletId,
        });

        // Track the new address
        addressToWallet.set(addr.address, {
          walletId: addr.walletId,
          network,
        });
        added++;
      }
    }

    // Subscribe to new addresses in this batch
    for (const [network, networkAddresses] of newAddressesByNetwork) {
      const state = networks.get(network);
      if (state?.connected && networkAddresses.length > 0) {
        await subscribeAddressBatch(state, networkAddresses);
      }
    }

    cursor = addresses[addresses.length - 1].id;
    if (addresses.length < PAGE_SIZE) break;
  }

  // Second pass: Remove addresses that no longer exist in database
  for (const [address, info] of addressToWallet) {
    if (!dbAddressSet.has(address)) {
      addressToWallet.delete(address);
      const state = networks.get(info.network);
      if (state) {
        state.subscribedAddresses.delete(address);
      }
      removed++;
    }
  }

  if (removed > 0 || added > 0) {
    log.info('Subscription reconciliation complete', {
      removed,
      added,
      totalSubscribed: addressToWallet.size,
    });
  } else {
    log.debug('Subscription reconciliation complete - no changes');
  }

  return { removed, added };
}

/**
 * Check if any network is connected.
 */
export function isConnected(networks: Map<BitcoinNetwork, NetworkState>): boolean {
  for (const state of networks.values()) {
    if (state.connected) return true;
  }
  return false;
}

/**
 * Get health metrics for monitoring.
 */
export function getHealthMetrics(
  isRunning: boolean,
  networks: Map<BitcoinNetwork, NetworkState>,
  addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }>
): {
  isRunning: boolean;
  networks: Record<string, {
    connected: boolean;
    subscribedToHeaders: boolean;
    subscribedAddresses: number;
    lastBlockHeight: number;
    reconnectAttempts: number;
  }>;
  totalSubscribedAddresses: number;
} {
  const networkMetrics: Record<string, {
    connected: boolean;
    subscribedToHeaders: boolean;
    subscribedAddresses: number;
    lastBlockHeight: number;
    reconnectAttempts: number;
  }> = {};

  for (const [network, state] of networks) {
    networkMetrics[network] = {
      connected: state.connected,
      subscribedToHeaders: state.subscribedToHeaders,
      subscribedAddresses: state.subscribedAddresses.size,
      lastBlockHeight: state.lastBlockHeight,
      reconnectAttempts: state.reconnectAttempts,
    };
  }

  return {
    isRunning,
    networks: networkMetrics,
    totalSubscribedAddresses: addressToWallet.size,
  };
}
