/**
 * useWalletData Hook
 *
 * Manages all wallet data fetching, pagination, and background data state.
 * This includes: wallet, devices, transactions, UTXOs, addresses, privacy,
 * drafts, explorer URL, groups, and share info.
 *
 * Extracted from WalletDetail.tsx to isolate data-layer concerns.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Wallet, Transaction, UTXO, Device, User, Address, WalletType,
} from '../../../types';
import * as walletsApi from '../../../src/api/wallets';
import * as transactionsApi from '../../../src/api/transactions';
import * as devicesApi from '../../../src/api/devices';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as draftsApi from '../../../src/api/drafts';
import * as privacyApi from '../../../src/api/transactions';
import * as authApi from '../../../src/api/auth';
import * as adminApi from '../../../src/api/admin';
import { ApiError } from '../../../src/api/client';
import { useErrorHandler } from '../../../hooks/useErrorHandler';
import { useAppNotifications } from '../../../contexts/AppNotificationContext';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';
import { formatApiTransaction, formatApiUtxo } from '../mappers';

const log = createLogger('useWalletData');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TX_PAGE_SIZE = 50;
const UTXO_PAGE_SIZE = 100;
const ADDRESS_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWalletDataParams {
  /** Wallet ID from route params */
  id: string | undefined;
  /** Authenticated user */
  user: User | null;
}

export interface UseWalletDataReturn {
  // Core wallet data
  wallet: Wallet | null;
  setWallet: React.Dispatch<React.SetStateAction<Wallet | null>>;
  devices: Device[];
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;

  // Transactions
  transactions: Transaction[];
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  transactionStats: transactionsApi.TransactionStats | null;
  txOffset: number;
  hasMoreTx: boolean;
  loadingMoreTx: boolean;
  loadMoreTransactions: () => Promise<void>;

  // UTXOs
  utxos: UTXO[];
  setUTXOs: React.Dispatch<React.SetStateAction<UTXO[]>>;
  utxoSummary: { count: number; totalBalance: number } | null;
  hasMoreUtxos: boolean;
  loadingMoreUtxos: boolean;
  loadMoreUtxos: () => Promise<void>;

  // UTXO stats (full dataset for stats tab)
  utxoStats: UTXO[];
  setUtxoStats: React.Dispatch<React.SetStateAction<UTXO[]>>;
  loadingUtxoStats: boolean;
  loadUtxosForStats: (walletId: string) => Promise<void>;

  // Privacy
  privacyData: privacyApi.UtxoPrivacyInfo[];
  privacySummary: privacyApi.WalletPrivacySummary | null;
  showPrivacy: boolean;

  // Addresses
  addresses: Address[];
  setAddresses: React.Dispatch<React.SetStateAction<Address[]>>;
  walletAddressStrings: string[];
  addressSummary: transactionsApi.AddressSummary | null;
  hasMoreAddresses: boolean;
  loadingAddresses: boolean;
  loadAddresses: (walletId: string, limit: number, offset: number, reset?: boolean) => Promise<void>;
  loadAddressSummary: (walletId: string) => Promise<void>;
  addressOffset: number;
  ADDRESS_PAGE_SIZE: number;

  // Drafts
  draftsCount: number;
  setDraftsCount: React.Dispatch<React.SetStateAction<number>>;

  // Explorer
  explorerUrl: string;

  // Users & Groups
  users: User[];
  groups: authApi.UserGroup[];

  // Share info
  walletShareInfo: walletsApi.WalletShareInfo | null;
  setWalletShareInfo: (info: walletsApi.WalletShareInfo | null) => void;

  // Refresh
  fetchData: (isRefresh?: boolean) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWalletData({
  id,
  user,
}: UseWalletDataParams): UseWalletDataReturn {
  const navigate = useNavigate();
  const { handleError } = useErrorHandler();
  const { addNotification: addAppNotification, removeNotificationsByType } = useAppNotifications();

  // -----------------------------------------------------------------------
  // Core state
  // -----------------------------------------------------------------------
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Transactions
  // -----------------------------------------------------------------------
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionStats, setTransactionStats] = useState<transactionsApi.TransactionStats | null>(null);
  const [txOffset, setTxOffset] = useState(0);
  const [hasMoreTx, setHasMoreTx] = useState(true);
  const [loadingMoreTx, setLoadingMoreTx] = useState(false);

  // -----------------------------------------------------------------------
  // UTXOs
  // -----------------------------------------------------------------------
  const [utxos, setUTXOs] = useState<UTXO[]>([]);
  const [utxoSummary, setUtxoSummary] = useState<{ count: number; totalBalance: number } | null>(null);
  const [utxoOffset, setUtxoOffset] = useState(0);
  const [hasMoreUtxos, setHasMoreUtxos] = useState(true);
  const [loadingMoreUtxos, setLoadingMoreUtxos] = useState(false);
  const [utxoStats, setUtxoStats] = useState<UTXO[]>([]);
  const [loadingUtxoStats, setLoadingUtxoStats] = useState(false);

  // -----------------------------------------------------------------------
  // Privacy
  // -----------------------------------------------------------------------
  const [privacyData, setPrivacyData] = useState<privacyApi.UtxoPrivacyInfo[]>([]);
  const [privacySummary, setPrivacySummary] = useState<privacyApi.WalletPrivacySummary | null>(null);
  const [showPrivacy] = useState(true);

  // -----------------------------------------------------------------------
  // Addresses
  // -----------------------------------------------------------------------
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressOffset, setAddressOffset] = useState(0);
  const [hasMoreAddresses, setHasMoreAddresses] = useState(true);
  const [addressSummary, setAddressSummary] = useState<transactionsApi.AddressSummary | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(false);

  // Memoize wallet addresses to prevent infinite re-renders in TransactionList
  const walletAddressStrings = useMemo(() => addresses.map(a => a.address), [addresses]);

  // -----------------------------------------------------------------------
  // Drafts
  // -----------------------------------------------------------------------
  const [draftsCount, setDraftsCount] = useState(0);

  // -----------------------------------------------------------------------
  // Explorer
  // -----------------------------------------------------------------------
  const [explorerUrl, setExplorerUrl] = useState('https://mempool.space');

  // -----------------------------------------------------------------------
  // Users & Groups & Share info
  // -----------------------------------------------------------------------
  const [users] = useState<User[]>([]);
  const [groups, setGroups] = useState<authApi.UserGroup[]>([]);
  const [walletShareInfo, setWalletShareInfo] = useState<walletsApi.WalletShareInfo | null>(null);

  // -----------------------------------------------------------------------
  // Sync effects for pagination boundaries
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (addressSummary) {
      setHasMoreAddresses(addressOffset < addressSummary.totalAddresses);
    }
  }, [addressSummary, addressOffset]);

  useEffect(() => {
    if (utxoSummary) {
      setHasMoreUtxos(utxoOffset < utxoSummary.count);
    }
  }, [utxoSummary, utxoOffset]);

  // Reset UTXO state when wallet ID changes
  useEffect(() => {
    setUTXOs([]);
    setUtxoSummary(null);
    setUtxoOffset(0);
    setHasMoreUtxos(true);
    setUtxoStats([]);
    setLoadingMoreUtxos(false);
    setLoadingUtxoStats(false);
  }, [id]);

  // -----------------------------------------------------------------------
  // Load helpers
  // -----------------------------------------------------------------------

  const loadAddressSummaryFn = async (walletId: string) => {
    try {
      const summary = await transactionsApi.getAddressSummary(walletId);
      setAddressSummary(summary);
    } catch (err) {
      logError(log, err, 'Failed to load address summary');
    }
  };

  const loadAddressesFn = async (walletId: string, limit: number, offset: number, reset = false) => {
    try {
      setLoadingAddresses(true);
      if (reset) {
        setAddressOffset(0);
      }

      const apiAddresses = await transactionsApi.getAddresses(walletId, { limit, offset });

      // Convert to component format
      const formattedAddrs: Address[] = apiAddresses.map(addr => ({
        id: addr.id,
        address: addr.address,
        derivationPath: addr.derivationPath,
        index: addr.index,
        used: addr.used,
        balance: addr.balance || 0,
        isChange: addr.isChange,
        labels: addr.labels || [],
        walletId: walletId,
      }));

      setAddresses(prev => reset ? formattedAddrs : [...prev, ...formattedAddrs]);
      const nextOffset = offset + formattedAddrs.length;
      setAddressOffset(nextOffset);
      if (addressSummary) {
        setHasMoreAddresses(nextOffset < addressSummary.totalAddresses);
      } else {
        setHasMoreAddresses(formattedAddrs.length === limit);
      }
    } catch (err) {
      logError(log, err, 'Failed to load addresses');
    } finally {
      setLoadingAddresses(false);
    }
  };

  const loadUtxos = async (walletId: string, limit: number, offset: number, reset = false) => {
    if (!reset) {
      setLoadingMoreUtxos(true);
    }

    try {
      if (reset) {
        setUtxoOffset(0);
      }

      const utxoData = await transactionsApi.getUTXOs(walletId, { limit, offset });
      setUtxoSummary({ count: utxoData.count, totalBalance: utxoData.totalBalance });

      const formattedUTXOs = utxoData.utxos.map(formatApiUtxo);

      setUTXOs(prev => reset ? formattedUTXOs : [...prev, ...formattedUTXOs]);
      const nextOffset = offset + formattedUTXOs.length;
      setUtxoOffset(nextOffset);
      setHasMoreUtxos(nextOffset < utxoData.count);
    } catch (err) {
      logError(log, err, 'Failed to load UTXOs');
    } finally {
      if (!reset) {
        setLoadingMoreUtxos(false);
      }
    }
  };

  const loadUtxosForStatsFn = async (walletId: string) => {
    setLoadingUtxoStats(true);
    try {
      const utxoData = await transactionsApi.getUTXOs(walletId);
      const formattedUTXOs = utxoData.utxos.map(formatApiUtxo);
      setUtxoStats(formattedUTXOs);
    } catch (err) {
      logError(log, err, 'Failed to load UTXOs for stats');
    } finally {
      setLoadingUtxoStats(false);
    }
  };

  // -----------------------------------------------------------------------
  // Pagination actions
  // -----------------------------------------------------------------------

  const loadMoreTransactions = async () => {
    if (!id || loadingMoreTx || !hasMoreTx) return;

    try {
      setLoadingMoreTx(true);
      const apiTransactions = await transactionsApi.getTransactions(id, { limit: TX_PAGE_SIZE, offset: txOffset });

      const formattedTxs = apiTransactions.map(tx => formatApiTransaction(tx, id));

      setTransactions(prev => [...prev, ...formattedTxs]);
      setTxOffset(prev => prev + TX_PAGE_SIZE);
      setHasMoreTx(apiTransactions.length === TX_PAGE_SIZE);
    } catch (err) {
      logError(log, err, 'Failed to load more transactions');
      handleError(err, 'Failed to Load More Transactions');
    } finally {
      setLoadingMoreTx(false);
    }
  };

  const loadMoreUtxos = async () => {
    if (!id || loadingMoreUtxos || !hasMoreUtxos) return;
    await loadUtxos(id, UTXO_PAGE_SIZE, utxoOffset, false);
  };

  // -----------------------------------------------------------------------
  // Main data fetcher
  // -----------------------------------------------------------------------

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!id || !user) return;

    // Only show loading state on initial load, not on refresh
    if (!isRefresh) {
      setLoading(true);
    }
    setError(null);

    // Fetch wallet data - this is critical, fail if it doesn't work
    let apiWallet;
    try {
      apiWallet = await walletsApi.getWallet(id);
    } catch (err) {
      log.error('Failed to fetch wallet', { error: err });
      if (err instanceof ApiError) {
        if (err.status === 404) {
          navigate('/wallets');
          return;
        }
        setError(err.message);
      } else {
        setError('Failed to load wallet');
      }
      setLoading(false);
      return;
    }

    // Convert API wallet to component format
    const walletType = apiWallet.type === 'multi_sig' ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;
    const formattedWallet: Wallet = {
      id: apiWallet.id,
      name: apiWallet.name,
      type: walletType,
      network: apiWallet.network,
      balance: apiWallet.balance,
      scriptType: apiWallet.scriptType,
      derivationPath: apiWallet.descriptor || '',
      fingerprint: apiWallet.fingerprint || '',
      label: apiWallet.name,
      xpub: '',
      unit: 'sats',
      ownerId: user.id,
      groupIds: [],
      quorum: apiWallet.quorum && apiWallet.totalSigners
        ? { m: Number(apiWallet.quorum), n: apiWallet.totalSigners }
        : { m: 1, n: 1 },
      descriptor: apiWallet.descriptor,
      deviceIds: [],
      // Sync metadata
      lastSyncedAt: apiWallet.lastSyncedAt,
      lastSyncStatus: apiWallet.lastSyncStatus as 'success' | 'failed' | 'partial' | 'retrying' | null,
      syncInProgress: apiWallet.syncInProgress,
      // Sharing info
      isShared: apiWallet.isShared,
      sharedWith: apiWallet.sharedWith,
      // User permissions
      userRole: apiWallet.userRole,
      canEdit: apiWallet.canEdit,
    };

    setWallet(formattedWallet);

    // Clear loading state immediately - wallet is ready to display
    setLoading(false);

    // Fetch remaining data in parallel, with individual error handling
    const fetchPromises = [];

    // Fetch explorer URL
    fetchPromises.push(
      bitcoinApi.getStatus()
        .then(status => {
          if (status.explorerUrl) setExplorerUrl(status.explorerUrl);
        })
        .catch(err => log.error('Failed to fetch explorer URL', { error: err }))
    );

    // Fetch devices
    fetchPromises.push(
      devicesApi.getDevices()
        .then(allDevices => {
          const expectedPurpose = walletType === WalletType.MULTI_SIG ? 'multisig' : 'single_sig';

          const walletDevices = allDevices
            .filter(d => d.wallets?.some(w => w.wallet.id === id))
            .map(d => {
              const accounts = d.accounts || [];
              const exactMatch = accounts.find(
                a => a.purpose === expectedPurpose && a.scriptType === apiWallet.scriptType
              );
              const accountMissing = !exactMatch;

              return {
                id: d.id,
                type: d.type,
                label: d.label,
                fingerprint: d.fingerprint,
                derivationPath: exactMatch?.derivationPath || d.derivationPath || 'No matching account',
                xpub: exactMatch?.xpub || d.xpub,
                userId: user.id,
                accountMissing,
              };
            });
          setDevices(walletDevices);
        })
        .catch(err => log.error('Failed to fetch devices', { error: err }))
    );

    // Fetch transactions (initial load)
    fetchPromises.push(
      transactionsApi.getTransactions(id, { limit: TX_PAGE_SIZE, offset: 0 })
        .then(apiTransactions => {
          setTransactions(apiTransactions.map(tx => formatApiTransaction(tx, id)));
          setTxOffset(TX_PAGE_SIZE);
          setHasMoreTx(apiTransactions.length === TX_PAGE_SIZE);
        })
        .catch(err => log.error('Failed to fetch transactions', { error: err }))
    );

    // Fetch transaction stats
    fetchPromises.push(
      transactionsApi.getTransactionStats(id)
        .then(stats => setTransactionStats(stats))
        .catch(err => log.error('Failed to fetch transaction stats', { error: err }))
    );

    // Fetch UTXOs (paged)
    fetchPromises.push(
      loadUtxos(id, UTXO_PAGE_SIZE, 0, true)
        .catch(err => log.error('Failed to fetch UTXOs', { error: err }))
    );

    // Fetch privacy scores for UTXOs
    fetchPromises.push(
      privacyApi.getWalletPrivacy(id)
        .then(privacyResponse => {
          setPrivacyData(privacyResponse.utxos);
          setPrivacySummary(privacyResponse.summary);
        })
        .catch(err => log.error('Failed to fetch privacy data', { error: err }))
    );

    // Fetch addresses
    fetchPromises.push(
      loadAddressSummaryFn(id)
        .catch(err => log.error('Failed to fetch address summary', { error: err }))
    );

    fetchPromises.push(
      loadAddressesFn(id, ADDRESS_PAGE_SIZE, 0, true)
        .catch(err => log.error('Failed to fetch addresses', { error: err }))
    );

    // Fetch drafts count (for badge on tab and notifications)
    fetchPromises.push(
      draftsApi.getDrafts(id)
        .then(drafts => {
          setDraftsCount(drafts.length);
          // Update app notifications
          if (drafts.length > 0) {
            addAppNotification({
              type: 'pending_drafts',
              scope: 'wallet',
              scopeId: id,
              severity: 'warning',
              title: `${drafts.length} pending draft${drafts.length > 1 ? 's' : ''}`,
              message: 'Resume or broadcast your draft transactions',
              count: drafts.length,
              actionUrl: `/wallets/${id}`,
              actionLabel: 'View Drafts',
              dismissible: true,
              persistent: false,
            });
          } else {
            removeNotificationsByType('pending_drafts', id);
          }
        })
        .catch(err => log.error('Failed to fetch drafts count', { error: err }))
    );

    // Wait for all fetches to complete
    await Promise.all(fetchPromises);

    // Fetch user's groups and wallet sharing info (for Access tab)
    try {
      if (user?.isAdmin) {
        const allGroups = await adminApi.getGroups();
        const mappedGroups: authApi.UserGroup[] = allGroups.map(g => ({
          id: g.id,
          name: g.name,
          description: g.description || undefined,
          memberCount: g.members?.length || 0,
          memberIds: g.members?.map(m => m.userId) || [],
        }));
        setGroups(mappedGroups);
      } else {
        const userGroups = await authApi.getUserGroups();
        setGroups(userGroups);
      }
    } catch (err) {
      logError(log, err, 'Failed to fetch groups');
    }

    try {
      const shareInfo = await walletsApi.getWalletShareInfo(id);
      setWalletShareInfo(shareInfo);
    } catch (err) {
      logError(log, err, 'Failed to fetch wallet share info');
    }
  }, [id, user]);

  // -----------------------------------------------------------------------
  // Initial load effect
  // -----------------------------------------------------------------------
  useEffect(() => {
    fetchData();
  }, [id, user]);

  // Refetch wallet data when window becomes visible (handles missed WS events)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && id && user) {
        fetchData(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id, user]);

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------
  return {
    // Core
    wallet,
    setWallet,
    devices,
    loading,
    error,
    setError,

    // Transactions
    transactions,
    setTransactions,
    transactionStats,
    txOffset,
    hasMoreTx,
    loadingMoreTx,
    loadMoreTransactions,

    // UTXOs
    utxos,
    setUTXOs,
    utxoSummary,
    hasMoreUtxos,
    loadingMoreUtxos,
    loadMoreUtxos,

    // UTXO stats
    utxoStats,
    setUtxoStats,
    loadingUtxoStats,
    loadUtxosForStats: loadUtxosForStatsFn,

    // Privacy
    privacyData,
    privacySummary,
    showPrivacy,

    // Addresses
    addresses,
    setAddresses,
    walletAddressStrings,
    addressSummary,
    hasMoreAddresses,
    loadingAddresses,
    loadAddresses: loadAddressesFn,
    loadAddressSummary: loadAddressSummaryFn,
    addressOffset,
    ADDRESS_PAGE_SIZE,

    // Drafts
    draftsCount,
    setDraftsCount,

    // Explorer
    explorerUrl,

    // Users & Groups
    users,
    groups,

    // Share info
    walletShareInfo,
    setWalletShareInfo,

    // Refresh
    fetchData,
  };
}
