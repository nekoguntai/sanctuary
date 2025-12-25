import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WalletType, getQuorumM } from '../types';
import type { Wallet } from '../src/api/wallets';
import { Plus, LayoutGrid, List as ListIcon, Wallet as WalletIcon, Upload, Users, ChevronUp, ChevronDown, ArrowUpDown, RefreshCw, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { Button } from './ui/Button';
import { getWalletIcon } from './ui/CustomIcons';
import { useCurrency } from '../contexts/CurrencyContext';
import { Amount } from './Amount';
import { useUser } from '../contexts/UserContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useWallets, useBalanceHistory } from '../hooks/queries/useWallets';

type ViewMode = 'grid' | 'table';
type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';
type SortField = 'name' | 'type' | 'devices' | 'network' | 'balance';
type SortOrder = 'asc' | 'desc';

export const WalletList: React.FC = () => {
  const [timeframe, setTimeframe] = useState<Timeframe>('1M');
  const navigate = useNavigate();
  const { format } = useCurrency();
  const { user, updatePreferences } = useUser();

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

  // Use React Query for wallet data with automatic caching and refetching
  const { data: wallets = [], isLoading: loading, error } = useWallets();

  // Sort wallets based on current sort settings
  const sortedWallets = useMemo(() => {
    if (!wallets.length) return wallets;

    return [...wallets].sort((a, b) => {
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
  }, [wallets, sortBy, sortOrder]);

  const totalBalance = wallets.reduce((acc, w) => acc + w.balance, 0);
  const walletIds = wallets.map(w => w.id);

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

      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Wallet Overview</h2>
          <p className="text-sanctuary-500">Manage your wallets and spending accounts</p>
        </div>
        <div className="flex items-center space-x-3">
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
            </div>
            <Button variant="secondary" onClick={() => navigate('/wallets/import')}>
                <Upload className="w-4 h-4 mr-2" />
                Import
            </Button>
            <Button onClick={() => navigate('/wallets/create')}>
                <Plus className="w-4 h-4 mr-2" />
                Create
            </Button>
        </div>
      </div>

      {/* Stats & Trends Card */}
      <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
         <div className="flex flex-col md:flex-row gap-8">
             <div className="md:w-1/3 flex flex-col justify-between">
                <div>
                    <h3 className="text-sm font-medium text-sanctuary-500 uppercase tracking-wide mb-1">Total Balance</h3>
                    <Amount
                      sats={totalBalance}
                      size="xl"
                      className="font-bold text-sanctuary-900 dark:text-sanctuary-50"
                    />
                </div>
                <div className="mt-6">
                    <p className="text-xs text-sanctuary-400">
                        Aggregated across {wallets.length} wallet{wallets.length !== 1 ? 's' : ''}.
                    </p>
                </div>
             </div>
             
             <div className="md:w-2/3">
                 <div className="flex justify-end mb-4">
                    <div className="flex space-x-1 surface-secondary p-1 rounded-lg">
                        {['1D', '1W', '1M', '1Y', 'ALL'].map((tf) => (
                            <button
                            key={tf}
                            onClick={() => setTimeframe(tf as Timeframe)}
                            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${timeframe === tf ? 'bg-white dark:bg-sanctuary-600 text-sanctuary-900 dark:text-sanctuary-50 shadow-sm' : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'}`}
                            >
                            {tf}
                            </button>
                        ))}
                    </div>
                 </div>
                 <div className="h-48 w-full">
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
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300">
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
                    <Amount
                      sats={wallet.balance}
                      size="lg"
                      className="font-bold text-sanctuary-900 dark:text-sanctuary-50"
                    />
                </div>

                <div className="flex items-center text-xs text-sanctuary-500 border-t border-sanctuary-100 dark:border-sanctuary-800 pt-3 mt-4">
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
                </div>
            );
            })}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
                    <thead className="surface-muted">
                        <tr>
                            <th
                              scope="col"
                              onClick={() => setSortBy('name')}
                              className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none"
                            >
                              <span className="inline-flex items-center gap-1">
                                Name
                                {sortBy === 'name' ? (
                                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                                ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                              </span>
                            </th>
                            <th
                              scope="col"
                              onClick={() => setSortBy('type')}
                              className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none"
                            >
                              <span className="inline-flex items-center gap-1">
                                Type
                                {sortBy === 'type' ? (
                                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                                ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                              </span>
                            </th>
                            <th
                              scope="col"
                              onClick={() => setSortBy('devices')}
                              className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none"
                            >
                              <span className="inline-flex items-center gap-1">
                                Devices
                                {sortBy === 'devices' ? (
                                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                                ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                              </span>
                            </th>
                            <th
                              scope="col"
                              onClick={() => setSortBy('network')}
                              className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none"
                            >
                              <span className="inline-flex items-center gap-1">
                                Network
                                {sortBy === 'network' ? (
                                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                                ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                              </span>
                            </th>
                            <th
                              scope="col"
                              className="px-6 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider"
                            >
                              Sync
                            </th>
                            <th
                              scope="col"
                              onClick={() => setSortBy('balance')}
                              className="px-6 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none"
                            >
                              <span className="inline-flex items-center gap-1 justify-end">
                                Balance
                                {sortBy === 'balance' ? (
                                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                                ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                              </span>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="surface-elevated divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
                        {sortedWallets.map((wallet) => {
                            const isMultisig = wallet.type === 'multi_sig';
                            const badgeClass = isMultisig
                                ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                                : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

                            const iconClass = isMultisig
                                ? 'text-warning-600 dark:text-warning-400'
                                : 'text-success-600 dark:text-success-400';

                            const walletTypeForIcon = isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;

                            return (
                                <tr
                                   key={wallet.id}
                                   onClick={() => navigate(`/wallets/${wallet.id}`)}
                                   className="hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 cursor-pointer transition-colors"
                                >
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            <div className="flex-shrink-0 h-8 w-8 rounded-full surface-secondary flex items-center justify-center">
                                                {getWalletIcon(walletTypeForIcon, `w-4 h-4 ${iconClass}`)}
                                            </div>
                                            <div className="ml-4">
                                                <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{wallet.name}</div>
                                                <div className="text-xs text-sanctuary-500 capitalize">{wallet.scriptType.replace('_', ' ')}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center gap-2">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeClass}`}>
                                                {isMultisig ? `${wallet.quorum} of ${wallet.totalSigners}` : 'Single Sig'}
                                            </span>
                                            {wallet.isShared && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800 dark:bg-primary-900/30 dark:text-primary-300">
                                                    <Users className="w-3 h-3" />
                                                    Shared
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm text-sanctuary-900 dark:text-sanctuary-100">
                                            {wallet.deviceCount} device{wallet.deviceCount !== 1 ? 's' : ''}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-sanctuary-500 capitalize">
                                        {wallet.network}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {wallet.syncInProgress ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400">
                                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                Syncing
                                            </span>
                                        ) : wallet.lastSyncStatus === 'success' ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs text-success-600 dark:text-success-400">
                                                <CheckCircle className="w-3.5 h-3.5" />
                                                Synced
                                            </span>
                                        ) : wallet.lastSyncStatus === 'failed' ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                                                <AlertCircle className="w-3.5 h-3.5" />
                                                Failed
                                            </span>
                                        ) : wallet.lastSyncStatus === 'retrying' ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs text-warning-600 dark:text-warning-400">
                                                <RefreshCw className="w-3.5 h-3.5" />
                                                Retrying
                                            </span>
                                        ) : wallet.lastSyncStatus === 'partial' ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs text-warning-600 dark:text-warning-400">
                                                <Clock className="w-3.5 h-3.5" />
                                                Partial
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 text-xs text-sanctuary-400">
                                                <Clock className="w-3.5 h-3.5" />
                                                Pending
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <Amount sats={wallet.balance} size="sm" className="font-bold text-sanctuary-900 dark:text-sanctuary-100 items-end" />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
      )}
    </div>
  );
};