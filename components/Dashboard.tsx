import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, Transaction, WalletType } from '../types';

// Local fee estimate type for dashboard display
interface DashboardFeeEstimate {
  fast: number;
  medium: number;
  slow: number;
}
import * as syncApi from '../src/api/sync';
import { TransactionList } from './TransactionList';
import { BlockVisualizer } from './BlockVisualizer';
import { Activity, TrendingUp, TrendingDown, Zap, Wallet as WalletIcon, CheckCircle2, XCircle, ChevronRight, Wifi, WifiOff, Bitcoin, RefreshCw, Check, AlertTriangle, Clock } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useCurrency } from '../contexts/CurrencyContext';
import { Amount } from './Amount';
import { useUser } from '../contexts/UserContext';
import { useWebSocket, useWebSocketEvent } from '../hooks/useWebSocket';
import { useNotifications } from '../contexts/NotificationContext';
import { createLogger } from '../utils/logger';
import { useWallets, useRecentTransactions, useInvalidateAllWallets, useBalanceHistory } from '../hooks/queries/useWallets';
import { useFeeEstimates, useBitcoinStatus, useMempoolData } from '../hooks/queries/useBitcoin';

const log = createLogger('Dashboard');

type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';

// Animated number component for smooth price transitions
const AnimatedPrice: React.FC<{ value: number | null; symbol: string }> = ({ value, symbol }) => {
  const [displayValue, setDisplayValue] = useState<number | null>(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevValueRef = useRef<number | null>(value);
  const animationRef = useRef<number>();

  useEffect(() => {
    // Handle null -> number transition (initial load)
    if (value !== null && prevValueRef.current === null) {
      setDisplayValue(value);
      prevValueRef.current = value;
      return;
    }

    // Handle number -> number transition (price update)
    if (value !== null && prevValueRef.current !== null && prevValueRef.current !== value) {
      setIsAnimating(true);
      const startValue = prevValueRef.current;
      const endValue = value;
      const duration = 800; // ms
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function (ease-out cubic)
        const easeOut = 1 - Math.pow(1 - progress, 3);

        const currentValue = startValue + (endValue - startValue) * easeOut;
        setDisplayValue(currentValue);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          setIsAnimating(false);
          prevValueRef.current = value;
        }
      };

      animationRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }
  }, [value]);

  const direction = value !== null && prevValueRef.current !== null
    ? value > prevValueRef.current ? 'up' : value < prevValueRef.current ? 'down' : 'none'
    : 'none';

  // Show placeholder if price not yet loaded
  if (displayValue === null) {
    return (
      <div className="relative">
        <span className="text-3xl font-bold text-sanctuary-400 dark:text-sanctuary-500">
          {symbol}-----
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <span
        className={`text-3xl font-bold transition-colors duration-300 ${
          isAnimating
            ? direction === 'up'
              ? 'text-success-600 dark:text-success-400'
              : direction === 'down'
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-sanctuary-900 dark:text-sanctuary-50'
            : 'text-sanctuary-900 dark:text-sanctuary-50'
        }`}
      >
        {symbol}{displayValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </span>
      {isAnimating && (
        <span className={`absolute -right-6 top-1/2 -translate-y-1/2 transition-opacity ${
          direction === 'up' ? 'text-success-500' : 'text-rose-500'
        }`}>
          {direction === 'up' ? '↑' : '↓'}
        </span>
      )}
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const { format, btcPrice, priceChange24h, currencySymbol, priceLoading, lastPriceUpdate, showFiat } = useCurrency();
  const { user } = useUser();
  const navigate = useNavigate();
  const [timeframe, setTimeframe] = useState<Timeframe>('1W');

  // WebSocket integration
  const { connected: wsConnected, state: wsState, subscribeWallet, subscribe } = useWebSocket();
  const { addNotification } = useNotifications();
  const invalidateAllWallets = useInvalidateAllWallets();

  // React Query hooks for data fetching
  const { data: apiWallets = [], isLoading: walletsLoading } = useWallets();
  const { data: feeEstimates, isLoading: feesLoading } = useFeeEstimates();
  const { data: bitcoinStatus, isLoading: statusLoading } = useBitcoinStatus();
  const { data: mempoolData, isLoading: mempoolLoading, refetch: refetchMempool, isFetching: mempoolRefreshing } = useMempoolData();

  // Convert API wallets to component format
  const wallets: Wallet[] = useMemo(() => apiWallets.map(w => ({
    id: w.id,
    name: w.name,
    type: w.type as WalletType,
    balance: w.balance,
    scriptType: w.scriptType,
    derivationPath: w.descriptor || '',
    fingerprint: w.fingerprint || '',
    label: w.name,
    xpub: '',
    lastSyncedAt: w.lastSyncedAt,
    lastSyncStatus: w.lastSyncStatus as 'success' | 'failed' | 'partial' | null,
    syncInProgress: w.syncInProgress,
  })), [apiWallets]);

  // Fetch recent transactions from all wallets using React Query
  const walletIds = useMemo(() => wallets.map(w => w.id), [wallets]);
  const { data: recentTxRaw = [], isLoading: txLoading } = useRecentTransactions(walletIds, 10);

  // Convert API transactions to component format
  const recentTx: Transaction[] = useMemo(() => recentTxRaw.map(tx => {
    const rawAmount = typeof tx.amount === 'string' ? parseInt(tx.amount, 10) : tx.amount;
    const amount = tx.type === 'sent' ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    return {
      id: tx.id,
      txid: tx.txid,
      walletId: tx.walletId,
      amount,
      fee: tx.fee ? (typeof tx.fee === 'string' ? parseInt(tx.fee, 10) : tx.fee) : undefined,
      confirmations: tx.confirmations,
      confirmed: tx.confirmations > 0,
      blockHeight: tx.blockHeight,
      timestamp: tx.blockTime ? new Date(tx.blockTime).getTime() : Date.now(),
      label: tx.label || '',
      type: tx.type,
    };
  }), [recentTxRaw]);

  // Derive fees from React Query data
  const fees: DashboardFeeEstimate | null = feeEstimates ? {
    fast: feeEstimates.fastest,
    medium: feeEstimates.hour,
    slow: feeEstimates.economy,
  } : null;

  // Derive node status from Bitcoin status
  const nodeStatus: 'unknown' | 'checking' | 'connected' | 'error' =
    statusLoading ? 'checking' :
    bitcoinStatus === undefined ? 'unknown' :
    bitcoinStatus?.connected ? 'connected' : 'error';

  // Derive mempool blocks from React Query data
  const mempoolBlocks = mempoolData ? [...mempoolData.mempool, ...mempoolData.blocks] : [];
  const queuedBlocksSummary = mempoolData?.queuedBlocksSummary || null;
  const lastMempoolUpdate = mempoolData ? new Date() : null;

  // Overall loading state
  const loading = walletsLoading && wallets.length === 0;

  // 24h price change from CoinGecko (via CurrencyContext)
  const priceChangePositive = priceChange24h !== null && priceChange24h >= 0;

  // Function to refresh mempool/block data
  const refreshMempoolData = () => {
    refetchMempool();
  };

  // Queue wallets for background sync on mount
  useEffect(() => {
    if (user && wallets.length > 0) {
      syncApi.queueUserWallets('normal').catch(err => {
        log.error('Failed to queue wallets for sync', { error: err });
      });
    }
  }, [user, wallets.length]);

  // Subscribe to all wallet events
  useEffect(() => {
    if (wallets.length > 0) {
      wallets.forEach(wallet => {
        subscribeWallet(wallet.id);
      });
    }
  }, [wallets, subscribeWallet]);

  // Subscribe to global block/mempool channel for real-time updates
  useEffect(() => {
    subscribe('blocks');
    subscribe('mempool');
  }, [subscribe]);

  // Note: Periodic mempool refresh is handled by React Query's refetchInterval

  // Handle transaction notifications
  useWebSocketEvent('transaction', (event) => {
    const { data } = event;

    addNotification({
      type: 'transaction',
      title: data.type === 'received' ? 'Bitcoin Received' : 'Bitcoin Sent',
      message: `${data.type === 'received' ? '+' : '-'}${(data.amount / 100000000).toFixed(8)} BTC • ${data.confirmations} confirmations`,
      duration: 10000,
      data,
    });

    // Invalidate wallet queries to refresh data
    invalidateAllWallets();
  }, [addNotification, invalidateAllWallets]);

  // Handle balance updates
  useWebSocketEvent('balance', (event) => {
    const { data } = event;

    if (Math.abs(data.change) > 10000) {
      addNotification({
        type: 'balance',
        title: 'Balance Updated',
        message: `${data.change > 0 ? '+' : ''}${(data.change / 100000000).toFixed(8)} BTC`,
        duration: 8000,
        data,
      });
    }

    // Invalidate wallet queries to refresh data
    invalidateAllWallets();
  }, [addNotification, invalidateAllWallets]);

  // Handle new block notifications
  useWebSocketEvent('block', (event) => {
    const { data } = event;

    addNotification({
      type: 'block',
      title: 'New Block Mined',
      message: `Block #${data.height.toLocaleString()} • ${data.transactionCount || 0} transactions`,
      duration: 6000,
      data,
    });

    // Refresh mempool data when a new block is mined
    refreshMempoolData();
  }, [addNotification, refreshMempoolData]);

  // Handle confirmation updates
  useWebSocketEvent('confirmation', (event) => {
    const { data } = event;

    if ([1, 3, 6].includes(data.confirmations)) {
      addNotification({
        type: 'confirmation',
        title: 'Transaction Confirmed',
        message: `${data.confirmations} confirmation${data.confirmations > 1 ? 's' : ''} reached`,
        duration: 5000,
        data,
      });
    }
  }, [addNotification]);

  // Handle sync completion - refresh wallet data when background sync finishes
  useWebSocketEvent('sync', (event) => {
    const { data } = event;

    // When a sync completes, invalidate wallet queries
    if (!data.inProgress && data.status === 'success') {
      invalidateAllWallets();
    }
  }, [invalidateAllWallets]);

  const totalBalance = wallets.reduce((acc, w) => acc + w.balance, 0);

  // Use the balance history hook for accurate chart data
  const { data: balanceHistoryData } = useBalanceHistory(walletIds, totalBalance, timeframe);

  // Convert to chart format (value -> sats for tooltip compatibility)
  const chartData = useMemo(() =>
    balanceHistoryData.map(d => ({ name: d.name, sats: d.value })),
    [balanceHistoryData]
  );

  const distributionColors = [
      'bg-primary-500',
      'bg-success-500',
      'bg-warning-500',
      'bg-zen-indigo',
      'bg-sanctuary-600',
      'bg-sanctuary-500'
  ];

  if (loading) {
    return <div className="flex h-full items-center justify-center"><div className="animate-spin text-sanctuary-400">⟳</div></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">

      {/* Block Visualizer Section */}
      <div className="surface-elevated rounded-2xl p-4 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
         <div className="flex items-center justify-between px-2 mb-2">
            <h4 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase">Bitcoin Network Status</h4>
            <div className="flex items-center space-x-4">
               {/* Manual refresh button */}
               <button
                  onClick={refreshMempoolData}
                  disabled={mempoolRefreshing}
                  className="flex items-center text-xs text-sanctuary-500 hover:text-sanctuary-700 dark:text-sanctuary-400 dark:hover:text-sanctuary-200 transition-colors disabled:opacity-50"
                  title="Refresh mempool data"
               >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1 ${mempoolRefreshing ? 'animate-spin' : ''}`} />
                  {lastMempoolUpdate && (
                     <span className="hidden sm:inline">
                        {lastMempoolUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                     </span>
                  )}
               </button>
               {/* WebSocket Status */}
               <div className="flex items-center text-xs">
                  {wsConnected ? (
                     <>
                        <Wifi className="w-3.5 h-3.5 text-success-500 mr-1.5" />
                        <span className="text-success-600 dark:text-success-400 font-medium">Live</span>
                     </>
                  ) : wsState === 'connecting' ? (
                     <>
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-warning-500 border-t-transparent animate-spin mr-1.5"></div>
                        <span className="text-warning-600 dark:text-warning-400 font-medium">Connecting</span>
                     </>
                  ) : (
                     <>
                        <WifiOff className="w-3.5 h-3.5 text-sanctuary-400 mr-1.5" />
                        <span className="text-sanctuary-500 dark:text-sanctuary-400">Offline</span>
                     </>
                  )}
               </div>
               {/* Sync Status */}
               <div className="flex items-center text-xs text-sanctuary-400">
                  <span className="w-2 h-2 rounded-full bg-success-500 mr-2 animate-pulse"></span>
                  Synced to Tip
               </div>
            </div>
         </div>
         <BlockVisualizer
            blocks={mempoolBlocks}
            queuedBlocksSummary={queuedBlocksSummary}
            explorerUrl={bitcoinStatus?.explorerUrl}
            onRefresh={refreshMempoolData}
         />
      </div>

      {/* Top Stats Row - 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* BTC Price Card - Compact with animated price */}
        <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wide">Bitcoin Price</h3>
            <div className="p-2 bg-warning-100 dark:bg-warning-900/30 rounded-xl">
              <Bitcoin className="w-5 h-5 text-warning-600 dark:text-warning-400" />
            </div>
          </div>

          <AnimatedPrice value={btcPrice} symbol={currencySymbol} />

          <div className="flex items-center justify-between mt-4">
            <div className={`flex items-center text-sm font-medium ${
              priceChangePositive
                ? 'text-success-600 dark:text-success-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}>
              {priceChangePositive ? (
                <TrendingUp className="w-4 h-4 mr-1" />
              ) : (
                <TrendingDown className="w-4 h-4 mr-1" />
              )}
              {priceChange24h !== null ? `${priceChangePositive ? '+' : ''}${priceChange24h.toFixed(2)}%` : '---'}
              <span className="text-sanctuary-400 font-normal ml-2">24h</span>
            </div>
            {lastPriceUpdate && (
              <span className="text-xs text-sanctuary-400">
                {lastPriceUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* Fee Estimation Card */}
        <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase">Fee Estimation</h4>
            <Zap className="w-4 h-4 text-warning-500" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center p-2.5 surface-secondary rounded-xl">
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-success-500 mr-2"></div>
                <span className="text-sm text-sanctuary-600 dark:text-sanctuary-300">Fast</span>
              </div>
              <span className="font-bold text-sm text-sanctuary-900 dark:text-sanctuary-100">{fees?.fast?.toFixed(1)} sat/vB</span>
            </div>
            <div className="flex justify-between items-center p-2.5 surface-secondary rounded-xl">
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-warning-500 mr-2"></div>
                <span className="text-sm text-sanctuary-600 dark:text-sanctuary-300">Normal</span>
              </div>
              <span className="font-bold text-sm text-sanctuary-900 dark:text-sanctuary-100">{fees?.medium?.toFixed(1)} sat/vB</span>
            </div>
            <div className="flex justify-between items-center p-2.5 surface-secondary rounded-xl">
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-sanctuary-400 mr-2"></div>
                <span className="text-sm text-sanctuary-600 dark:text-sanctuary-300">Slow</span>
              </div>
              <span className="font-bold text-sm text-sanctuary-900 dark:text-sanctuary-100">{fees?.slow?.toFixed(1)} sat/vB</span>
            </div>
          </div>
        </div>

        {/* Node Status Card */}
        <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase">Node Status</h4>
            {nodeStatus === 'connected' && <div className="h-2.5 w-2.5 rounded-full bg-success-500 animate-pulse"></div>}
            {nodeStatus === 'error' && <div className="h-2.5 w-2.5 rounded-full bg-rose-500"></div>}
            {nodeStatus === 'checking' && <div className="h-2.5 w-2.5 rounded-full bg-warning-500 animate-pulse"></div>}
            {nodeStatus === 'unknown' && <div className="h-2.5 w-2.5 rounded-full bg-sanctuary-400"></div>}
          </div>
          <div className="flex items-start">
            <div className={`p-2.5 rounded-xl mr-3 transition-colors flex-shrink-0 ${
              nodeStatus === 'connected'
                ? 'bg-success-100 text-success-600 dark:bg-success-900/30 dark:text-success-400'
                : nodeStatus === 'error'
                  ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                  : 'bg-sanctuary-100 text-sanctuary-500'
            }`}>
              <Zap className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                  Electrum Server
                </p>
                {nodeStatus === 'connected' && (
                  <span className="text-xs text-success-600 dark:text-success-400 flex items-center">
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Connected
                  </span>
                )}
                {nodeStatus === 'error' && (
                  <span className="text-xs text-rose-600 dark:text-rose-400 flex items-center">
                    <XCircle className="w-3 h-3 mr-1" />
                    Error
                  </span>
                )}
                {nodeStatus === 'checking' && (
                  <span className="text-xs text-sanctuary-400">Checking...</span>
                )}
                {nodeStatus === 'unknown' && (
                  <span className="text-xs text-sanctuary-400">Unknown</span>
                )}
              </div>
              {nodeStatus === 'connected' && bitcoinStatus && (
                <div className="mt-2 space-y-0.5">
                  {bitcoinStatus.blockHeight && (
                    <div className="flex items-center text-xs">
                      <span className="text-sanctuary-500 dark:text-sanctuary-400 w-14">Height:</span>
                      <span className="text-sanctuary-700 dark:text-sanctuary-300 font-mono">{bitcoinStatus.blockHeight.toLocaleString()}</span>
                    </div>
                  )}
                  {bitcoinStatus.host && (
                    <div className="flex items-center text-xs">
                      <span className="text-sanctuary-500 dark:text-sanctuary-400 w-14">Host:</span>
                      <span className="text-sanctuary-700 dark:text-sanctuary-300 font-mono truncate">
                        {bitcoinStatus.useSsl && <span className="text-success-500 mr-1">🔒</span>}
                        {bitcoinStatus.host}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {nodeStatus === 'error' && bitcoinStatus?.error && (
                <div className="mt-2 text-xs text-rose-600 dark:text-rose-400 truncate">
                  {bitcoinStatus.error}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Total Balance Card - Full Width */}
      <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex-shrink-0">
            <p className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wide">Total Balance</p>
            <Amount
              sats={totalBalance}
              size="xl"
              className="mt-1 font-bold text-sanctuary-900 dark:text-sanctuary-50"
            />
          </div>
          <div className="flex-1 lg:w-2/3">
            <div className="flex justify-end mb-2">
              <div className="flex space-x-1 surface-secondary p-1 rounded-lg">
                {['1D', '1W', '1M', '1Y', 'ALL'].map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf as Timeframe)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                      timeframe === tf
                        ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm'
                        : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorSats" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-primary-400)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--color-primary-400)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#a39e93'}} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', border: 'none', borderRadius: '8px', color: '#fff' }}
                    itemStyle={{ color: 'var(--color-primary-400)' }}
                  />
                  <Area type="monotone" dataKey="sats" stroke="var(--color-primary-400)" strokeWidth={2} fillOpacity={1} fill="url(#colorSats)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Wallet Breakdown Section (Table View) */}
      <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
         <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 flex items-center">
               <WalletIcon className="w-5 h-5 mr-2 text-sanctuary-400" />
               Wallet Distribution
            </h3>
         </div>

         {/* Visual Bar */}
         <div className="h-4 w-full surface-secondary rounded-full overflow-hidden flex mb-8">
            {wallets.length === 0 ? (
               <div className="w-full h-full bg-sanctuary-200 dark:bg-sanctuary-700"></div>
            ) : wallets.map((w, idx) => {
               const percent = totalBalance > 0 ? (w.balance / totalBalance) * 100 : 0;
               const colorClass = distributionColors[idx % distributionColors.length];

               return (
                  <div
                     key={w.id}
                     className={`h-full ${colorClass} border-r border-white dark:border-sanctuary-900 last:border-0`}
                     style={{ width: `${percent}%` }}
                     title={`${w.name}: ${percent.toFixed(1)}%`}
                  />
               );
            })}
         </div>

         {/* Wallet Table */}
         <div className="overflow-x-auto">
            <table className="min-w-full bg-transparent">
               <thead className="surface-secondary border-b border-sanctuary-100 dark:border-sanctuary-800">
                  <tr>
                     <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider w-8"></th>
                     <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Wallet Name</th>
                     <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Type</th>
                     <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Sync</th>
                     <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">Balance</th>
                     <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider w-10"></th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
                  {wallets.length === 0 && (
                     <tr className="bg-transparent">
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-sanctuary-500 bg-transparent">No wallets found. Create one to get started.</td>
                     </tr>
                  )}
                  {wallets.map((w, idx) => {
                     const isMultisig = w.type === WalletType.MULTI_SIG || w.type === 'multi_sig';
                     const dotColorClass = distributionColors[idx % distributionColors.length];

                     const badgeClass = isMultisig
                        ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
                        : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

                     return (
                        <tr
                           key={w.id}
                           onClick={() => navigate(`/wallets/${w.id}`)}
                           className="group hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 cursor-pointer transition-colors"
                           style={{ backgroundColor: 'transparent' }}
                        >
                           <td className="px-4 py-4 whitespace-nowrap">
                              <div className={`w-2.5 h-2.5 rounded-full ${dotColorClass}`}></div>
                           </td>
                           <td className="px-4 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">{w.name}</div>
                              <div className="text-xs text-sanctuary-500 hidden sm:block">{w.id}</div>
                           </td>
                           <td className="px-4 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}>
                                 {isMultisig ? 'Multisig' : 'Single Sig'}
                              </span>
                           </td>
                           <td className="px-4 py-4 whitespace-nowrap text-center">
                              {w.syncInProgress ? (
                                 <span className="inline-flex items-center text-primary-600 dark:text-primary-400" title="Syncing...">
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                 </span>
                              ) : w.lastSyncStatus === 'success' ? (
                                 <span className="inline-flex items-center text-success-600 dark:text-success-400" title={w.lastSyncedAt ? `Synced ${new Date(w.lastSyncedAt).toLocaleString()}` : 'Synced'}>
                                    <Check className="w-4 h-4" />
                                 </span>
                              ) : w.lastSyncStatus === 'failed' ? (
                                 <span className="inline-flex items-center text-rose-600 dark:text-rose-400" title="Sync failed">
                                    <AlertTriangle className="w-4 h-4" />
                                 </span>
                              ) : w.lastSyncedAt ? (
                                 <span className="inline-flex items-center text-sanctuary-400" title={`Cached from ${new Date(w.lastSyncedAt).toLocaleString()}`}>
                                    <Clock className="w-4 h-4" />
                                 </span>
                              ) : (
                                 <span className="inline-flex items-center text-warning-600 dark:text-warning-400" title="Never synced">
                                    <AlertTriangle className="w-4 h-4" />
                                 </span>
                              )}
                           </td>
                           <td className="px-4 py-4 whitespace-nowrap text-right">
                              <Amount sats={w.balance} size="sm" className="font-bold text-sanctuary-900 dark:text-sanctuary-100 items-end" />
                           </td>
                           <td className="px-4 py-4 whitespace-nowrap text-right">
                              <ChevronRight className="w-4 h-4 text-sanctuary-300 group-hover:text-sanctuary-500 transition-colors" />
                           </td>
                        </tr>
                     )
                  })}
               </tbody>
            </table>
         </div>
      </div>

      {/* Recent Activity */}
      <div className="surface-elevated rounded-2xl p-6 shadow-sm border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 flex items-center">
            <Activity className="w-5 h-5 mr-2 text-sanctuary-400" />
            Recent Activity
          </h3>
        </div>
        <TransactionList
           transactions={recentTx}
           showWalletBadge={true}
           wallets={wallets}
           onWalletClick={(id) => navigate(`/wallets/${id}`)}
           onTransactionClick={(tx) => navigate(`/wallets/${tx.walletId}`, { state: { highlightTxId: tx.id } })}
        />
      </div>
    </div>
  );
};
