import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Wallet, Transaction, UTXO, Device, User, Group, Address, WalletType, Label, WalletTelegramSettings as WalletTelegramSettingsType, getQuorumM, getQuorumN, isMultisigType, getWalletTypeLabel } from '../types';
import { satsToBTC, formatBTC } from '@shared/utils/bitcoin';
import * as walletsApi from '../src/api/wallets';
import * as transactionsApi from '../src/api/transactions';
import * as labelsApi from '../src/api/labels';
import * as devicesApi from '../src/api/devices';
import * as bitcoinApi from '../src/api/bitcoin';
import * as syncApi from '../src/api/sync';
import * as authApi from '../src/api/auth';
import * as adminApi from '../src/api/admin';
import * as draftsApi from '../src/api/drafts';
import * as privacyApi from '../src/api/transactions';
import { truncateAddress } from '../utils/formatters';
import { getAddressExplorerUrl } from '../utils/explorer';
import { useBitcoinStatus } from '../hooks/queries/useBitcoin';
import { formatApiTransaction, formatApiUtxo } from './WalletDetail/mappers';
import { ApiError } from '../src/api/client';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { TransactionList } from './TransactionList';
import { TransactionExportModal } from './TransactionExportModal';
import { TransferOwnershipModal } from './TransferOwnershipModal';
import { PendingTransfersPanel } from './PendingTransfersPanel';
import { UTXOList } from './UTXOList';
import { WalletStats } from './WalletStats';
import { DraftList } from './DraftList';
import { LabelManager } from './LabelManager';
import { LabelBadges } from './LabelSelector';
import { AIQueryInput } from './AIQueryInput';
import { NaturalQueryResult } from '../src/api/ai';
import { useAIStatus } from '../hooks/useAIStatus';
import { Button } from './ui/Button';
import { useCurrency } from '../contexts/CurrencyContext';
import { Amount } from './Amount';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Settings,
  Share2,
  Copy,
  Users,
  Shield,
  Trash2,
  Plus,
  Download,
  QrCode,
  MapPin,
  Check,
  User as UserIcon,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  Tag,
  Edit2,
  ExternalLink,
  ScrollText,
  Pause,
  Play,
  Send,
  AlertCircle,
  HardDrive
} from 'lucide-react';
import { getWalletIcon, getDeviceIcon } from './ui/CustomIcons';
import { useUser } from '../contexts/UserContext';
import { useWalletEvents, useWalletLogs, WalletLogEntry } from '../hooks/useWebSocket';
import { useNotifications } from '../contexts/NotificationContext';
import { useAppNotifications } from '../contexts/AppNotificationContext';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { createLogger } from '../utils/logger';
import { logError } from '../utils/errorHandler';
import { WalletTelegramSettings } from './WalletDetail/WalletTelegramSettings';
import { LogTab } from './WalletDetail/LogTab';
import { DeleteModal, ReceiveModal, ExportModal, AddressQRModal } from './WalletDetail/modals';

const log = createLogger('WalletDetail');


export const WalletDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { format } = useCurrency();
  const { user } = useUser();
  const { handleError, showSuccess } = useErrorHandler();
  const { addNotification: addAppNotification, removeNotificationsByType } = useAppNotifications();
  const highlightTxId = (location.state as any)?.highlightTxId;
  const { data: bitcoinStatus } = useBitcoinStatus();
  const { enabled: aiEnabled } = useAIStatus();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [utxos, setUTXOs] = useState<UTXO[]>([]);
  const [utxoSummary, setUtxoSummary] = useState<{ count: number; totalBalance: number } | null>(null);
  const [utxoOffset, setUtxoOffset] = useState(0);
  const [hasMoreUtxos, setHasMoreUtxos] = useState(true);
  const [loadingMoreUtxos, setLoadingMoreUtxos] = useState(false);
  const [utxoStats, setUtxoStats] = useState<UTXO[]>([]);
  const [loadingUtxoStats, setLoadingUtxoStats] = useState(false);

  // AI Query filter state
  const [aiQueryFilter, setAiQueryFilter] = useState<NaturalQueryResult | null>(null);

  // Privacy scoring state
  const [privacyData, setPrivacyData] = useState<privacyApi.UtxoPrivacyInfo[]>([]);
  const [privacySummary, setPrivacySummary] = useState<privacyApi.WalletPrivacySummary | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(true);

  // Transaction Pagination State
  const TX_PAGE_SIZE = 50;
  const [txOffset, setTxOffset] = useState(0);
  const [hasMoreTx, setHasMoreTx] = useState(true);
  const [loadingMoreTx, setLoadingMoreTx] = useState(false);
  const [transactionStats, setTransactionStats] = useState<transactionsApi.TransactionStats | null>(null);

  // UTXO Pagination State
  const UTXO_PAGE_SIZE = 100;

  // Addresses State
  const ADDRESS_PAGE_SIZE = 25;
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressOffset, setAddressOffset] = useState(0);
  const [hasMoreAddresses, setHasMoreAddresses] = useState(true);
  const [addressSummary, setAddressSummary] = useState<transactionsApi.AddressSummary | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(false);

  // Memoize wallet addresses to prevent infinite re-renders in TransactionList
  const walletAddressStrings = useMemo(() => addresses.map(a => a.address), [addresses]);

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

  // Apply AI query filter to transactions
  const filteredTransactions = useMemo(() => {
    if (!aiQueryFilter || aiQueryFilter.type !== 'transactions') {
      return transactions;
    }

    let result = [...transactions];

    // Apply filters
    if (aiQueryFilter.filter) {
      const filter = aiQueryFilter.filter;
      result = result.filter(tx => {
        // Type filter (receive/send)
        if (filter.type) {
          const txType = tx.type === 'received' ? 'receive' : tx.type === 'sent' ? 'send' : tx.type;
          if (txType !== filter.type) return false;
        }
        // Label filter
        if (filter.label) {
          const hasLabel = tx.labels?.some(l => l.name.toLowerCase().includes(filter.label.toLowerCase()));
          if (!hasLabel) return false;
        }
        // Amount filter
        if (filter.amount) {
          const absAmount = Math.abs(tx.amount);
          if (typeof filter.amount === 'object') {
            if (filter.amount['>'] && absAmount <= filter.amount['>']) return false;
            if (filter.amount['<'] && absAmount >= filter.amount['<']) return false;
            if (filter.amount['>='] && absAmount < filter.amount['>=']) return false;
            if (filter.amount['<='] && absAmount > filter.amount['<=']) return false;
          }
        }
        // Confirmations filter
        if (filter.confirmations !== undefined) {
          if (tx.confirmations !== filter.confirmations) return false;
        }
        return true;
      });
    }

    // Apply sort
    if (aiQueryFilter.sort) {
      const { field, order } = aiQueryFilter.sort;
      result.sort((a, b) => {
        let aVal: number | string = 0;
        let bVal: number | string = 0;
        if (field === 'amount') {
          aVal = Math.abs(a.amount);
          bVal = Math.abs(b.amount);
        } else if (field === 'date' || field === 'timestamp') {
          aVal = a.timestamp || 0;
          bVal = b.timestamp || 0;
        } else if (field === 'confirmations') {
          aVal = a.confirmations || 0;
          bVal = b.confirmations || 0;
        }
        return order === 'desc' ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1);
      });
    }

    // Apply limit
    if (aiQueryFilter.limit && aiQueryFilter.limit > 0) {
      result = result.slice(0, aiQueryFilter.limit);
    }

    return result;
  }, [transactions, aiQueryFilter]);

  // Compute aggregation result if requested
  const aiAggregationResult = useMemo(() => {
    if (!aiQueryFilter?.aggregation || filteredTransactions.length === 0) return null;

    const amounts = filteredTransactions.map(tx => Math.abs(tx.amount));
    switch (aiQueryFilter.aggregation) {
      case 'sum':
        return amounts.reduce((a, b) => a + b, 0);
      case 'count':
        return filteredTransactions.length;
      case 'max':
        return Math.max(...amounts);
      case 'min':
        return Math.min(...amounts);
      default:
        return null;
    }
  }, [filteredTransactions, aiQueryFilter?.aggregation]);

  // Loading states
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync retry state
  const [syncRetryInfo, setSyncRetryInfo] = useState<{
    retryCount: number;
    maxRetries: number;
    error?: string;
  } | null>(null);

  // Check for activeTab in navigation state (e.g., from notification panel)
  const initialTab = (location.state as any)?.activeTab || 'tx';
  const [activeTab, setActiveTab] = useState<'tx' | 'utxo' | 'addresses' | 'drafts' | 'stats' | 'access' | 'settings' | 'log'>(initialTab);
  const [addressSubTab, setAddressSubTab] = useState<'receive' | 'change'>('receive');
  const [accessSubTab, setAccessSubTab] = useState<'ownership' | 'sharing' | 'transfers'>('ownership');
  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'devices' | 'notifications' | 'advanced'>('general');
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [draftsCount, setDraftsCount] = useState(0);

  // Update activeTab if navigation state changes
  useEffect(() => {
    const stateTab = (location.state as any)?.activeTab;
    if (stateTab && stateTab !== activeTab) {
      setActiveTab(stateTab);
    }
  }, [location.state]);
  
  // Export Modal State
  const [showExport, setShowExport] = useState(false);

  // Transaction Export Modal State
  const [showTransactionExport, setShowTransactionExport] = useState(false);
  
  // Delete Modal State
  const [showDelete, setShowDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');

  // Transfer Ownership Modal State
  const [showTransferModal, setShowTransferModal] = useState(false);
  
  // Data for Settings/Access
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<authApi.UserGroup[]>([]);
  const [selectedGroupToAdd, setSelectedGroupToAdd] = useState<string>('');
  const [walletShareInfo, setWalletShareInfo] = useState<walletsApi.WalletShareInfo | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<authApi.SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [sharingLoading, setSharingLoading] = useState(false);

  // Device sharing prompt state (shown after sharing wallet with user)
  const [deviceSharePrompt, setDeviceSharePrompt] = useState<{
    show: boolean;
    targetUserId: string;
    targetUsername: string;
    devices: Array<{ id: string; label: string; fingerprint: string }>;
  }>({ show: false, targetUserId: '', targetUsername: '', devices: [] });

  // Selection State for UTXOs
  const [selectedUtxos, setSelectedUtxos] = useState<Set<string>>(new Set());

  // Wallet Name Editing State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  // Address QR Modal State
  const [qrModalAddress, setQrModalAddress] = useState<string | null>(null);

  // Block Explorer URL
  const [explorerUrl, setExplorerUrl] = useState('https://mempool.space');

  // Address Label Editing State
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [availableLabels, setAvailableLabels] = useState<Label[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [savingAddressLabels, setSavingAddressLabels] = useState(false);

  // Receive Modal State
  const [showReceive, setShowReceive] = useState(false);


  // Clipboard functionality
  const { copy, isCopied } = useCopyToClipboard();

  // Wallet logs hook - only enabled when Log tab is active
  const { logs, isPaused, isLoading: logsLoading, clearLogs, togglePause } = useWalletLogs(id, {
    enabled: activeTab === 'log',
    maxEntries: 500,
  });

  // WebSocket integration
  const { addNotification } = useNotifications();

  // Subscribe to wallet events
  useWalletEvents(id, {
    onTransaction: (data) => {
      log.debug('Real-time transaction received', { txid: data?.txid });

      // Determine title based on transaction type
      const title = data.type === 'received' ? 'Bitcoin Received'
        : data.type === 'consolidation' ? 'Consolidation'
        : 'Bitcoin Sent';
      const prefix = data.type === 'received' ? '+' : '-';

      // Show notification
      addNotification({
        type: 'transaction',
        title,
        message: `${prefix}${formatBTC(satsToBTC(Math.abs(data.amount)), 8, false)} BTC in ${wallet?.name || 'wallet'}`,
        duration: 10000,
        data,
      });

      // Refresh transaction list
      fetchData(true);
    },
    onBalance: (data) => {
      log.debug('Real-time balance update', { balance: data?.confirmed });

      // Update wallet balance immediately
      if (wallet) {
        setWallet({ ...wallet, balance: data.balance });
      }

      // Note: Balance notifications are handled globally in Dashboard.tsx
      // to avoid duplicate notifications when this page is open
    },
    onConfirmation: (data) => {
      log.debug('Transaction confirmation', { txid: data?.txid, confirmations: data?.confirmations });

      // Update transaction confirmations
      setTransactions(prev =>
        prev.map(tx =>
          tx.txid === data.txid
            ? { ...tx, confirmations: data.confirmations }
            : tx
        )
      );

      // Show notification for important milestones
      if ([1, 3, 6].includes(data.confirmations)) {
        addNotification({
          type: 'confirmation',
          title: 'Transaction Confirmed',
          message: `${data.confirmations} confirmation${data.confirmations > 1 ? 's' : ''} reached`,
          duration: 5000,
          data,
        });
      }
    },
    onSync: (data) => {
      log.debug('Sync status update', { status: data?.status });

      // Update wallet sync status (use functional form to avoid stale closure)
      setWallet(prevWallet => {
        if (!prevWallet) return prevWallet;
        return {
          ...prevWallet,
          syncInProgress: data.inProgress,
          lastSyncStatus: data.status || prevWallet.lastSyncStatus,
          lastSyncedAt: data.lastSyncedAt ? new Date(data.lastSyncedAt).toISOString() : prevWallet.lastSyncedAt,
        };
      });

      // Update retry info
      if (data.status === 'retrying' && data.retryCount !== undefined && data.maxRetries !== undefined) {
        setSyncRetryInfo({
          retryCount: data.retryCount,
          maxRetries: data.maxRetries,
          error: data.error,
        });
      } else if (data.status === 'success' || data.status === 'failed') {
        // Clear retry info on success or final failure
        setSyncRetryInfo(null);
      }

      // If sync completed, clear local syncing state (don't wait for HTTP response)
      if (!data.inProgress) {
        setSyncing(false);
      }

      // If sync completed successfully, refresh data
      if (!data.inProgress && data.status === 'success') {
        fetchData(true);
      }
    },
  });

  useEffect(() => {
    fetchData();
  }, [id, user]);

  useEffect(() => {
    setUTXOs([]);
    setUtxoSummary(null);
    setUtxoOffset(0);
    setHasMoreUtxos(true);
    setUtxoStats([]);
    setSelectedUtxos(new Set());
    setLoadingMoreUtxos(false);
    setLoadingUtxoStats(false);
  }, [id]);

  // Refetch wallet data when window becomes visible (handles missed WS events)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && id && user) {
        // Refresh data to get current sync status
        fetchData(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id, user]);

  useEffect(() => {
    if (!id || activeTab !== 'stats') return;
    if (utxoStats.length > 0 || loadingUtxoStats) return;
    loadUtxosForStats(id);
  }, [activeTab, id, utxoStats.length, loadingUtxoStats]);

  const fetchData = async (isRefresh = false) => {
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
    // API returns 'multi_sig' or 'single_sig', convert to WalletType enum values
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
        ? { m: apiWallet.quorum, n: apiWallet.totalSigners }
        : { m: 1, n: 1 },
      descriptor: apiWallet.descriptor,
      deviceIds: [], // Will be populated from devices
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
    // Remaining data loads in background with individual loading states
    setLoading(false);

    // Fetch remaining data in parallel, with individual error handling
    // These can fail gracefully without blocking the wallet view
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
          // Determine expected account purpose based on wallet type
          const expectedPurpose = walletType === WalletType.MULTI_SIG ? 'multisig' : 'single_sig';

          const walletDevices = allDevices
            .filter(d => d.wallets?.some(w => w.wallet.id === id))
            .map(d => {
              // Find the matching account for this wallet's type and script type
              const accounts = d.accounts || [];
              // REQUIRE exact match (purpose + scriptType) - no fallback
              const exactMatch = accounts.find(
                a => a.purpose === expectedPurpose && a.scriptType === apiWallet.scriptType
              );

              // Flag if device lacks required account - cannot sign for this wallet
              const accountMissing = !exactMatch;

              return {
                id: d.id,
                type: d.type,
                label: d.label,
                fingerprint: d.fingerprint,
                // Only use exact match - show legacy path if no match (to indicate the problem)
                derivationPath: exactMatch?.derivationPath || d.derivationPath || 'No matching account',
                xpub: exactMatch?.xpub || d.xpub,
                userId: user.id,
                accountMissing, // Flag for UI warning
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

    // Fetch transaction stats (for summary across all transactions)
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
      loadAddressSummary(id)
        .catch(err => log.error('Failed to fetch address summary', { error: err }))
    );

    fetchPromises.push(
      loadAddresses(id, ADDRESS_PAGE_SIZE, 0, true)
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
            // Remove draft notifications if no drafts
            removeNotificationsByType('pending_drafts', id);
          }
        })
        .catch(err => log.error('Failed to fetch drafts count', { error: err }))
    );

    // Wait for all fetches to complete (they handle their own errors)
    await Promise.all(fetchPromises);

    // Fetch user's groups and wallet sharing info (for Access tab)
    // Admins can see and assign any group; regular users only see groups they belong to
    try {
      if (user?.isAdmin) {
        // Admins can share with any group
        const allGroups = await adminApi.getGroups();
        // Map AdminGroup to UserGroup format
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
      // Non-critical - user can still view wallet without groups
    }

    try {
      const shareInfo = await walletsApi.getWalletShareInfo(id);
      setWalletShareInfo(shareInfo);
    } catch (err) {
      logError(log, err, 'Failed to fetch wallet share info');
      // Non-critical - user can still view wallet without share info
    }
  };

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

  const loadAddressSummary = async (walletId: string) => {
    try {
      const summary = await transactionsApi.getAddressSummary(walletId);
      setAddressSummary(summary);
    } catch (err) {
      logError(log, err, 'Failed to load address summary');
    }
  };

  const loadAddresses = async (walletId: string, limit: number, offset: number, reset = false) => {
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
        labels: addr.labels || [], // Include labels from API response
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
      // Non-critical - addresses tab may be empty but wallet is still usable
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

  const loadUtxosForStats = async (walletId: string) => {
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

  // Sync wallet with blockchain (immediate sync using new sync API)
  const handleSync = async () => {
    if (!id) return;

    try {
      setSyncing(true);
      // Use the new sync API for immediate sync
      const result = await syncApi.syncWallet(id);
      if (!result.success && result.error) {
        log.error('Sync error', { error: result.error });
      }
      // Reload wallet data after sync
      await fetchData(true);
    } catch (err) {
      log.error('Failed to sync wallet', { error: err });
      handleError(err, 'Sync Failed');
    } finally {
      setSyncing(false);
    }
  };

  // Full resync - clears transactions and re-syncs from blockchain
  const handleFullResync = async () => {
    if (!id) return;

    if (!confirm('This will clear all transaction history and re-sync from the blockchain. This is useful if transactions are missing. Continue?')) {
      return;
    }

    try {
      setSyncing(true);
      const result = await syncApi.resyncWallet(id);
      showSuccess(result.message, 'Resync Queued');
      // Reload wallet data after resync is queued
      await fetchData(true);
    } catch (err) {
      log.error('Failed to resync wallet', { error: err });
      handleError(err, 'Resync Failed');
    } finally {
      setSyncing(false);
    }
  };

  // Repair wallet descriptor - regenerates from attached devices
  const handleRepairWallet = async () => {
    if (!id) return;

    try {
      setRepairing(true);
      const result = await walletsApi.repairWallet(id);
      if (result.success) {
        showSuccess(result.message, 'Repair Complete');
        // Reload wallet data after repair
        await fetchData(true);
      } else {
        handleError(new Error(result.message), 'Repair Failed');
      }
    } catch (err) {
      log.error('Failed to repair wallet', { error: err });
      handleError(err, 'Repair Failed');
    } finally {
      setRepairing(false);
    }
  };

  const handleLoadMoreAddressPage = async () => {
    if (!id || loadingAddresses || !hasMoreAddresses) return;
    await loadAddresses(id, ADDRESS_PAGE_SIZE, addressOffset, false);
  };

  const handleGenerateMoreAddresses = async () => {
    if (!id) return;
    setLoadingAddresses(true);
    try {
      // Generate more addresses on the backend
      await transactionsApi.generateAddresses(id, 10);
      await loadAddressSummary(id);
      // Reload first page to include newly generated addresses
      await loadAddresses(id, ADDRESS_PAGE_SIZE, 0, true);
    } catch (err) {
      logError(log, err, 'Failed to generate more addresses');
      handleError(err, 'Failed to Generate Addresses');
    } finally {
      setLoadingAddresses(false);
    }
  };

  // Note: truncateAddress is now imported from utils/formatters

  // Address label editing functions
  const handleEditAddressLabels = async (addr: Address) => {
    if (!addr.id || !id) return;
    setEditingAddressId(addr.id);
    setSelectedLabelIds(addr.labels?.map(l => l.id) || []);
    try {
      const labels = await labelsApi.getLabels(id);
      setAvailableLabels(labels);
    } catch (err) {
      logError(log, err, 'Failed to load labels');
      handleError(err, 'Failed to Load Labels');
    }
  };

  const handleSaveAddressLabels = async () => {
    if (!editingAddressId) return;
    try {
      setSavingAddressLabels(true);
      await labelsApi.setAddressLabels(editingAddressId, selectedLabelIds);
      // Update the address's labels locally
      const updatedLabels = availableLabels.filter(l => selectedLabelIds.includes(l.id));
      setAddresses(current =>
        current.map(addr =>
          addr.id === editingAddressId ? { ...addr, labels: updatedLabels } : addr
        )
      );
      setEditingAddressId(null);
    } catch (err) {
      logError(log, err, 'Failed to save address labels');
      handleError(err, 'Failed to Save Labels');
    } finally {
      setSavingAddressLabels(false);
    }
  };

  const handleToggleAddressLabel = (labelId: string) => {
    setSelectedLabelIds(prev =>
      prev.includes(labelId)
        ? prev.filter(id => id !== labelId)
        : [...prev, labelId]
    );
  };

  // Refresh data callback for when labels are changed
  const handleLabelsChange = () => {
    if (id) {
      fetchData(true);
    }
  };

  const handleToggleFreeze = async (txid: string, vout: number) => {
    // Find the UTXO to toggle
    const utxo = utxos.find(u => u.txid === txid && u.vout === vout);
    if (!utxo || !utxo.id) {
      log.error('UTXO not found or missing ID');
      return;
    }

    const newFrozenState = !utxo.frozen;

    // Optimistic update
    setUTXOs(current =>
      current.map(u =>
        (u.txid === txid && u.vout === vout) ? { ...u, frozen: newFrozenState } : u
      )
    );
    setUtxoStats(current =>
      current.map(u =>
        (u.txid === txid && u.vout === vout) ? { ...u, frozen: newFrozenState } : u
      )
    );

    try {
      await transactionsApi.freezeUTXO(utxo.id, newFrozenState);
    } catch (err) {
      logError(log, err, 'Failed to freeze UTXO');
      handleError(err, 'Failed to Freeze UTXO');
      // Revert optimistic update on error
      setUTXOs(current =>
        current.map(u =>
          (u.txid === txid && u.vout === vout) ? { ...u, frozen: !newFrozenState } : u
        )
      );
      setUtxoStats(current =>
        current.map(u =>
          (u.txid === txid && u.vout === vout) ? { ...u, frozen: !newFrozenState } : u
        )
      );
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedUtxos);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedUtxos(next);
  };

  const handleSendSelected = () => {
    navigate(`/wallets/${id}/send`, { state: { preSelected: Array.from(selectedUtxos) } });
  };

  const handleUpdateWallet = async (updatedData: Partial<Wallet>) => {
    if (!wallet || !id) return;

    try {
      // Optimistic update
      const updatedWallet = { ...wallet, ...updatedData };
      setWallet(updatedWallet);

      // Update via API (only name and descriptor are updateable)
      await walletsApi.updateWallet(id, {
        name: updatedData.name,
        descriptor: updatedData.descriptor,
      });
    } catch (err) {
      log.error('Failed to update wallet', { error: err });
      // Revert optimistic update on error
      setWallet(wallet);
      handleError(err, 'Update Failed');
    }
  };

  const addGroup = async (role: 'viewer' | 'signer' = 'viewer') => {
    if (!wallet || !selectedGroupToAdd || !id) return;
    try {
      setSharingLoading(true);
      await walletsApi.shareWalletWithGroup(id, { groupId: selectedGroupToAdd, role });
      // Refresh share info
      const shareInfo = await walletsApi.getWalletShareInfo(id);
      setWalletShareInfo(shareInfo);
      setSelectedGroupToAdd('');
    } catch (err) {
      log.error('Failed to share with group', { error: err });
      handleError(err, 'Share Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const updateGroupRole = async (role: 'viewer' | 'signer') => {
    if (!wallet || !walletShareInfo?.group || !id) return;
    try {
      setSharingLoading(true);
      await walletsApi.shareWalletWithGroup(id, { groupId: walletShareInfo.group.id, role });
      // Refresh share info
      const shareInfo = await walletsApi.getWalletShareInfo(id);
      setWalletShareInfo(shareInfo);
    } catch (err) {
      log.error('Failed to update group role', { error: err });
      handleError(err, 'Update Role Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const removeGroup = async () => {
    if (!wallet || !id) return;
    try {
      setSharingLoading(true);
      // Setting groupId to null removes group access
      await walletsApi.shareWalletWithGroup(id, { groupId: null });
      // Refresh share info
      const shareInfo = await walletsApi.getWalletShareInfo(id);
      setWalletShareInfo(shareInfo);
    } catch (err) {
      log.error('Failed to remove group', { error: err });
      handleError(err, 'Remove Group Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const handleShareWithUser = async (targetUserId: string, role: 'viewer' | 'signer' = 'viewer') => {
    if (!id) return;
    try {
      setSharingLoading(true);
      const result = await walletsApi.shareWalletWithUser(id, { targetUserId, role });

      // Refresh share info
      const shareInfo = await walletsApi.getWalletShareInfo(id);
      setWalletShareInfo(shareInfo);

      // If there are devices to share, show the prompt
      if (result.devicesToShare && result.devicesToShare.length > 0) {
        // Find the username from search results or share info
        const targetUsername = userSearchResults.find(u => u.id === targetUserId)?.username
          || shareInfo.users.find(u => u.id === targetUserId)?.username
          || 'this user';

        setDeviceSharePrompt({
          show: true,
          targetUserId,
          targetUsername,
          devices: result.devicesToShare,
        });
      }

      setUserSearchQuery('');
      setUserSearchResults([]);
    } catch (err) {
      log.error('Failed to share with user', { error: err });
      handleError(err, 'Share Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const handleShareDevicesWithUser = async () => {
    if (!deviceSharePrompt.show) return;
    try {
      setSharingLoading(true);
      // Share all devices with the user using allSettled to handle partial failures
      const results = await Promise.allSettled(
        deviceSharePrompt.devices.map(device =>
          devicesApi.shareDeviceWithUser(device.id, { targetUserId: deviceSharePrompt.targetUserId })
        )
      );

      // Check for failures
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      const successes = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');

      if (failures.length > 0) {
        log.warn('Some devices failed to share', {
          total: results.length,
          succeeded: successes.length,
          failed: failures.length,
          errors: failures.map(f => f.reason?.message || 'Unknown error'),
        });

        if (successes.length > 0) {
          // Partial success - show warning
          addAppNotification({
            type: 'warning',
            scope: 'global',
            severity: 'warning',
            title: 'Partial Success',
            message: `Shared ${successes.length} of ${results.length} devices. ${failures.length} failed.`,
          });
        } else {
          // Complete failure
          handleError(failures[0].reason, 'Device Share Failed');
        }
      }

      setDeviceSharePrompt({ show: false, targetUserId: '', targetUsername: '', devices: [] });
    } catch (err) {
      log.error('Failed to share devices', { error: err });
      handleError(err, 'Device Share Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const dismissDeviceSharePrompt = () => {
    setDeviceSharePrompt({ show: false, targetUserId: '', targetUsername: '', devices: [] });
  };

  const handleRemoveUserAccess = async (targetUserId: string) => {
    if (!id) return;
    try {
      setSharingLoading(true);
      await walletsApi.removeUserFromWallet(id, targetUserId);
      // Refresh share info
      const shareInfo = await walletsApi.getWalletShareInfo(id);
      setWalletShareInfo(shareInfo);
    } catch (err) {
      log.error('Failed to remove user', { error: err });
      handleError(err, 'Remove User Failed');
    } finally {
      setSharingLoading(false);
    }
  };

  const handleSearchUsers = async (query: string) => {
    setUserSearchQuery(query);
    if (query.length < 2) {
      setUserSearchResults([]);
      return;
    }
    try {
      setSearchingUsers(true);
      const results = await authApi.searchUsers(query);
      // Filter out users who already have access
      const existingUserIds = walletShareInfo?.users.map(u => u.id) || [];
      setUserSearchResults(results.filter(u => !existingUserIds.includes(u.id)));
    } catch (err) {
      logError(log, err, 'Failed to search users');
      handleError(err, 'Failed to Search Users');
    } finally {
      setSearchingUsers(false);
    }
  };

  // Reload wallet data after transfer actions
  const handleTransferComplete = async () => {
    if (!id) return;
    try {
      const walletData = await walletsApi.getWallet(id);
      setWallet(walletData);
      // Also refresh share info
      const shareInfo = await walletsApi.getWalletShareInfo(id);
      setWalletShareInfo(shareInfo);
    } catch (err) {
      log.error('Failed to reload wallet after transfer', { error: err });
    }
  };


  if (loading) return <div className="p-8 text-center animate-pulse">Loading wallet...</div>;

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg p-6 max-w-md mx-auto">
          <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-rose-900 dark:text-rose-100 mb-2">Failed to Load Wallet</h3>
          <p className="text-rose-700 dark:text-rose-300 mb-4">{error}</p>
          <Button onClick={() => { setError(null); fetchData(); }} variant="primary">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!wallet) return <div className="p-8 text-center animate-pulse">Loading wallet...</div>;

  const ownerUser = users.find(u => u.id === wallet.ownerId);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Card - Compact */}
      <div className="surface-elevated rounded-2xl p-4 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-5 dark:opacity-10 pointer-events-none">
           {getWalletIcon(wallet.type, "w-32 h-32 text-primary-500")}
        </div>

        <div className="relative z-10">
          {/* Row 1: Badges */}
          <div className="flex flex-wrap gap-1.5 mb-2">
             {/* Wallet Type Badge */}
             <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${isMultisigType(wallet.type) ? 'bg-warning-100 text-warning-800 border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20' : 'bg-success-100 text-success-800 border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20'}`}>
               {isMultisigType(wallet.type) ? `${getQuorumM(wallet.quorum)}/${getQuorumN(wallet.quorum, wallet.totalSigners)} Multisig` : 'Single Sig'}
             </span>
             {/* Network Badge - only show if not mainnet */}
             {wallet.network && wallet.network !== 'mainnet' && (
               <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${
                 wallet.network === 'testnet'
                   ? 'bg-testnet-100 text-testnet-800 border-testnet-200 dark:bg-testnet-500/10 dark:text-testnet-100 dark:border-testnet-500/30'
                   : wallet.network === 'signet'
                   ? 'bg-signet-100 text-signet-800 border-signet-200 dark:bg-signet-500/10 dark:text-signet-100 dark:border-signet-500/30'
                   : 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20'
               }`}>
                 {wallet.network}
               </span>
             )}
             {/* Sync Status Badge */}
             {wallet.lastSyncStatus === 'retrying' || syncRetryInfo ? (
               <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20" title={syncRetryInfo?.error || 'Sync failed, retrying...'}>
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Retrying {syncRetryInfo?.retryCount || 1}/{syncRetryInfo?.maxRetries || 3}
               </span>
             ) : syncing || wallet.syncInProgress ? (
               <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-400/30">
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Syncing
               </span>
             ) : wallet.lastSyncStatus === 'success' ? (
               <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20" title={wallet.lastSyncedAt ? `Last synced: ${new Date(wallet.lastSyncedAt).toLocaleString()}` : ''}>
                  <Check className="w-3 h-3 mr-1" /> Synced
               </span>
             ) : wallet.lastSyncStatus === 'failed' ? (
               <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20" title="Last sync failed">
                  <AlertTriangle className="w-3 h-3 mr-1" /> Failed
               </span>
             ) : wallet.lastSyncedAt ? (
               <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sanctuary-100 text-sanctuary-600 border border-sanctuary-200 dark:bg-sanctuary-800 dark:text-sanctuary-400 dark:border-sanctuary-700" title={`Last synced: ${new Date(wallet.lastSyncedAt).toLocaleString()}`}>
                  <Check className="w-3 h-3 mr-1" /> Cached
               </span>
             ) : (
               <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20" title="Never synced">
                  <AlertTriangle className="w-3 h-3 mr-1" /> Not Synced
               </span>
             )}
             {/* Role Badge - your access level */}
             <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
               wallet.userRole === 'owner'
                 ? 'bg-primary-600 text-white dark:bg-primary-100 dark:text-primary-700'
                 : wallet.userRole === 'signer'
                 ? 'bg-warning-600 text-white dark:bg-warning-100 dark:text-warning-700'
                 : 'bg-sanctuary-500 text-white dark:bg-sanctuary-900 dark:text-sanctuary-200'
             }`}>
               {wallet.userRole === 'owner' ? 'Owner' : wallet.userRole === 'signer' ? 'Signer' : 'Viewer'}
             </span>
             {/* Shared indicator */}
             {wallet.isShared && (
               <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-shared-600 text-white dark:bg-shared-100 dark:text-shared-700">
                 <Users className="w-3 h-3" />
                 Shared
               </span>
             )}
          </div>

          {/* Row 2: Name + Balance */}
          <div className="flex items-center justify-between gap-4 mb-3">
            <h1 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50 tracking-tight truncate">{wallet.name}</h1>
            <Amount
              sats={wallet.balance}
              size="lg"
              className="flex-shrink-0 font-semibold text-sanctuary-900 dark:text-sanctuary-50"
            />
          </div>

          {/* Row 3: Actions */}
          <div className="flex items-center justify-between">
            <div className="flex space-x-2">
               <Button onClick={() => setShowReceive(true)} variant="primary" size="sm">
                 <ArrowDownLeft className="w-4 h-4 mr-1.5" /> Receive
               </Button>
               {wallet.userRole !== 'viewer' && (
                 <Button variant="secondary" size="sm" onClick={() => navigate(`/wallets/${id}/send`)}>
                   <ArrowUpRight className="w-4 h-4 mr-1.5" /> Send
                 </Button>
               )}
            </div>
            <div className="flex space-x-1">
               <Button variant="ghost" size="sm" onClick={handleSync} disabled={syncing} title="Sync wallet">
                 <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
               </Button>
               <Button variant="ghost" size="sm" onClick={handleFullResync} disabled={syncing} title="Full resync (clears and re-syncs all transactions)">
                 <RotateCcw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
               </Button>
               <Button variant="ghost" size="sm" onClick={() => setShowExport(true)} title="Export wallet">
                 <Share2 className="w-4 h-4" />
               </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Initial Sync Banner - shown for newly imported wallets */}
      {!wallet.lastSyncedAt && (syncing || wallet.syncInProgress) && (
        <div className="surface-elevated rounded-2xl p-4 shadow-sm border border-primary-200 dark:border-primary-700 bg-primary-50 dark:bg-primary-950/30 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <RefreshCw className="w-6 h-6 text-primary-600 dark:text-primary-300 animate-spin" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-primary-900 dark:text-sanctuary-50">
                Initial sync in progress
              </h3>
              <p className="text-xs text-primary-700 dark:text-sanctuary-300 mt-0.5">
                Scanning blockchain for transactions. This may take a few minutes for wallets with many addresses or transaction history.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Never Synced Banner - shown when sync hasn't started */}
      {!wallet.lastSyncedAt && !syncing && !wallet.syncInProgress && wallet.lastSyncStatus !== 'retrying' && (
        <div className="surface-elevated rounded-2xl p-4 shadow-sm border border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950/30 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <AlertCircle className="w-6 h-6 text-warning-600 dark:text-warning-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-warning-900 dark:text-warning-100">
                Wallet not synced
              </h3>
              <p className="text-xs text-warning-700 dark:text-warning-300 mt-0.5">
                This wallet hasn't been synced with the blockchain yet. Click "Sync" to fetch your transaction history and balance.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={handleSync}>
              <RefreshCw className="w-3 h-3 mr-1" /> Sync Now
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-sanctuary-200 dark:border-sanctuary-800 overflow-x-auto scrollbar-hide">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {['tx', 'utxo', 'addresses', ...(wallet.userRole !== 'viewer' ? ['drafts'] : []), 'stats', ...(wallet.userRole === 'owner' ? ['access'] : []), 'settings', 'log'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`${
                activeTab === tab
                  ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300'
                  : 'border-transparent text-sanctuary-500 hover:text-sanctuary-700 hover:border-sanctuary-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm capitalize transition-colors relative`}
            >
              {tab === 'tx' ? 'Transactions' : tab === 'utxo' ? 'UTXOs' : tab}
              {tab === 'drafts' && draftsCount > 0 && (
                <span className="absolute -top-0.5 -right-3 flex h-4 w-4 items-center justify-center rounded-full bg-rose-400 dark:bg-rose-500 text-[10px] font-bold text-white">
                  {draftsCount > 9 ? '9+' : draftsCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content Area */}
      <div className="min-h-[400px]">
        {activeTab === 'tx' && (
          <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
             {/* Header with Export Button and AI Query */}
             <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
               {/* AI Natural Language Query - only show when AI is enabled */}
               {aiEnabled && (
                 <div className="flex-1 max-w-xl">
                   <AIQueryInput
                     walletId={wallet?.id || ''}
                     onQueryResult={(result) => setAiQueryFilter(result)}
                   />
                 </div>
               )}
               {/* Export Button */}
               {transactions.length > 0 && (
                 <button
                   onClick={() => setShowTransactionExport(true)}
                   className="flex items-center px-3 py-1.5 text-sm text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg transition-colors self-end sm:self-auto"
                 >
                   <Download className="w-4 h-4 mr-1.5" />
                   Export
                 </button>
               )}
             </div>

             {/* AI Filter Results Summary */}
             {aiQueryFilter && (
               <div className="mb-4 p-3 bg-primary-50 dark:bg-sanctuary-800 border border-primary-200 dark:border-sanctuary-600 rounded-lg">
                 <div className="flex items-center justify-between">
                   <div className="flex-1">
                     <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                       {aiAggregationResult !== null ? (
                         <>
                           Result: <span className="font-bold">{aiQueryFilter.aggregation === 'count' ? aiAggregationResult : `${aiAggregationResult.toLocaleString()} sats`}</span>
                           {aiQueryFilter.aggregation && <span className="text-sanctuary-500 ml-1">({aiQueryFilter.aggregation})</span>}
                         </>
                       ) : (
                         <>Showing {filteredTransactions.length} of {transactions.length} transactions</>
                       )}
                     </span>
                   </div>
                   <button
                     onClick={() => setAiQueryFilter(null)}
                     className="ml-3 p-1.5 text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700 rounded transition-colors"
                     title="Clear filter"
                   >
                     <X className="w-4 h-4" />
                   </button>
                 </div>
               </div>
             )}

             <TransactionList
               transactions={filteredTransactions}
               highlightedTxId={highlightTxId}
               onLabelsChange={handleLabelsChange}
               walletAddresses={walletAddressStrings}
               canEdit={wallet?.canEdit !== false}
               confirmationThreshold={bitcoinStatus?.confirmationThreshold}
               deepConfirmationThreshold={bitcoinStatus?.deepConfirmationThreshold}
               walletBalance={wallet?.balance}
               transactionStats={aiQueryFilter ? undefined : (transactionStats || undefined)}
             />
             {hasMoreTx && transactions.length > 0 && (
               <div className="mt-4 text-center">
                 <button
                   onClick={loadMoreTransactions}
                   disabled={loadingMoreTx}
                   className="px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50"
                 >
                   {loadingMoreTx ? (
                     <span className="flex items-center justify-center">
                       <span className="animate-spin rounded-full h-4 w-4 border-2 border-primary-500 border-t-transparent mr-2" />
                       Loading...
                     </span>
                   ) : (
                     `Load More (${transactions.length} shown)`
                   )}
                 </button>
               </div>
             )}
          </div>
        )}
        
        {activeTab === 'utxo' && (
          <div>
            <UTXOList
              utxos={utxos}
              totalCount={utxoSummary?.count}
              onToggleFreeze={handleToggleFreeze}
              selectable={wallet.userRole !== 'viewer'}
              selectedUtxos={selectedUtxos}
              onToggleSelect={handleToggleSelect}
              onSendSelected={wallet.userRole !== 'viewer' ? handleSendSelected : undefined}
              privacyData={privacyData}
              privacySummary={privacySummary}
              showPrivacy={showPrivacy}
              network={wallet?.network}
            />
            {hasMoreUtxos && utxos.length > 0 && (
              <div className="mt-4 text-center">
                <button
                  onClick={loadMoreUtxos}
                  disabled={loadingMoreUtxos}
                  className="px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loadingMoreUtxos ? (
                    <span className="flex items-center justify-center">
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-primary-500 border-t-transparent mr-2" />
                      Loading...
                    </span>
                  ) : (
                    `Load More (${utxos.length} shown)`
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'addresses' && (() => {
           // Helper to determine if address is a change address based on derivation path
           // Standard BIP derivation: m/purpose'/coin'/account'/change/index
           // change = 0 for external/receive, 1 for internal/change
           const isChangeAddress = (addr: Address): boolean => {
             if (typeof addr.isChange === 'boolean') {
               return addr.isChange;
             }
             const parts = addr.derivationPath.split('/');
             if (parts.length >= 2) {
               // Second-to-last part is the change indicator
               const changeIndicator = parts[parts.length - 2];
               return changeIndicator === '1';
             }
             return false;
           };

           const receiveAddresses = addresses.filter(addr => !isChangeAddress(addr));
           const changeAddresses = addresses.filter(addr => isChangeAddress(addr));

           // Render the address table content
           const renderAddressTableContent = (addressList: Address[], emptyMessage: string) => (
             addressList.length === 0 ? (
               <div className="p-8 text-center text-sanctuary-500 text-sm italic">
                 {emptyMessage}
               </div>
             ) : (
               <div className="overflow-x-auto">
                 <table className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
                   <thead className="surface-muted">
                     <tr>
                       <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Index</th>
                       <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Address</th>
                       <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Label</th>
                       <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Balance</th>
                       <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Status</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
                     {addressList.map((addr) => (
                       <tr key={addr.address} className="hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors">
                         <td className="px-6 py-4 whitespace-nowrap text-sm text-sanctuary-500 font-mono">
                           #{addr.index}
                         </td>
                         <td className="px-6 py-4 whitespace-nowrap">
                           <div className="flex items-center space-x-2">
                             <span
                               className="text-sm font-mono text-sanctuary-700 dark:text-sanctuary-300 cursor-default"
                               title={addr.address}
                             >
                               {truncateAddress(addr.address)}
                             </span>
                             <button
                               className={`transition-colors ${isCopied(addr.address) ? 'text-success-500' : 'text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300'}`}
                               onClick={() => copy(addr.address)}
                               title={isCopied(addr.address) ? 'Copied!' : 'Copy address'}
                             >
                               {isCopied(addr.address) ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                             </button>
                             <button
                               className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
                               onClick={() => setQrModalAddress(addr.address)}
                               title="Show QR code"
                             >
                               <QrCode className="w-3 h-3" />
                             </button>
                             <a
                               href={getAddressExplorerUrl(addr.address, wallet?.network || 'mainnet', explorerUrl)}
                               target="_blank"
                               rel="noopener noreferrer"
                               className="text-sanctuary-400 hover:text-primary-500 dark:hover:text-primary-400"
                               title="View on block explorer"
                             >
                               <ExternalLink className="w-3 h-3" />
                             </a>
                           </div>
                         </td>
                         <td className="px-6 py-4 text-sm">
                           {editingAddressId === addr.id ? (
                             <div className="flex flex-wrap gap-1.5 items-center min-w-[200px]">
                               {availableLabels.length === 0 ? (
                                 <span className="text-xs text-sanctuary-400">No labels available</span>
                               ) : (
                                 <>
                                   {availableLabels.map(label => {
                                     const isSelected = selectedLabelIds.includes(label.id);
                                     return (
                                       <button
                                         key={label.id}
                                         onClick={() => handleToggleAddressLabel(label.id)}
                                         className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white transition-all ${
                                           isSelected
                                             ? 'ring-2 ring-offset-1 ring-sanctuary-500'
                                             : 'opacity-50 hover:opacity-75'
                                         }`}
                                         style={{ backgroundColor: label.color }}
                                       >
                                         <Tag className="w-2.5 h-2.5" />
                                         {label.name}
                                       </button>
                                     );
                                   })}
                                 </>
                               )}
                               <div className="flex items-center gap-1 ml-2">
                                 <button
                                   onClick={handleSaveAddressLabels}
                                   disabled={savingAddressLabels}
                                   className="p-1 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:bg-sanctuary-700 dark:hover:bg-sanctuary-600 dark:disabled:bg-sanctuary-800 dark:border dark:border-sanctuary-600 text-white dark:text-sanctuary-100 rounded transition-colors"
                                   title="Save"
                                 >
                                   {savingAddressLabels ? (
                                     <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent" />
                                   ) : (
                                     <Check className="w-3 h-3" />
                                   )}
                                 </button>
                                 <button
                                   onClick={() => setEditingAddressId(null)}
                                   className="p-1 text-sanctuary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
                                   title="Cancel"
                                 >
                                   <X className="w-3 h-3" />
                                 </button>
                               </div>
                             </div>
                           ) : (
                             <div className="flex items-center gap-2 group">
                               {(addr.labels && addr.labels.length > 0) ? (
                                 <LabelBadges labels={addr.labels} maxDisplay={2} size="sm" />
                               ) : addr.label ? (
                                 <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-300">
                                   {addr.label}
                                 </span>
                               ) : (
                                 <span className="text-sanctuary-300 italic">-</span>
                               )}
                               {addr.id && (
                                 <button
                                   onClick={() => handleEditAddressLabels(addr)}
                                   className="opacity-0 group-hover:opacity-100 p-1 text-sanctuary-400 hover:text-primary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-all"
                                   title="Edit labels"
                                 >
                                   <Edit2 className="w-3 h-3" />
                                 </button>
                               )}
                             </div>
                           )}
                         </td>
                         <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-sanctuary-900 dark:text-sanctuary-100">
                           {addr.balance > 0 ? format(addr.balance) : (addr.used ? format(0) : '-')}
                         </td>
                         <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                           <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${addr.used ? 'bg-success-100 text-success-800 dark:bg-success-900 dark:text-success-100' : 'bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-300'}`}>
                             {addr.used ? 'Used' : 'Unused'}
                           </span>
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             )
           );

           return (
             <div className="space-y-4 animate-fade-in">
               {addressSummary && (
                 <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                   <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
                     <p className="text-xs uppercase tracking-wide text-sanctuary-500">Total Addresses</p>
                     <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-1">
                       {addressSummary.totalAddresses}
                     </p>
                     <p className="text-xs text-sanctuary-500 mt-2">
                       {addressSummary.usedCount} used · {addressSummary.unusedCount} unused
                     </p>
                   </div>
                   <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
                     <p className="text-xs uppercase tracking-wide text-sanctuary-500">Total Balance</p>
                     <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-1">
                       {format(addressSummary.totalBalance)}
                     </p>
                   </div>
                   <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
                     <p className="text-xs uppercase tracking-wide text-sanctuary-500">Used Balance</p>
                     <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-1">
                       {format(addressSummary.usedBalance)}
                     </p>
                   </div>
                   <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-4">
                     <p className="text-xs uppercase tracking-wide text-sanctuary-500">Unused Balance</p>
                     <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-1">
                       {format(addressSummary.unusedBalance)}
                     </p>
                   </div>
                 </div>
               )}
               {addresses.length === 0 ? (
                 <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-12 text-center">
                   <MapPin className="w-12 h-12 mx-auto text-sanctuary-300 dark:text-sanctuary-600 mb-4" />
                   <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">No Addresses Available</h3>
                   <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400 mb-4 max-w-md mx-auto">
                     {!wallet.descriptor
                       ? "This wallet doesn't have a descriptor. Please link a hardware device with an xpub to generate addresses."
                       : "No addresses have been generated yet. Click below to generate addresses."}
                   </p>
                   {wallet.descriptor && (
                     <Button variant="primary" onClick={handleGenerateMoreAddresses} isLoading={loadingAddresses}>
                       <Plus className="w-4 h-4 mr-2" /> Generate Addresses
                     </Button>
                   )}
                 </div>
               ) : (
                 <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
                   {/* Sub-tabs Header */}
                   <div className="px-6 py-3 surface-muted border-b border-sanctuary-100 dark:border-sanctuary-800">
                     <div className="flex items-center justify-between">
                       <div className="flex space-x-1">
                         <button
                           onClick={() => setAddressSubTab('receive')}
                           className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                             addressSubTab === 'receive'
                               ? 'bg-white dark:bg-sanctuary-800 text-primary-600 dark:text-primary-400 shadow-sm'
                               : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                           }`}
                         >
                           <ArrowDownLeft className="w-4 h-4" />
                           <span>Receive</span>
                           <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                             addressSubTab === 'receive'
                               ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                               : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500'
                           }`}>
                             {receiveAddresses.length}
                           </span>
                         </button>
                         <button
                           onClick={() => setAddressSubTab('change')}
                           className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                             addressSubTab === 'change'
                               ? 'bg-white dark:bg-sanctuary-800 text-primary-600 dark:text-primary-400 shadow-sm'
                               : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                           }`}
                         >
                           <ArrowUpRight className="w-4 h-4" />
                           <span>Change</span>
                           <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                             addressSubTab === 'change'
                               ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                               : 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500'
                           }`}>
                             {changeAddresses.length}
                           </span>
                         </button>
                       </div>
                      <Button variant="ghost" size="sm" onClick={handleGenerateMoreAddresses} isLoading={loadingAddresses}>
                        <Plus className="w-4 h-4 mr-1" /> Generate
                      </Button>
                     </div>
                   </div>

                   {/* Address Table Content */}
                   {addressSubTab === 'receive' && renderAddressTableContent(
                     receiveAddresses,
                     "No receive addresses generated yet"
                   )}
                   {addressSubTab === 'change' && renderAddressTableContent(
                     changeAddresses,
                     "No change addresses used yet. Change addresses are created when you send Bitcoin."
                   )}
                 </div>
               )}
               {addresses.length > 0 && (
                 <div className="flex items-center justify-between text-sm text-sanctuary-500">
                   <span>
                     Showing {addresses.length} of {addressSummary?.totalAddresses ?? addresses.length} addresses
                   </span>
                   <div className="flex items-center gap-2">
                     {hasMoreAddresses ? (
                       <Button
                         variant="ghost"
                         size="sm"
                         onClick={handleLoadMoreAddressPage}
                         isLoading={loadingAddresses}
                       >
                         Load More
                       </Button>
                     ) : (
                       <span className="text-xs text-sanctuary-400">All addresses loaded</span>
                     )}
                   </div>
                 </div>
               )}
             </div>
           );
        })()}

        {activeTab === 'drafts' && (
          <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
            <DraftList
              walletId={id!}
              walletType={wallet.type === WalletType.MULTI_SIG ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG}
              quorum={wallet.quorum ? { m: getQuorumM(wallet.quorum), n: getQuorumN(wallet.quorum, wallet.totalSigners) } : undefined}
              canEdit={wallet.userRole !== 'viewer'}
              walletAddresses={addresses}
              walletName={wallet.name}
              onDraftsChange={(count) => {
                setDraftsCount(count);
                // Update app notifications
                if (count > 0) {
                  addAppNotification({
                    type: 'pending_drafts',
                    scope: 'wallet',
                    scopeId: id!,
                    severity: 'warning',
                    title: `${count} pending draft${count > 1 ? 's' : ''}`,
                    message: 'Resume or broadcast your draft transactions',
                    count: count,
                    actionUrl: `/wallets/${id}`,
                    actionLabel: 'View Drafts',
                    dismissible: true,
                    persistent: false,
                  });
                } else {
                  removeNotificationsByType('pending_drafts', id!);
                }
              }}
            />
          </div>
        )}

        {activeTab === 'stats' && (
          <WalletStats utxos={utxoStats.length > 0 ? utxoStats : utxos} balance={wallet.balance} transactions={transactions} />
        )}

        {activeTab === 'log' && (
          <LogTab
            logs={logs}
            isPaused={isPaused}
            isLoading={logsLoading}
            syncing={syncing}
            onTogglePause={togglePause}
            onClearLogs={clearLogs}
            onSync={handleSync}
            onFullResync={handleFullResync}
          />
        )}

        {activeTab === 'access' && (
          <div className="space-y-4">
            {/* Sub-tabs */}
            <div className="flex space-x-1 p-1 surface-secondary rounded-lg w-fit">
              {(['ownership', 'sharing', 'transfers'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAccessSubTab(tab)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                    accessSubTab === tab
                      ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
                      : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Ownership Sub-tab */}
            {accessSubTab === 'ownership' && (
              <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
                <div className="flex items-center justify-between p-3 surface-secondary rounded-lg">
                  <div className="flex items-center">
                    <div className="h-9 w-9 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-base font-bold text-sanctuary-600 dark:text-sanctuary-300">
                      {walletShareInfo?.users.find(u => u.role === 'owner')?.username?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="ml-3">
                      <p className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                        {walletShareInfo?.users.find(u => u.role === 'owner')?.username || user?.username || 'You'}
                      </p>
                      <p className="text-xs text-sanctuary-500">Wallet Owner</p>
                    </div>
                  </div>
                  {wallet.userRole === 'owner' && (
                    <button
                      onClick={() => setShowTransferModal(true)}
                      className="flex items-center px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
                    >
                      <Send className="w-4 h-4 mr-1.5" />
                      Transfer
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Sharing Sub-tab */}
            {accessSubTab === 'sharing' && (
              <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800 space-y-4">
                {/* Add sharing controls - only for owners */}
                {wallet.userRole === 'owner' && (
                  <div className="p-3 surface-muted rounded-lg border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                    <div className="flex flex-wrap gap-2">
                      {/* Group sharing */}
                      {!walletShareInfo?.group && (
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedGroupToAdd}
                            onChange={(e) => setSelectedGroupToAdd(e.target.value)}
                            className="text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
                          >
                            <option value="">Add group...</option>
                            {groups.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                          {selectedGroupToAdd && (
                            <>
                              <button
                                onClick={() => addGroup('viewer')}
                                disabled={sharingLoading}
                                className="text-xs px-2 py-1 rounded bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-300 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 transition-colors disabled:opacity-50"
                              >
                                Viewer
                              </button>
                              <button
                                onClick={() => addGroup('signer')}
                                disabled={sharingLoading}
                                className="text-xs px-2 py-1 rounded bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-900/50 transition-colors disabled:opacity-50"
                              >
                                Signer
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {/* User sharing */}
                      <div className="flex-1 min-w-[200px] relative">
                        <input
                          type="text"
                          value={userSearchQuery}
                          onChange={(e) => handleSearchUsers(e.target.value)}
                          placeholder="Add user..."
                          className="w-full text-sm surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg px-2 py-1.5"
                        />
                        {searchingUsers && (
                          <div className="absolute right-2 top-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-500 border-t-transparent" />
                          </div>
                        )}
                        {userSearchResults.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 surface-elevated border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {userSearchResults.map(u => (
                              <div key={u.id} className="px-2 py-1.5 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 flex items-center justify-between">
                                <div className="flex items-center">
                                  <div className="h-5 w-5 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                                    {u.username.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="text-sm">{u.username}</span>
                                </div>
                                <div className="flex gap-1">
                                  <button onClick={() => handleShareWithUser(u.id, 'viewer')} disabled={sharingLoading} className="text-xs px-1.5 py-0.5 rounded bg-sanctuary-200 dark:bg-sanctuary-700 hover:bg-sanctuary-300 dark:hover:bg-sanctuary-600 disabled:opacity-50">View</button>
                                  <button onClick={() => handleShareWithUser(u.id, 'signer')} disabled={sharingLoading} className="text-xs px-1.5 py-0.5 rounded bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-900/50 disabled:opacity-50">Sign</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Current shared access */}
                <div className="space-y-2">
                  {/* Group */}
                  {walletShareInfo?.group && (
                    <div className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
                      <div className="flex items-center">
                        <Users className="w-4 h-4 text-sanctuary-500 mr-2" />
                        <span className="text-sm font-medium">{walletShareInfo.group.name}</span>
                        {wallet.userRole === 'owner' ? (
                          <select
                            value={walletShareInfo.group.role}
                            onChange={(e) => updateGroupRole(e.target.value as 'viewer' | 'signer')}
                            disabled={sharingLoading}
                            className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full border-none cursor-pointer"
                          >
                            <option value="viewer">Viewer</option>
                            <option value="signer">Signer</option>
                          </select>
                        ) : (
                          <span className="ml-2 text-xs px-1.5 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full capitalize">{walletShareInfo.group.role}</span>
                        )}
                      </div>
                      {wallet.userRole === 'owner' && (
                        <button onClick={removeGroup} disabled={sharingLoading} className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Individual users */}
                  {walletShareInfo?.users.filter(u => u.role !== 'owner').map(u => (
                    <div key={u.id} className="flex items-center justify-between p-2.5 surface-secondary rounded-lg">
                      <div className="flex items-center">
                        <div className="h-6 w-6 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 flex items-center justify-center text-xs font-bold text-sanctuary-600 dark:text-sanctuary-300 mr-2">
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium">{u.username}</span>
                        {wallet.userRole === 'owner' ? (
                          <select
                            value={u.role}
                            onChange={(e) => handleShareWithUser(u.id, e.target.value as 'viewer' | 'signer')}
                            disabled={sharingLoading}
                            className="ml-2 text-xs bg-transparent border-none p-0 text-sanctuary-500 capitalize cursor-pointer"
                          >
                            <option value="viewer">Viewer</option>
                            <option value="signer">Signer</option>
                          </select>
                        ) : (
                          <span className="ml-2 text-xs text-sanctuary-500 capitalize">{u.role}</span>
                        )}
                      </div>
                      {wallet.userRole === 'owner' && (
                        <button onClick={() => handleRemoveUserAccess(u.id)} disabled={sharingLoading} className="text-xs text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Empty state */}
                  {!walletShareInfo?.group && (!walletShareInfo?.users || walletShareInfo.users.filter(u => u.role !== 'owner').length === 0) && (
                    <div className="text-center py-6 text-sanctuary-400 text-sm">
                      Not shared with anyone yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Transfers Sub-tab */}
            {accessSubTab === 'transfers' && (
              <PendingTransfersPanel
                resourceType="wallet"
                resourceId={id!}
                onTransferComplete={handleTransferComplete}
              />
            )}
          </div>
        )}


        {activeTab === 'settings' && (
          <div className="max-w-2xl space-y-4">
            {/* Settings Sub-tabs */}
            <div className="flex gap-1 p-1 bg-sanctuary-100 dark:bg-sanctuary-800 rounded-lg w-fit">
              <button
                onClick={() => setSettingsSubTab('general')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  settingsSubTab === 'general'
                    ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
                    : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200'
                }`}
              >
                General
              </button>
              <button
                onClick={() => setSettingsSubTab('devices')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  settingsSubTab === 'devices'
                    ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
                    : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200'
                }`}
              >
                Devices
              </button>
              <button
                onClick={() => setSettingsSubTab('notifications')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  settingsSubTab === 'notifications'
                    ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
                    : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200'
                }`}
              >
                Notifications
              </button>
              <button
                onClick={() => setSettingsSubTab('advanced')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  settingsSubTab === 'advanced'
                    ? 'bg-white dark:bg-sanctuary-700 text-sanctuary-900 dark:text-sanctuary-100 shadow-sm'
                    : 'text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200'
                }`}
              >
                Advanced
              </button>
            </div>

            {/* General Sub-tab */}
            {settingsSubTab === 'general' && (
              <div className="space-y-4">
                {/* Wallet Name */}
                <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
                  <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Wallet Name</h3>
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editedName}
                        onChange={(e) => setEditedName(e.target.value)}
                        className="flex-1 px-3 py-2 text-sm border border-sanctuary-300 dark:border-sanctuary-600 rounded-lg bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        placeholder="Enter wallet name"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editedName.trim()) {
                            handleUpdateWallet({ name: editedName.trim() });
                            setIsEditingName(false);
                          } else if (e.key === 'Escape') {
                            setIsEditingName(false);
                            setEditedName(wallet.name);
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          if (editedName.trim()) {
                            handleUpdateWallet({ name: editedName.trim() });
                            setIsEditingName(false);
                          }
                        }}
                        disabled={!editedName.trim() || editedName.trim() === wallet.name}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setIsEditingName(false);
                          setEditedName(wallet.name);
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-sanctuary-900 dark:text-sanctuary-100">{wallet.name}</span>
                      {wallet.canEdit !== false && (
                        <button
                          onClick={() => {
                            setEditedName(wallet.name);
                            setIsEditingName(true);
                          }}
                          className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 transition-colors rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-700"
                          title="Rename wallet"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Labels Management - only show if user can edit */}
                {wallet.canEdit !== false && (
                  <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
                    <LabelManager walletId={wallet.id} onLabelsChange={handleLabelsChange} />
                  </div>
                )}
              </div>
            )}

            {/* Devices Sub-tab */}
            {settingsSubTab === 'devices' && (
              <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
                <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Hardware Devices</h3>
                {devices.length > 0 ? (
                  <ul className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
                    {devices.map(d => {
                      const hasAccountMismatch = (d as any).accountMissing;
                      return (
                        <li
                          key={d.id}
                          onClick={() => navigate(`/devices/${d.id}`)}
                          className={`py-3 flex justify-between items-center cursor-pointer hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 -mx-2 px-2 rounded-lg transition-colors ${hasAccountMismatch ? 'border-l-4 border-rose-500' : ''}`}
                        >
                          <div className="flex items-center space-x-3">
                            <div className={`p-2 rounded-lg ${hasAccountMismatch ? 'bg-rose-100 dark:bg-rose-900/30' : 'surface-secondary'}`}>
                              {getDeviceIcon(d.type, `w-5 h-5 ${hasAccountMismatch ? 'text-rose-600 dark:text-rose-400' : 'text-sanctuary-600 dark:text-sanctuary-400'}`)}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{d.label}</p>
                              <p className="text-xs text-sanctuary-500">{d.type} • {d.fingerprint}</p>
                              {hasAccountMismatch ? (
                                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                                  Missing {wallet.type === WalletType.MULTI_SIG ? 'multisig' : 'single-sig'} account for {wallet.scriptType} - cannot sign
                                </p>
                              ) : (
                                <p className="text-xs font-mono text-sanctuary-400">{d.derivationPath}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasAccountMismatch ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-rose-600 text-white">
                                Cannot Sign
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-zen-indigo text-white">
                                Active
                              </span>
                            )}
                            <ChevronRight className="w-4 h-4 text-sanctuary-400" />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-sanctuary-500">No hardware devices associated with this wallet.</p>
                )}
              </div>
            )}

            {/* Notifications Sub-tab */}
            {settingsSubTab === 'notifications' && (
              <WalletTelegramSettings walletId={wallet.id} />
            )}

            {/* Advanced Sub-tab */}
            {settingsSubTab === 'advanced' && (
              <div className="space-y-4">
                {/* Technical Details - Compact */}
                <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
                  <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Technical Details</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div className="flex items-center justify-between col-span-2 py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                      <span className="text-sanctuary-500">Wallet ID</span>
                      <span className="font-mono text-xs text-sanctuary-700 dark:text-sanctuary-300 truncate max-w-[200px]" title={wallet.id}>{wallet.id}</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                      <span className="text-sanctuary-500">Type</span>
                      <span className="text-sanctuary-900 dark:text-sanctuary-100">{wallet.type}</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                      <span className="text-sanctuary-500">Script</span>
                      <span className="text-sanctuary-900 dark:text-sanctuary-100">
                        {wallet.scriptType === 'native_segwit' && 'Native SegWit'}
                        {wallet.scriptType === 'nested_segwit' && 'Nested SegWit'}
                        {wallet.scriptType === 'taproot' && 'Taproot'}
                        {wallet.scriptType === 'legacy' && 'Legacy'}
                        {!wallet.scriptType && 'Unknown'}
                      </span>
                    </div>
                    {wallet.descriptor && (
                      <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                        <span className="text-sanctuary-500">Path</span>
                        <span className="font-mono text-xs text-sanctuary-900 dark:text-sanctuary-100">
                          {(() => {
                            const match = wallet.descriptor.match(/\[([a-fA-F0-9]+)\/([^\]]+)\]/);
                            if (match) {
                              return `m/${match[2].replace(/h/g, "'")}`;
                            }
                            return wallet.derivationPath || 'Unknown';
                          })()}
                        </span>
                      </div>
                    )}
                    {wallet.quorum && (
                      <div className="flex items-center justify-between py-1.5 border-b border-sanctuary-100 dark:border-sanctuary-700">
                        <span className="text-sanctuary-500">Quorum</span>
                        <span className="text-sanctuary-900 dark:text-sanctuary-100">{getQuorumM(wallet.quorum)} of {getQuorumN(wallet.quorum, wallet.totalSigners)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sync Options */}
                <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">Sync Options</h3>
                    {wallet.lastSyncedAt && (
                      <span className="text-xs text-sanctuary-500">
                        Last synced {new Date(wallet.lastSyncedAt).toLocaleDateString()} at {new Date(wallet.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Sync Now</p>
                        <p className="text-xs text-sanctuary-500">Fetch latest transactions</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleSync}
                        disabled={syncing}
                      >
                        {syncing ? 'Syncing...' : 'Sync'}
                      </Button>
                    </div>
                    <div className="border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Full Resync</p>
                          <p className="text-xs text-sanctuary-500">Clear and re-sync from blockchain</p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleFullResync}
                          disabled={syncing}
                        >
                          {syncing ? 'Syncing...' : 'Resync'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Troubleshooting - show if wallet has issues */}
                {!wallet.descriptor && wallet.userRole === 'owner' && (
                  <div className="surface-elevated rounded-xl p-5 border border-warning-200 dark:border-warning-800 bg-warning-50/50 dark:bg-warning-900/20">
                    <h3 className="text-base font-medium mb-2 text-warning-700 dark:text-warning-300">Troubleshooting</h3>
                    <p className="text-xs text-warning-600 dark:text-warning-400 mb-4">
                      This wallet is missing a descriptor, which is needed to generate addresses.
                      If you have hardware devices linked, you can repair the wallet to regenerate the descriptor.
                    </p>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Repair Wallet</p>
                        <p className="text-xs text-sanctuary-500">Regenerate descriptor from linked devices</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleRepairWallet}
                        disabled={repairing}
                      >
                        {repairing ? 'Repairing...' : 'Repair'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Export Wallet */}
                <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
                  <h3 className="text-base font-medium mb-3 text-sanctuary-900 dark:text-sanctuary-100">Export Wallet</h3>
                  <p className="text-xs text-sanctuary-500 mb-4">Export your wallet configuration for backup or to import into other applications.</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Export Options</p>
                        <p className="text-xs text-sanctuary-500">QR code, JSON backup, descriptor, labels{isMultisigType(wallet.type) ? ', device setup' : ''}</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowExport(true)}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Export
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Danger Zone - only show if user is owner */}
                {wallet.userRole === 'owner' && (
                  <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
                    <button
                      onClick={() => setShowDangerZone(!showDangerZone)}
                      className="w-full p-4 flex items-center justify-between text-left hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-zen-vermilion" />
                        <span className="text-sm font-medium text-zen-vermilion">Danger Zone</span>
                      </div>
                      <ChevronDown className={`w-4 h-4 text-sanctuary-400 transition-transform ${showDangerZone ? 'rotate-180' : ''}`} />
                    </button>
                    {showDangerZone && (
                      <div className="p-4 pt-0 border-t border-sanctuary-200 dark:border-sanctuary-700">
                        <div className="flex items-center justify-between pt-3">
                          <div>
                            <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Delete Wallet</p>
                            <p className="text-xs text-sanctuary-500">This action cannot be undone</p>
                          </div>
                          <Button variant="danger" size="sm" onClick={() => setShowDelete(true)}>Delete</Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Export Modal */}
      {showExport && wallet && id && (
        <ExportModal
          walletId={id}
          walletName={wallet.name}
          walletType={wallet.type}
          scriptType={wallet.scriptType}
          descriptor={wallet.descriptor}
          quorum={wallet.quorum}
          totalSigners={wallet.totalSigners}
          devices={devices}
          onClose={() => setShowExport(false)}
          onError={handleError}
        />
      )}

      {/* Transaction Export Modal */}
      {showTransactionExport && wallet && (
        <TransactionExportModal
          walletId={wallet.id}
          walletName={wallet.name}
          onClose={() => setShowTransactionExport(false)}
        />
      )}

      {/* Receive Modal */}
      {showReceive && wallet && (
        <ReceiveModal
          walletId={wallet.id}
          addresses={addresses}
          network={wallet.network || 'mainnet'}
          onClose={() => setShowReceive(false)}
          onNavigateToSettings={() => { setShowReceive(false); setActiveTab('settings'); }}
        />
      )}

      {/* Address QR Code Modal */}
      {qrModalAddress && (
        <AddressQRModal
          address={qrModalAddress}
          onClose={() => setQrModalAddress(null)}
        />
      )}

      {/* Device Share Prompt Modal */}
      {deviceSharePrompt.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="surface-elevated rounded-2xl max-w-md w-full p-6 shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 animate-fade-in-up">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-primary-100 dark:bg-primary-900/30 mb-4">
                <HardDrive className="h-6 w-6 text-primary-600 dark:text-primary-400" />
              </div>
              <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">Share Devices?</h3>
              <p className="text-sm text-sanctuary-500 mb-4">
                <span className="font-medium text-sanctuary-700 dark:text-sanctuary-300">{deviceSharePrompt.targetUsername}</span> now has access to this wallet.
                Would you like to also share the following signing devices with them?
              </p>

              {/* Device List */}
              <div className="mb-6 space-y-2">
                {deviceSharePrompt.devices.map(device => (
                  <div key={device.id} className="flex items-center justify-between p-3 surface-secondary rounded-lg text-left">
                    <div className="flex items-center">
                      <div className="p-2 bg-sanctuary-200 dark:bg-sanctuary-700 rounded-lg mr-3">
                        <HardDrive className="w-4 h-4 text-sanctuary-600 dark:text-sanctuary-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{device.label}</p>
                        <p className="text-xs text-sanctuary-500 font-mono">{device.fingerprint}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex space-x-3">
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={dismissDeviceSharePrompt}
                  disabled={sharingLoading}
                >
                  Skip
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={handleShareDevicesWithUser}
                  disabled={sharingLoading}
                >
                  {sharingLoading ? 'Sharing...' : 'Share Devices'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDelete && wallet && (
        <DeleteModal
          walletName={wallet.name}
          onConfirm={async () => {
            if (id) {
              try {
                await walletsApi.deleteWallet(id);
                navigate('/wallets');
              } catch (err) {
                log.error('Failed to delete wallet', { error: err });
                handleError(err, 'Delete Failed');
              }
            }
          }}
          onClose={() => setShowDelete(false)}
        />
      )}

      {/* Transfer Ownership Modal */}
      {showTransferModal && wallet && (
        <TransferOwnershipModal
          resourceType="wallet"
          resourceId={wallet.id}
          resourceName={wallet.name}
          onClose={() => setShowTransferModal(false)}
          onTransferInitiated={() => {
            setShowTransferModal(false);
            handleTransferComplete();
          }}
        />
      )}
    </div>
  );
};
