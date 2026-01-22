/**
 * Electrum Subscription Manager
 *
 * Maintains persistent Electrum connections with automatic reconnection.
 * Handles real-time block and address subscriptions for near-instant
 * transaction detection.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Subscribe to all wallet addresses for real-time activity detection
 * - Block header subscriptions for confirmation updates
 * - Health monitoring and logging
 */

import prisma from '../models/prisma';
import {
  ElectrumClient,
  getElectrumClientForNetwork,
  closeAllElectrumClients,
} from '../services/bitcoin/electrum';
import { setCachedBlockHeight } from '../services/bitcoin/blockchain';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { acquireLock, extendLock, releaseLock, type DistributedLock } from '../infrastructure';

const log = createLogger('ElectrumMgr');

// =============================================================================
// Types
// =============================================================================

export type BitcoinNetwork = 'mainnet' | 'testnet' | 'signet' | 'regtest';

export interface ElectrumManagerCallbacks {
  /** Called when a new block is received */
  onNewBlock: (network: BitcoinNetwork, height: number, hash: string) => void;
  /** Called when address activity is detected */
  onAddressActivity: (network: BitcoinNetwork, walletId: string, address: string) => void;
}

interface NetworkState {
  network: BitcoinNetwork;
  client: ElectrumClient;
  connected: boolean;
  subscribedToHeaders: boolean;
  subscribedAddresses: Set<string>;
  lastBlockHeight: number;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
}

// =============================================================================
// Configuration
// =============================================================================

const RECONNECT_BASE_DELAY_MS = 5000; // 5 seconds
const RECONNECT_MAX_DELAY_MS = 60000; // 1 minute
const RECONNECT_MAX_ATTEMPTS = 10; // After this, log error but keep trying
const HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds
const SUBSCRIPTION_BATCH_SIZE = 500; // Max addresses per batch subscription
const ELECTRUM_SUBSCRIPTION_LOCK_KEY = 'electrum:subscriptions';
const ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS = 2 * 60 * 1000;
const ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS = 60 * 1000;

// =============================================================================
// Electrum Subscription Manager
// =============================================================================

export class ElectrumSubscriptionManager {
  private networks: Map<BitcoinNetwork, NetworkState> = new Map();
  private addressToWallet: Map<string, { walletId: string; network: BitcoinNetwork }> = new Map();
  private callbacks: ElectrumManagerCallbacks;
  private isRunning = false;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private subscriptionLock: DistributedLock | null = null;
  private subscriptionLockRefresh: NodeJS.Timeout | null = null;

  constructor(callbacks: ElectrumManagerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Start the Electrum subscription manager
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Electrum manager already running');
      return;
    }

    const lock = await acquireLock(ELECTRUM_SUBSCRIPTION_LOCK_KEY, ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS);
    if (!lock) {
      log.warn('Electrum subscriptions already owned by another process, skipping startup');
      return;
    }

    this.subscriptionLock = lock;
    this.startSubscriptionLockRefresh();
    this.isRunning = true;
    log.info('Acquired Electrum subscription ownership');
    log.info('Starting Electrum subscription manager...');

    // Get configured network from config
    const config = getConfig();
    const primaryNetwork = config.bitcoin.network as BitcoinNetwork;

    // Connect to primary network
    await this.connectNetwork(primaryNetwork);

    // Subscribe to all wallet addresses
    await this.subscribeAllAddresses();

    // Start health check timer
    this.healthCheckTimer = setInterval(() => {
      this.checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);

    log.info('Electrum subscription manager started', {
      networks: Array.from(this.networks.keys()),
      subscribedAddresses: this.addressToWallet.size,
    });
  }

  private startSubscriptionLockRefresh(): void {
    if (this.subscriptionLockRefresh) return;

    this.subscriptionLockRefresh = setInterval(async () => {
      if (!this.subscriptionLock) return;

      const refreshed = await extendLock(this.subscriptionLock, ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS);
      if (!refreshed) {
        log.warn('Lost Electrum subscription lock, stopping manager');
        this.subscriptionLock = null;
        this.stopSubscriptionLockRefresh();
        await this.stop();
        return;
      }

      this.subscriptionLock = refreshed;
    }, ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS);

    this.subscriptionLockRefresh.unref?.();
  }

  private stopSubscriptionLockRefresh(): void {
    if (this.subscriptionLockRefresh) {
      clearInterval(this.subscriptionLockRefresh);
      this.subscriptionLockRefresh = null;
    }
  }

  private async releaseSubscriptionLock(): Promise<void> {
    this.stopSubscriptionLockRefresh();
    if (this.subscriptionLock) {
      await releaseLock(this.subscriptionLock);
      this.subscriptionLock = null;
    }
  }

  /**
   * Connect to a specific network
   */
  private async connectNetwork(network: BitcoinNetwork): Promise<void> {
    if (this.networks.has(network)) {
      const state = this.networks.get(network)!;
      if (state.connected) {
        log.debug(`Already connected to ${network}`);
        return;
      }
    }

    try {
      log.info(`Connecting to Electrum for ${network}...`);

      const client = getElectrumClientForNetwork(network);
      await client.connect();

      // Negotiate protocol version
      try {
        const version = await client.getServerVersion();
        log.info(`Connected to Electrum ${network}: ${version.server} (protocol ${version.protocol})`);
      } catch (versionError) {
        log.warn(`Could not get server version for ${network}, continuing`, {
          error: getErrorMessage(versionError),
        });
      }

      // Create network state
      const state: NetworkState = {
        network,
        client,
        connected: true,
        subscribedToHeaders: false,
        subscribedAddresses: new Set(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      this.networks.set(network, state);

      // Subscribe to headers
      await this.subscribeHeaders(state);

      // Set up event handlers
      this.setupEventHandlers(state);

      log.info(`Electrum ${network} connected and subscribed`);
    } catch (error) {
      log.error(`Failed to connect to Electrum ${network}`, {
        error: getErrorMessage(error),
      });
      this.scheduleReconnect(network);
    }
  }

  /**
   * Subscribe to block headers for a network
   */
  private async subscribeHeaders(state: NetworkState): Promise<void> {
    if (state.subscribedToHeaders) return;

    try {
      const header = await state.client.subscribeHeaders();
      state.subscribedToHeaders = true;
      state.lastBlockHeight = header.height;

      // Update cached block height
      setCachedBlockHeight(header.height, state.network);

      log.info(`Subscribed to ${state.network} headers, current height: ${header.height}`);
    } catch (error) {
      log.error(`Failed to subscribe to ${state.network} headers`, {
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Set up event handlers for a network client
   */
  private setupEventHandlers(state: NetworkState): void {
    const { client, network } = state;

    // Handle new blocks
    client.on('newBlock', (block: { height: number; hex: string }) => {
      state.lastBlockHeight = block.height;
      setCachedBlockHeight(block.height, network);

      log.info(`New ${network} block at height ${block.height}`);
      this.callbacks.onNewBlock(network, block.height, block.hex.slice(0, 64));
    });

    // Handle address activity
    client.on('addressActivity', (activity: { scriptHash: string; address?: string; status: string }) => {
      const address = activity.address;
      if (!address) {
        log.warn(`Address activity without resolved address on ${network}`);
        return;
      }

      const walletInfo = this.addressToWallet.get(address);
      if (walletInfo && walletInfo.network === network) {
        log.info(`Address activity on ${network}: ${address} (wallet: ${walletInfo.walletId})`);
        this.callbacks.onAddressActivity(network, walletInfo.walletId, address);
      } else {
        log.debug(`Address activity for untracked address: ${address}`);
      }
    });

    // Handle connection close
    client.on('close', () => {
      log.warn(`Electrum ${network} connection closed`);
      state.connected = false;
      state.subscribedToHeaders = false;
      state.subscribedAddresses.clear();

      if (this.isRunning) {
        this.scheduleReconnect(network);
      }
    });

    // Handle errors
    client.on('error', (error: Error) => {
      log.error(`Electrum ${network} error`, { error: error.message });
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(network: BitcoinNetwork): void {
    const state = this.networks.get(network);

    // Clear any existing timer
    if (state?.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
    }

    // Calculate delay with exponential backoff
    const attempts = state?.reconnectAttempts ?? 0;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, attempts),
      RECONNECT_MAX_DELAY_MS
    );

    if (attempts >= RECONNECT_MAX_ATTEMPTS) {
      log.error(`Electrum ${network} reconnection attempts exceeded ${RECONNECT_MAX_ATTEMPTS}, continuing to try...`);
    }

    log.info(`Scheduling Electrum ${network} reconnection in ${delay}ms (attempt ${attempts + 1})`);

    const timer = setTimeout(async () => {
      if (!this.isRunning) return;

      // Update state
      if (state) {
        state.reconnectTimer = null;
        state.reconnectAttempts++;
      }

      // Attempt reconnection
      await this.connectNetwork(network);

      // Re-subscribe addresses if connected
      const currentState = this.networks.get(network);
      if (currentState?.connected) {
        currentState.reconnectAttempts = 0; // Reset on success
        await this.subscribeNetworkAddresses(network);
      }
    }, delay);

    if (state) {
      state.reconnectTimer = timer;
    } else {
      // Create minimal state for tracking reconnection
      this.networks.set(network, {
        network,
        client: getElectrumClientForNetwork(network),
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set(),
        lastBlockHeight: 0,
        reconnectTimer: timer,
        reconnectAttempts: attempts + 1,
      });
    }
  }

  /**
   * Subscribe to all wallet addresses across all networks
   *
   * Uses cursor-based pagination to handle large numbers of addresses
   * without loading everything into memory at once.
   */
  private async subscribeAllAddresses(): Promise<void> {
    log.info('Subscribing to all wallet addresses...');

    const PAGE_SIZE = 1000;
    let totalProcessed = 0;
    let cursor: string | undefined;

    // Process addresses in pages to avoid memory issues with large deployments
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

      // Group by network for this batch
      const byNetwork = new Map<BitcoinNetwork, Array<{ address: string; walletId: string }>>();

      for (const addr of addresses) {
        const network = (addr.wallet.network || 'mainnet') as BitcoinNetwork;

        if (!byNetwork.has(network)) {
          byNetwork.set(network, []);
        }
        byNetwork.get(network)!.push({
          address: addr.address,
          walletId: addr.walletId,
        });

        // Track address -> wallet mapping
        this.addressToWallet.set(addr.address, {
          walletId: addr.walletId,
          network,
        });
      }

      // Subscribe for each network in this batch
      for (const [network, networkAddresses] of byNetwork) {
        const state = this.networks.get(network);
        if (!state?.connected) {
          log.warn(`Cannot subscribe addresses for ${network} - not connected`);
          continue;
        }

        await this.subscribeAddressBatch(state, networkAddresses);
      }

      totalProcessed += addresses.length;
      cursor = addresses[addresses.length - 1].id;

      // Log progress for large deployments
      if (totalProcessed % 5000 === 0) {
        log.info(`Subscription progress: ${totalProcessed} addresses processed`);
      }

      // If we got less than PAGE_SIZE, we're done
      if (addresses.length < PAGE_SIZE) break;
    }

    log.info(`Subscribed to ${this.addressToWallet.size} addresses`);
  }

  /**
   * Subscribe to addresses for a specific network
   */
  private async subscribeNetworkAddresses(network: BitcoinNetwork): Promise<void> {
    const state = this.networks.get(network);
    if (!state?.connected) return;

    // Get addresses for this network from our tracking
    const networkAddresses: Array<{ address: string; walletId: string }> = [];

    for (const [address, info] of this.addressToWallet) {
      if (info.network === network) {
        networkAddresses.push({ address, walletId: info.walletId });
      }
    }

    if (networkAddresses.length > 0) {
      await this.subscribeAddressBatch(state, networkAddresses);
    }
  }

  /**
   * Subscribe to a batch of addresses
   */
  private async subscribeAddressBatch(
    state: NetworkState,
    addresses: Array<{ address: string; walletId: string }>
  ): Promise<void> {
    const { client, network } = state;

    // Filter out already subscribed addresses
    const toSubscribe = addresses.filter(a => !state.subscribedAddresses.has(a.address));

    if (toSubscribe.length === 0) {
      log.debug(`No new addresses to subscribe for ${network}`);
      return;
    }

    log.info(`Subscribing to ${toSubscribe.length} addresses on ${network}`);

    // Subscribe in batches
    for (let i = 0; i < toSubscribe.length; i += SUBSCRIPTION_BATCH_SIZE) {
      const batch = toSubscribe.slice(i, i + SUBSCRIPTION_BATCH_SIZE);
      const addressList = batch.map(a => a.address);

      try {
        await client.subscribeAddressBatch(addressList);

        for (const addr of batch) {
          state.subscribedAddresses.add(addr.address);
        }

        log.debug(`Subscribed batch ${Math.floor(i / SUBSCRIPTION_BATCH_SIZE) + 1} on ${network}`, {
          count: batch.length,
        });
      } catch (error) {
        log.error(`Failed to subscribe address batch on ${network}`, {
          error: getErrorMessage(error),
          startIndex: i,
        });

        // Try individual subscriptions as fallback
        for (const addr of batch) {
          try {
            await client.subscribeAddress(addr.address);
            state.subscribedAddresses.add(addr.address);
          } catch (individualError) {
            log.warn(`Failed to subscribe individual address on ${network}`, {
              address: addr.address,
              error: getErrorMessage(individualError),
            });
          }
        }
      }
    }
  }

  /**
   * Subscribe to new addresses for a wallet (call when wallet is created or addresses generated)
   */
  async subscribeWalletAddresses(walletId: string): Promise<void> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { network: true },
    });

    if (!wallet) return;

    const network = (wallet.network || 'mainnet') as BitcoinNetwork;
    const state = this.networks.get(network);

    if (!state?.connected) {
      log.warn(`Cannot subscribe wallet addresses - ${network} not connected`);
      return;
    }

    const addresses = await prisma.address.findMany({
      where: { walletId },
      select: { address: true },
    });

    const addressData = addresses.map(a => ({
      address: a.address,
      walletId,
    }));

    // Update tracking
    for (const addr of addressData) {
      this.addressToWallet.set(addr.address, { walletId, network });
    }

    await this.subscribeAddressBatch(state, addressData);
  }

  /**
   * Unsubscribe addresses for a wallet (call when wallet is deleted)
   */
  unsubscribeWalletAddresses(walletId: string): void {
    for (const [address, info] of this.addressToWallet) {
      if (info.walletId === walletId) {
        this.addressToWallet.delete(address);

        const state = this.networks.get(info.network);
        if (state) {
          state.subscribedAddresses.delete(address);
        }
      }
    }
  }

  /**
   * Check health of all connections and reconnect if needed
   */
  private async checkHealth(): Promise<void> {
    for (const [network, state] of this.networks) {
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
        this.scheduleReconnect(network);
      }
    }
  }

  /**
   * Reconcile subscription state with database
   *
   * Removes addresses that no longer exist in the database and
   * subscribes to any new addresses. This prevents unbounded memory
   * growth from deleted wallets/addresses.
   *
   * Uses cursor-based pagination to handle large deployments without
   * loading all addresses into memory at once.
   */
  async reconcileSubscriptions(): Promise<{ removed: number; added: number }> {
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
        if (!this.addressToWallet.has(addr.address)) {
          const network = (addr.wallet.network || 'mainnet') as BitcoinNetwork;

          if (!newAddressesByNetwork.has(network)) {
            newAddressesByNetwork.set(network, []);
          }
          newAddressesByNetwork.get(network)!.push({
            address: addr.address,
            walletId: addr.walletId,
          });

          // Track the new address
          this.addressToWallet.set(addr.address, {
            walletId: addr.walletId,
            network,
          });
          added++;
        }
      }

      // Subscribe to new addresses in this batch
      for (const [network, networkAddresses] of newAddressesByNetwork) {
        const state = this.networks.get(network);
        if (state?.connected && networkAddresses.length > 0) {
          await this.subscribeAddressBatch(state, networkAddresses);
        }
      }

      cursor = addresses[addresses.length - 1].id;
      if (addresses.length < PAGE_SIZE) break;
    }

    // Second pass: Remove addresses that no longer exist in database
    for (const [address, info] of this.addressToWallet) {
      if (!dbAddressSet.has(address)) {
        this.addressToWallet.delete(address);
        const state = this.networks.get(info.network);
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
        totalSubscribed: this.addressToWallet.size,
      });
    } else {
      log.debug('Subscription reconciliation complete - no changes');
    }

    return { removed, added };
  }

  /**
   * Check if the manager is connected to any network
   */
  isConnected(): boolean {
    for (const state of this.networks.values()) {
      if (state.connected) return true;
    }
    return false;
  }

  /**
   * Get health metrics for monitoring
   */
  getHealthMetrics(): {
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
    const networks: Record<string, {
      connected: boolean;
      subscribedToHeaders: boolean;
      subscribedAddresses: number;
      lastBlockHeight: number;
      reconnectAttempts: number;
    }> = {};

    for (const [network, state] of this.networks) {
      networks[network] = {
        connected: state.connected,
        subscribedToHeaders: state.subscribedToHeaders,
        subscribedAddresses: state.subscribedAddresses.size,
        lastBlockHeight: state.lastBlockHeight,
        reconnectAttempts: state.reconnectAttempts,
      };
    }

    return {
      isRunning: this.isRunning,
      networks,
      totalSubscribedAddresses: this.addressToWallet.size,
    };
  }

  /**
   * Stop the Electrum subscription manager
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    log.info('Stopping Electrum subscription manager...');
    this.isRunning = false;

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    await this.releaseSubscriptionLock();

    // Clear reconnection timers
    for (const state of this.networks.values()) {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
    }

    // Close all Electrum connections
    closeAllElectrumClients();

    // Clear state
    this.networks.clear();
    this.addressToWallet.clear();

    log.info('Electrum subscription manager stopped');
  }
}
