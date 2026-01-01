import React, { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WalletType, getQuorumM } from '../types';
import type { Wallet } from '../src/api/wallets';
import { Plus, LayoutGrid, List as ListIcon, Wallet as WalletIcon, Upload, Users, ArrowUpDown, RefreshCw, CheckCircle, AlertCircle, Clock, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Button } from './ui/Button';
import { getWalletIcon } from './ui/CustomIcons';
import { useCurrency } from '../contexts/CurrencyContext';
import { Amount } from './Amount';
import { useUser } from '../contexts/UserContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useWallets, useBalanceHistory, useInvalidateAllWallets, usePendingTransactions } from '../hooks/queries/useWallets';
import type { PendingTransaction } from '../types';
import { NetworkTabs, TabNetwork } from './NetworkTabs';
import { NetworkSyncActions } from './NetworkSyncActions';
import { ConfigurableTable } from './ui/ConfigurableTable';
import { ColumnConfigButton } from './ui/ColumnConfigButton';
import {
  WALLET_COLUMNS,
  DEFAULT_WALLET_COLUMN_ORDER,
  DEFAULT_WALLET_VISIBLE_COLUMNS,
  mergeWalletColumnOrder,
} from './columns/walletColumns';
import { createWalletCellRenderers, WalletWithPending } from './cells/WalletCells';

type ViewMode = 'grid' | 'table';
type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';
type SortField = 'name' | 'type' | 'devices' | 'network' | 'balance';
type SortOrder = 'asc' | 'desc';

export const WalletList: React.FC = () => {
  const [timeframe, setTimeframe] = useState<Timeframe>('1M');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { format, formatFiat, showFiat } = useCurrency();
  const { user, updatePreferences } = useUser();
  const invalidateAllWallets = useInvalidateAllWallets();

  // Network tab state - persist in URL
  const networkFromUrl = searchParams.get('network') as TabNetwork | null;
  const [selectedNetwork, setSelectedNetwork] = useState<TabNetwork>(
    networkFromUrl && ['mainnet', 'testnet', 'signet'].includes(networkFromUrl) ? networkFromUrl : 'mainnet'
  );

  // Update URL when network changes
  const handleNetworkChange = (network: TabNetwork) => {
    setSelectedNetwork(network);
    if (network === 'mainnet') {
      searchParams.delete('network');
    } else {
      searchParams.set('network', network);
    }
    setSearchParams(searchParams, { replace: true });
  };

  // Get view mode from user preferences, fallback to 'grid'
  const viewMode = (user?.preferences?.viewSettings?.wallets?.layout as ViewMode) || 'grid';

  const setViewMode = (mode: ViewMode) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: { ...user?.preferences?.viewSettings?.wallets, layout: mode }
      }
    });
  };

  // Get sort settings from user preferences
  const sortBy = (user?.preferences?.viewSettings?.wallets?.sortBy as SortField) || 'name';
  const sortOrder = (user?.preferences?.viewSettings?.wallets?.sortOrder as SortOrder) || 'asc';

  const setSortBy = (field: SortField) => {
    // If clicking the same field, toggle order; otherwise set new field with asc
    const newOrder = field === sortBy ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: { ...user?.preferences?.viewSettings?.wallets, sortBy: field, sortOrder: newOrder }
      }
    });
  };

  // Get column configuration from user preferences
  const columnOrder = useMemo(
    () => mergeWalletColumnOrder(user?.preferences?.viewSettings?.wallets?.columnOrder),
    [user?.preferences?.viewSettings?.wallets?.columnOrder]
  );
  const visibleColumns = user?.preferences?.viewSettings?.wallets?.visibleColumns || DEFAULT_WALLET_VISIBLE_COLUMNS;

  const handleColumnOrderChange = (newOrder: string[]) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: { ...user?.preferences?.viewSettings?.wallets, columnOrder: newOrder }
      }
    });
  };

  const handleColumnVisibilityChange = (columnId: string, visible: boolean) => {
    const newVisible = visible
      ? [...visibleColumns, columnId]
      : visibleColumns.filter(id => id !== columnId);
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: { ...user?.preferences?.viewSettings?.wallets, visibleColumns: newVisible }
      }
    });
  };

  const handleColumnReset = () => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: {
          ...user?.preferences?.viewSettings?.wallets,
          columnOrder: DEFAULT_WALLET_COLUMN_ORDER,
          visibleColumns: DEFAULT_WALLET_VISIBLE_COLUMNS
        }
      }
    });
  };

  // Use React Query for wallet data with automatic caching and refetching
  const { data: wallets = [], isLoading: loading, error } = useWallets();

  // Filter wallets by selected network
  const filteredWallets = useMemo(() =>
    wallets.filter(w => w.network === selectedNetwork),
    [wallets, selectedNetwork]
  );

  // Count wallets per network for tabs
  const walletCounts = useMemo(() => ({
    mainnet: wallets.filter(w => w.network === 'mainnet').length,
    testnet: wallets.filter(w => w.network === 'testnet').length,
    signet: wallets.filter(w => w.network === 'signet').length,
  }), [wallets]);

  // Sort wallets based on current sort settings
  const sortedWallets = useMemo(() => {
    if (!filteredWallets.length) return filteredWallets;

    return [...filteredWallets].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'devices':
          comparison = a.deviceCount - b.deviceCount;
          break;
        case 'network':
          comparison = a.network.localeCompare(b.network);
          break;
        case 'balance':
          comparison = a.balance - b.balance;
          break;
        default:
          comparison = 0;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredWallets, sortBy, sortOrder]);

  const totalBalance = filteredWallets.reduce((acc, w) => acc + w.balance, 0);
  const walletIds = filteredWallets.map(w => w.id);

  // Fetch pending transactions for all filtered wallets
  const { data: pendingTransactions } = usePendingTransactions(walletIds);

  // Calculate net pending balance per wallet (incoming - outgoing)
  const pendingByWallet = useMemo(() => {
    const result: Record<string, { net: number; count: number; hasIncoming: boolean; hasOutgoing: boolean }> = {};

    for (const tx of pendingTransactions) {
      if (!result[tx.walletId]) {
        result[tx.walletId] = { net: 0, count: 0, hasIncoming: false, hasOutgoing: false };
      }
      // Net is positive for incoming, negative for outgoing
      result[tx.walletId].net += tx.type === 'received' ? tx.amount : -tx.amount;
      result[tx.walletId].count++;
      if (tx.type === 'received') {
        result[tx.walletId].hasIncoming = true;
      } else {
        result[tx.walletId].hasOutgoing = true;
      }
    }

    return result;
  }, [pendingTransactions]);

  // Create wallets with pending data for ConfigurableTable
  const walletsWithPending: WalletWithPending[] = useMemo(() => {
    return sortedWallets.map(wallet => ({
      ...wallet,
      pendingData: pendingByWallet[wallet.id],
    }));
  }, [sortedWallets, pendingByWallet]);

  // Create cell renderers with currency formatting
  const cellRenderers = useMemo(
    () => createWalletCellRenderers({ format, formatFiat, showFiat }),
    [format, formatFiat, showFiat]
  );

  // Fetch real balance history from transactions
  const { data: chartData, isLoading: chartLoading } = useBalanceHistory(walletIds, totalBalance, timeframe);

  // Loading state
  if (loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading wallets...</div>;
  }

  // Empty state - show clean "create your first wallet" UI
  if (wallets.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in pb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Wallet Overview</h2>
            <p className="text-sanctuary-500">Manage your wallets and spending accounts</p>
          </div>
        </div>

        <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full surface-secondary mb-4">
            <WalletIcon className="w-8 h-8 text-sanctuary-400" />
          </div>
          <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">No Wallets Yet</h3>
          <p className="text-sanctuary-500 mb-6 max-w-md mx-auto">
            Create your first wallet to start managing your Bitcoin. Connect your hardware devices and build single-sig or multi-sig wallets with full self-custody.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => navigate('/wallets/create')}>
              <Plus className="w-4 h-4 mr-2" />
              Create Wallet
            </Button>
            <Button variant="secondary" onClick={() => navigate('/wallets/import')}>
              <Upload className="w-4 h-4 mr-2" />
              Import Wallet
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-8">

      {/* Network Tabs */}
      <div className="flex items-center justify-between">
        <NetworkTabs
          selectedNetwork={selectedNetwork}
          onNetworkChange={handleNetworkChange}
          walletCounts={walletCounts}
        />
      </div>

      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">
            {selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1)} Wallets
          </h2>
          <p className="text-sanctuary-500">Manage your {selectedNetwork} wallets and spending accounts</p>
        </div>
        <div className="flex items-center space-x-2">
            {/* Sort dropdown - shown in grid view */}
            {viewMode === 'grid' && (
              <div className="relative">
                <select
                  value={`${sortBy}-${sortOrder}`}
                  onChange={(e) => {
                    const [field, order] = e.target.value.split('-') as [SortField, SortOrder];
                    updatePreferences({
                      viewSettings: {
                        ...user?.preferences?.viewSettings,
                        wallets: { ...user?.preferences?.viewSettings?.wallets, sortBy: field, sortOrder: order }
                      }
                    });
                  }}
                  className="appearance-none surface-elevated border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg px-3 py-2 pr-8 text-sm text-sanctuary-700 dark:text-sanctuary-300 cursor-pointer hover:border-sanctuary-300 dark:hover:border-sanctuary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="name-asc">Name (A-Z)</option>
                  <option value="name-desc">Name (Z-A)</option>
                  <option value="balance-desc">Balance (High-Low)</option>
                  <option value="balance-asc">Balance (Low-High)</option>
                  <option value="type-asc">Type (A-Z)</option>
                  <option value="type-desc">Type (Z-A)</option>
                  <option value="devices-desc">Devices (Most)</option>
                  <option value="devices-asc">Devices (Least)</option>
                  <option value="network-asc">Network (A-Z)</option>
                </select>
                <ArrowUpDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400 pointer-events-none" />
              </div>
            )}
            <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                >
                    <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                    onClick={() => setViewMode('table')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'table' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                >
                    <ListIcon className="w-4 h-4" />
                </button>
                {/* Column Config - only in table view */}
                {viewMode === 'table' && (
                  <ColumnConfigButton
                    columns={WALLET_COLUMNS}
                    columnOrder={columnOrder}
                    visibleColumns={visibleColumns}
                    onOrderChange={handleColumnOrderChange}
                    onVisibilityChange={handleColumnVisibilityChange}
                    onReset={handleColumnReset}
                    defaultOrder={DEFAULT_WALLET_COLUMN_ORDER}
                    defaultVisible={DEFAULT_WALLET_VISIBLE_COLUMNS}
                  />
                )}
            </div>
            {/* Compact Sync Actions */}
            <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
              <NetworkSyncActions
                network={selectedNetwork}
                walletCount={filteredWallets.length}
                compact={true}
                onSyncStarted={() => invalidateAllWallets()}
              />
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/wallets/import')}>
                <Upload className="w-4 h-4 mr-1.5" />
                Import
            </Button>
            <Button size="sm" onClick={() => navigate('/wallets/create')}>
                <Plus className="w-4 h-4 mr-1.5" />
                Create
            </Button>
        </div>
      </div>

      {/* Stats & Trends Card - Compact */}
      <div className="surface-elevated rounded-2xl p-4 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
         <div className="flex flex-col md:flex-row gap-6">
             <div className="md:w-1/3 flex flex-col justify-between">
                <div>
                    <h3 className="text-xs font-medium text-sanctuary-500 uppercase tracking-wide mb-1">Total Balance</h3>
                    <Amount
                      sats={totalBalance}
                      size="lg"
                      className="font-bold text-sanctuary-900 dark:text-sanctuary-50"
                    />
                    <p className="text-xs text-sanctuary-400 mt-2">
                        {filteredWallets.length} {selectedNetwork} wallet{filteredWallets.length !== 1 ? 's' : ''}
                    </p>
                </div>
             </div>

             <div className="md:w-2/3">
                 <div className="flex justify-end mb-2">
                    <div className="flex space-x-0.5 surface-secondary p-0.5 rounded-lg">
                        {['1D', '1W', '1M', '1Y', 'ALL'].map((tf) => (
                            <button
                            key={tf}
                            onClick={() => setTimeframe(tf as Timeframe)}
                            className={`px-2 py-0.5 text-xs font-medium rounded transition-colors ${timeframe === tf ? 'bg-white dark:bg-sanctuary-600 text-sanctuary-900 dark:text-sanctuary-50 shadow-sm' : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'}`}
                            >
                            {tf}
                            </button>
                        ))}
                    </div>
                 </div>
                 <div className="h-36 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                            <defs>
                                <linearGradient id="colorOverview" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--color-success-500)" stopOpacity={0.2}/>
                                    <stop offset="95%" stopColor="var(--color-success-500)" stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#a39e93'}} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#1c1c1e', border: 'none', borderRadius: '8px', color: '#fff' }}
                                itemStyle={{ color: 'var(--color-success-500)' }}
                            />
                            <Area type="monotone" dataKey="value" stroke="var(--color-success-500)" strokeWidth={2} fillOpacity={1} fill="url(#colorOverview)" />
                        </AreaChart>
                    </ResponsiveContainer>
                 </div>
             </div>
         </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedWallets.map((wallet) => {
            const isMultisig = wallet.type === 'multi_sig';

            // Standardized Badge Styling (Matching Recent Activity)
            const badgeColorClass = isMultisig
                ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

            const iconColorClass = isMultisig
                ? 'bg-warning-50 dark:bg-warning-900/50 text-warning-600 dark:text-warning-400'
                : 'bg-success-50 dark:bg-success-900/50 text-success-600 dark:text-success-400';

            // Map API type to WalletType for icon
            const walletTypeForIcon = isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;

            return (
                <div
                key={wallet.id}
                onClick={() => navigate(`/wallets/${wallet.id}`)}
                className="group surface-elevated rounded-2xl p-6 border border-sanctuary-200 dark:border-sanctuary-800 shadow-sm hover:shadow-md hover:border-primary-300 dark:hover:border-primary-600 transition-all cursor-pointer relative overflow-hidden"
                >
                <div className="flex justify-between items-start mb-6">
                    <div className={`p-3 rounded-xl ${iconColorClass}`}>
                    {getWalletIcon(walletTypeForIcon, "w-6 h-6")}
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${badgeColorClass}`}>
                            {isMultisig ? 'Multisig' : 'Single Sig'}
                        </span>
                        {wallet.isShared && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-shared-100 text-shared-800 dark:bg-shared-100 dark:text-shared-700">
                                <Users className="w-3 h-3" />
                                Shared
                            </span>
                        )}
                    </div>
                </div>

                <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-1 group-hover:text-primary-600 dark:group-hover:text-primary-300 transition-colors">
                    {wallet.name}
                </h3>

                <div className="mt-2 mb-4">
                    {/* BTC balance with inline net pending and type icons */}
                    <div className="text-lg font-bold text-sanctuary-900 dark:text-sanctuary-50 flex items-center gap-1.5">
                      <span>{format(wallet.balance)}</span>
                      {pendingByWallet[wallet.id] && (
                        <>
                          {/* Pending type icons */}
                          <span className="inline-flex items-center gap-0.5">
                            {pendingByWallet[wallet.id].hasIncoming && (
                              <span title="Pending received"><ArrowDownLeft className="w-3.5 h-3.5 text-success-500" /></span>
                            )}
                            {pendingByWallet[wallet.id].hasOutgoing && (
                              <span title="Pending sent"><ArrowUpRight className="w-3.5 h-3.5 text-sent-500" /></span>
                            )}
                          </span>
                          {/* Net pending amount */}
                          {pendingByWallet[wallet.id].net !== 0 && (
                            <span className={`text-sm font-normal ${
                              pendingByWallet[wallet.id].net > 0
                                ? 'text-success-600 dark:text-success-400'
                                : 'text-sent-600 dark:text-sent-400'
                            }`}>
                              ({pendingByWallet[wallet.id].net > 0 ? '+' : ''}{format(pendingByWallet[wallet.id].net)})
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {/* Fiat balance with inline net pending */}
                    {showFiat && formatFiat(wallet.balance) && (
                      <div className="text-sm text-primary-500 dark:text-primary-400">
                        {formatFiat(wallet.balance)}
                        {pendingByWallet[wallet.id] && pendingByWallet[wallet.id].net !== 0 && (
                          <span className={`ml-1 text-xs ${
                            pendingByWallet[wallet.id].net > 0
                              ? 'text-success-600 dark:text-success-400'
                              : 'text-sent-600 dark:text-sent-400'
                          }`}>
                            ({pendingByWallet[wallet.id].net > 0 ? '+' : ''}{formatFiat(pendingByWallet[wallet.id].net)})
                          </span>
                        )}
                      </div>
                    )}
                </div>

                <div className="flex items-center justify-between text-xs border-t border-sanctuary-100 dark:border-sanctuary-800 pt-3 mt-4">
                    <div className="flex items-center text-sanctuary-500">
                      <span className="text-sanctuary-400 capitalize">{wallet.scriptType.replace('_', ' ')}</span>
                      <span className="mx-2 text-sanctuary-300">•</span>
                      <span className="text-sanctuary-400">{wallet.deviceCount} device{wallet.deviceCount !== 1 ? 's' : ''}</span>
                      {wallet.quorum && wallet.totalSigners && (
                          <>
                              <span className="mx-2 text-sanctuary-300">•</span>
                              <span className="text-sanctuary-400">{getQuorumM(wallet.quorum)} of {wallet.totalSigners}</span>
                          </>
                      )}
                    </div>
                    {/* Sync Status */}
                    {wallet.syncInProgress ? (
                      <span title="Syncing"><RefreshCw className="w-3.5 h-3.5 text-primary-500 animate-spin" /></span>
                    ) : wallet.lastSyncStatus === 'success' ? (
                      <span title="Synced"><CheckCircle className="w-3.5 h-3.5 text-success-500" /></span>
                    ) : wallet.lastSyncStatus === 'failed' ? (
                      <span title="Sync failed"><AlertCircle className="w-3.5 h-3.5 text-rose-500" /></span>
                    ) : wallet.lastSyncStatus === 'retrying' ? (
                      <span title="Retrying"><RefreshCw className="w-3.5 h-3.5 text-amber-500" /></span>
                    ) : (
                      <span title="Pending sync"><Clock className="w-3.5 h-3.5 text-sanctuary-400" /></span>
                    )}
                </div>
                </div>
            );
            })}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <ConfigurableTable<WalletWithPending>
          columns={WALLET_COLUMNS}
          columnOrder={columnOrder}
          visibleColumns={visibleColumns}
          data={walletsWithPending}
          keyExtractor={(wallet) => wallet.id}
          cellRenderers={cellRenderers}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={(field) => setSortBy(field as SortField)}
          onRowClick={(wallet) => navigate(`/wallets/${wallet.id}`)}
          emptyMessage="No wallets found"
        />
      )}

      </div>
  );
};