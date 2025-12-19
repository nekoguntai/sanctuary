import React, { useState, useEffect, useRef, useMemo, useCallback, forwardRef } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import { Transaction, Wallet, WalletType, Label } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { Amount } from './Amount';
import * as bitcoinApi from '../src/api/bitcoin';
import * as labelsApi from '../src/api/labels';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Clock, Tag, CheckCircle2, ShieldCheck, ExternalLink, Copy, X, Check, Edit2, TrendingUp } from 'lucide-react';
import { TransactionActions } from './TransactionActions';
import { LabelBadges } from './LabelSelector';
import { createLogger } from '../utils/logger';
import type { TransactionStats } from '../src/api/transactions';

const log = createLogger('TransactionList');

// Stable empty arrays to prevent re-renders when props aren't provided
const EMPTY_WALLETS: Wallet[] = [];
const EMPTY_ADDRESSES: string[] = [];

interface TransactionListProps {
  transactions: Transaction[];
  showWalletBadge?: boolean;
  wallets?: Wallet[];
  walletAddresses?: string[]; // All addresses belonging to this wallet for consolidation detection
  onWalletClick?: (walletId: string) => void;
  onTransactionClick?: (transaction: Transaction) => void;
  highlightedTxId?: string;
  onLabelsChange?: () => void;
  canEdit?: boolean; // Whether user can edit labels (default: true for backwards compat)
  confirmationThreshold?: number; // Number of confirmations required (from system settings)
  deepConfirmationThreshold?: number; // Number of confirmations for "deeply confirmed" status
  walletBalance?: number; // Current wallet balance in sats for showing running balance column
  transactionStats?: TransactionStats; // Pre-computed stats from API (for all transactions, not just displayed)
}

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  showWalletBadge = false,
  wallets = EMPTY_WALLETS,
  walletAddresses = EMPTY_ADDRESSES,
  onWalletClick,
  onTransactionClick,
  highlightedTxId,
  onLabelsChange,
  canEdit = true,
  confirmationThreshold = 1,
  deepConfirmationThreshold = 3,
  walletBalance,
  transactionStats,
}) => {
  const { format } = useCurrency();
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [explorerUrl, setExplorerUrl] = useState('https://mempool.space');
  const [copied, setCopied] = useState(false);

  // Label editing state
  const [editingLabels, setEditingLabels] = useState(false);
  const [availableLabels, setAvailableLabels] = useState<Label[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [savingLabels, setSavingLabels] = useState(false);

  // Load explorer URL from server config
  useEffect(() => {
    bitcoinApi.getStatus().then(status => {
      if (status.explorerUrl) setExplorerUrl(status.explorerUrl);
    }).catch(err => {
      log.error('Failed to fetch explorer URL', { error: err });
    });
  }, []);

  // Virtuoso ref for scroll control
  const virtuosoRef = useRef<any>(null);

  useEffect(() => {
    if (highlightedTxId && transactions.length > 0 && virtuosoRef.current) {
      const index = transactions.findIndex(tx => tx.id === highlightedTxId);
      if (index !== -1) {
        setTimeout(() => {
          virtuosoRef.current?.scrollToIndex({
            index,
            align: 'center',
            behavior: 'smooth',
          });
        }, 100);
      }
    }
  }, [highlightedTxId, transactions]);

  const getWallet = (id: string) => {
    return wallets.find(w => w.id === id);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      log.error('Failed to copy', { error: err });
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleTxClick = (tx: Transaction) => {
    if (onTransactionClick) {
      onTransactionClick(tx);
    } else {
      setSelectedTx(tx);
      setEditingLabels(false);
    }
  };

  // Load labels when opening edit mode
  const handleEditLabels = async (tx: Transaction) => {
    setEditingLabels(true);
    setSelectedLabelIds(tx.labels?.map(l => l.id) || []);
    try {
      const labels = await labelsApi.getLabels(tx.walletId);
      setAvailableLabels(labels);
    } catch (err) {
      log.error('Failed to load labels', { error: err });
    }
  };

  const handleSaveLabels = async () => {
    if (!selectedTx) return;
    try {
      setSavingLabels(true);
      await labelsApi.setTransactionLabels(selectedTx.id, selectedLabelIds);
      // Update the selected transaction's labels locally
      const updatedLabels = availableLabels.filter(l => selectedLabelIds.includes(l.id));
      setSelectedTx({ ...selectedTx, labels: updatedLabels });
      setEditingLabels(false);
      onLabelsChange?.();
    } catch (err) {
      log.error('Failed to save labels', { error: err });
    } finally {
      setSavingLabels(false);
    }
  };

  const handleToggleLabel = (labelId: string) => {
    setSelectedLabelIds(prev =>
      prev.includes(labelId)
        ? prev.filter(id => id !== labelId)
        : [...prev, labelId]
    );
  };

  // Helper to get transaction type info
  const getTxTypeInfo = (tx: Transaction) => {
    const isReceive = tx.amount > 0;
    const isConsolidation = (
      tx.type === 'consolidation' ||
      (tx.amount < 0 && tx.counterpartyAddress && walletAddresses.includes(tx.counterpartyAddress)) ||
      (tx.amount > 0 && tx.counterpartyAddress && walletAddresses.includes(tx.counterpartyAddress))
    );
    return { isReceive, isConsolidation };
  };

  // Calculate transaction statistics
  // IMPORTANT: This useMemo must be called BEFORE any early returns to follow React's rules of hooks
  const txStats = useMemo(() => {
    if (transactionStats) {
      return {
        total: transactionStats.totalCount,
        received: transactionStats.receivedCount,
        sent: transactionStats.sentCount,
        consolidations: transactionStats.consolidationCount,
        totalReceived: transactionStats.totalReceived,
        totalSent: transactionStats.totalSent,
        totalFees: transactionStats.totalFees,
      };
    }

    let received = 0;
    let sent = 0;
    let consolidations = 0;
    let totalReceived = 0;
    let totalSent = 0;
    let totalFees = 0;

    for (const tx of transactions) {
      const isReceive = tx.amount > 0;
      const isConsolidation = (
        tx.type === 'consolidation' ||
        (tx.amount < 0 && tx.counterpartyAddress && walletAddresses.includes(tx.counterpartyAddress)) ||
        (tx.amount > 0 && tx.counterpartyAddress && walletAddresses.includes(tx.counterpartyAddress))
      );

      if (isConsolidation) {
        consolidations++;
        totalFees += Math.abs(tx.amount);
      } else if (isReceive) {
        received++;
        totalReceived += tx.amount;
      } else {
        sent++;
        totalSent += Math.abs(tx.amount);
        if (tx.fee) {
          totalFees += tx.fee;
        }
      }
    }

    return {
      total: transactions.length,
      received,
      sent,
      consolidations,
      totalReceived,
      totalSent,
      totalFees,
    };
  }, [transactions, walletAddresses, transactionStats]);

  // Early return AFTER all hooks have been called
  if (transactions.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sanctuary-400 dark:text-sanctuary-500">No transactions found.</p>
      </div>
    );
  }

  return (
    <>
      {/* Transaction Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="text-xs text-sanctuary-500 uppercase">Total</div>
          <div className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">{txStats.total}</div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center gap-1 text-xs text-sanctuary-500 uppercase">
            <ArrowDownLeft className="w-3 h-3 text-success-500" />
            Received
          </div>
          <div className="text-lg font-semibold text-success-600 dark:text-success-400">{txStats.received}</div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center gap-1 text-xs text-sanctuary-500 uppercase">
            <ArrowUpRight className="w-3 h-3 text-sanctuary-500" />
            Sent
          </div>
          <div className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">{txStats.sent}</div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="flex items-center gap-1 text-xs text-sanctuary-500 uppercase">
            <RefreshCw className="w-3 h-3 text-primary-500" />
            Consolidations
          </div>
          <div className="text-lg font-semibold text-primary-600 dark:text-primary-400">{txStats.consolidations}</div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="text-xs text-success-500 uppercase">Total In</div>
          <div className="text-sm font-semibold text-success-600 dark:text-success-400">
            <Amount sats={txStats.totalReceived} size="sm" />
          </div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="text-xs text-sanctuary-500 uppercase">Total Out</div>
          <div className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100">
            <Amount sats={txStats.totalSent} size="sm" />
          </div>
        </div>
        <div className="surface-elevated px-3 py-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <div className="text-xs text-warning-500 uppercase">Fees Paid</div>
          <div className="text-sm font-semibold text-warning-600 dark:text-warning-400">
            <Amount sats={txStats.totalFees} size="sm" />
          </div>
        </div>
      </div>

      {/* Virtualized Transaction Table */}
      <TableVirtuoso
        ref={virtuosoRef}
        style={{ height: Math.min(transactions.length * 52 + 48, 600) }}
        data={transactions}
        fixedHeaderContent={() => (
          <tr className="surface-muted">
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Date</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Type</th>
            <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Amount</th>
            {walletBalance !== undefined && (
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Balance</th>
            )}
            <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Confs</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Labels</th>
            {showWalletBadge && (
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 uppercase tracking-wider">Wallet</th>
            )}
          </tr>
        )}
        components={{
          Table: ({ style, ...props }) => (
            <table {...props} style={style} className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800" />
          ),
          TableBody: forwardRef(({ style, ...props }, ref) => (
            <tbody {...props} ref={ref} style={style} className="divide-y divide-sanctuary-200 dark:divide-sanctuary-800" />
          )),
        }}
        itemContent={(index, tx) => {
          const { isReceive, isConsolidation } = getTxTypeInfo(tx);
          const isHighlighted = highlightedTxId === tx.id;
          const txWallet = getWallet(tx.walletId);
          const isMultisig = txWallet?.type === WalletType.MULTI_SIG || txWallet?.type === 'multi_sig';

          const badgeClass = isMultisig
            ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
            : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

          return (
            <>
              {/* Date */}
              <td
                className={`px-4 py-3 whitespace-nowrap text-sm text-sanctuary-700 dark:text-sanctuary-300 font-medium cursor-pointer transition-colors ${
                  isHighlighted
                    ? 'bg-warning-50 dark:bg-warning-950/20'
                    : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50'
                }`}
                onClick={() => handleTxClick(tx)}
              >
                {new Date(tx.timestamp).toLocaleDateString()}
              </td>

              {/* Type */}
              <td
                className={`px-4 py-3 whitespace-nowrap cursor-pointer transition-colors ${
                  isHighlighted
                    ? 'bg-warning-50 dark:bg-warning-950/20'
                    : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50'
                }`}
                onClick={() => handleTxClick(tx)}
              >
                <div className="flex items-center space-x-2">
                  <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${
                    isConsolidation
                      ? 'bg-primary-100 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                      : isReceive
                      ? 'bg-success-100 text-success-600 dark:bg-success-500/10 dark:text-success-400'
                      : 'bg-sanctuary-200 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400'
                  }`}>
                    {isConsolidation ? <RefreshCw className="h-3.5 w-3.5" /> : isReceive ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                  </span>
                  <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                    {isConsolidation ? 'Consolidation' : isReceive ? 'Received' : 'Sent'}
                  </span>
                </div>
              </td>

              {/* Amount */}
              <td
                className={`px-4 py-3 whitespace-nowrap text-right cursor-pointer transition-colors ${
                  isHighlighted
                    ? 'bg-warning-50 dark:bg-warning-950/20'
                    : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50'
                }`}
                onClick={() => handleTxClick(tx)}
              >
                <span className={`text-sm font-semibold ${
                  isConsolidation
                    ? 'text-primary-600 dark:text-primary-400'
                    : isReceive
                    ? 'text-success-600 dark:text-success-400'
                    : 'text-sanctuary-900 dark:text-sanctuary-100'
                }`}>
                  <Amount
                    sats={tx.amount}
                    showSign={isReceive}
                    size="sm"
                    className="justify-end"
                  />
                </span>
              </td>

              {/* Balance (after this transaction) */}
              {walletBalance !== undefined && (
                <td
                  className={`px-4 py-3 whitespace-nowrap text-right cursor-pointer transition-colors ${
                    isHighlighted
                      ? 'bg-warning-50 dark:bg-warning-950/20'
                      : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50'
                  }`}
                  onClick={() => handleTxClick(tx)}
                >
                  <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                    <Amount
                      sats={tx.balanceAfter ?? 0}
                      size="sm"
                      className="justify-end"
                    />
                  </span>
                </td>
              )}

              {/* Confirmations */}
              <td
                className={`px-4 py-3 whitespace-nowrap text-center cursor-pointer transition-colors ${
                  isHighlighted
                    ? 'bg-warning-50 dark:bg-warning-950/20'
                    : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50'
                }`}
                onClick={() => handleTxClick(tx)}
              >
                <span
                  className="inline-flex items-center text-sm font-medium"
                  title={tx.confirmations > 0 ? `${tx.confirmations.toLocaleString()} confirmation${tx.confirmations !== 1 ? 's' : ''}` : 'Pending confirmation'}
                >
                  {tx.confirmations >= deepConfirmationThreshold ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 mr-1 text-indigo-500" />
                      <span className="text-indigo-600 dark:text-indigo-400">{tx.confirmations?.toLocaleString() || ''}</span>
                    </>
                  ) : tx.confirmations >= confirmationThreshold ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-success-500" />
                      <span className="text-sanctuary-700 dark:text-sanctuary-300">{tx.confirmations}/{deepConfirmationThreshold}</span>
                    </>
                  ) : tx.confirmations > 0 ? (
                    <span className="inline-flex items-center text-primary-600 dark:text-primary-400">
                      <Clock className="w-3.5 h-3.5 mr-1" />
                      {tx.confirmations}/{deepConfirmationThreshold}
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-warning-600 dark:text-warning-400">
                      <Clock className="w-3.5 h-3.5 mr-1" />
                      Pending
                    </span>
                  )}
                </span>
              </td>

              {/* Labels */}
              <td
                className={`px-4 py-3 cursor-pointer transition-colors ${
                  isHighlighted
                    ? 'bg-warning-50 dark:bg-warning-950/20'
                    : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50'
                }`}
                onClick={() => handleTxClick(tx)}
              >
                {(tx.labels && tx.labels.length > 0) ? (
                  <LabelBadges labels={tx.labels} maxDisplay={2} size="sm" />
                ) : tx.label ? (
                  <span className="inline-flex items-center surface-secondary px-1.5 py-0.5 rounded text-xs text-sanctuary-600 dark:text-sanctuary-300">
                    <Tag className="w-2.5 h-2.5 mr-1" />
                    {tx.label}
                  </span>
                ) : (
                  <span className="text-sanctuary-300 dark:text-sanctuary-600">-</span>
                )}
              </td>

              {/* Wallet Badge (optional) */}
              {showWalletBadge && (
                <td
                  className={`px-4 py-3 whitespace-nowrap cursor-pointer transition-colors ${
                    isHighlighted
                      ? 'bg-warning-50 dark:bg-warning-950/20'
                      : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50'
                  }`}
                  onClick={() => handleTxClick(tx)}
                >
                  {txWallet && (
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${badgeClass} ${onWalletClick ? 'cursor-pointer hover:opacity-80' : ''}`}
                      onClick={(e) => {
                        if (onWalletClick) {
                          e.stopPropagation();
                          onWalletClick(tx.walletId);
                        }
                      }}
                    >
                      {txWallet.name}
                    </span>
                  )}
                </td>
              )}
            </>
          );
        }}
      />

      {/* Transaction Details Modal */}
      {selectedTx && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => setSelectedTx(null)}>
            <div className="surface-elevated rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-sanctuary-200 dark:border-sanctuary-800" onClick={e => e.stopPropagation()}>
               {/* Modal Header */}
               <div className="sticky top-0 surface-elevated p-6 border-b border-sanctuary-100 dark:border-sanctuary-800 flex justify-between items-start z-10">
                  <div>
                    <h3 className="text-xl font-light text-sanctuary-900 dark:text-sanctuary-50">Transaction Details</h3>
                    <p className="text-sm text-sanctuary-500">{new Date(selectedTx.timestamp).toLocaleString()}</p>
                  </div>
                  <button onClick={() => setSelectedTx(null)} className="p-2 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-full transition-colors">
                     <X className="w-5 h-5" />
                  </button>
               </div>
               
               <div className="p-6 space-y-8">
                  {/* Amount Hero */}
                  <div className="text-center">
                      <div className={`text-4xl font-bold mb-2 ${selectedTx.amount > 0 ? 'text-success-600 dark:text-success-400' : 'text-sanctuary-900 dark:text-sanctuary-100'}`}>
                         <Amount
                           sats={selectedTx.amount}
                           showSign={selectedTx.amount > 0}
                           size="xl"
                           className="items-center"
                         />
                      </div>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                        selectedTx.confirmations >= deepConfirmationThreshold
                          ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300'
                          : selectedTx.confirmations >= confirmationThreshold
                          ? 'bg-success-100 text-success-800 dark:bg-success-500/20 dark:text-success-300'
                          : selectedTx.confirmations > 0
                          ? 'bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-300'
                          : 'bg-warning-100 text-warning-800 dark:bg-warning-500/20 dark:text-warning-300'
                      }`}>
                         {selectedTx.confirmations >= deepConfirmationThreshold ? (
                           <><ShieldCheck className="w-4 h-4 mr-2" />{selectedTx.confirmations.toLocaleString()} Confirmations (Final)</>
                         ) : selectedTx.confirmations >= confirmationThreshold ? (
                           <><CheckCircle2 className="w-4 h-4 mr-2" />{selectedTx.confirmations}/{deepConfirmationThreshold} Confirmations</>
                         ) : selectedTx.confirmations > 0 ? (
                           <><Clock className="w-4 h-4 mr-2" />Confirming ({selectedTx.confirmations}/{deepConfirmationThreshold})</>
                         ) : (
                           <><Clock className="w-4 h-4 mr-2" />Pending Confirmation</>
                         )}
                      </span>
                  </div>

                  {/* ID & Links */}
                  <div className="space-y-4">
                     <div className="surface-muted p-4 rounded-xl border border-sanctuary-100 dark:border-sanctuary-800">
                        <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">Transaction ID</p>
                        <div className="flex items-center justify-between">
                           <code className="text-xs font-mono break-all text-sanctuary-700 dark:text-sanctuary-300 mr-4">
                              {selectedTx.txid}
                           </code>
                           <button
                              onClick={() => copyToClipboard(selectedTx.txid)}
                              className={`p-2 rounded transition-colors ${copied ? 'bg-success-100 dark:bg-success-500/20 text-success-600 dark:text-success-400' : 'hover:bg-sanctuary-200 dark:hover:bg-sanctuary-800 text-sanctuary-500'}`}
                              title={copied ? 'Copied!' : 'Copy to clipboard'}
                           >
                              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                           </button>
                        </div>
                     </div>
                     
                     <a
                        href={`${explorerUrl}/tx/${selectedTx.txid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center w-full py-3 bg-sanctuary-800 dark:bg-sanctuary-700 text-sanctuary-50 dark:text-sanctuary-100 rounded-xl hover:bg-sanctuary-700 dark:hover:bg-sanctuary-600 transition-colors font-medium"
                     >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        View on Block Explorer
                     </a>
                  </div>

                  {/* Transaction Actions (RBF/CPFP) for pending transactions */}
                  {selectedTx.confirmations === 0 && (
                    <TransactionActions
                      txid={selectedTx.txid}
                      walletId={selectedTx.walletId}
                      confirmed={false}
                      isReceived={selectedTx.amount > 0}
                      onActionComplete={() => {
                        setSelectedTx(null);
                        onLabelsChange?.();
                      }}
                    />
                  )}

                  {/* Transaction Details Grid */}
                  <div className="space-y-4">
                      <div className="relative">
                         <div className="absolute inset-0 flex items-center" aria-hidden="true">
                            <div className="w-full border-t border-sanctuary-200 dark:border-sanctuary-800"></div>
                         </div>
                         <div className="relative flex justify-center">
                            <span className="surface-elevated px-3 text-sm text-sanctuary-500 uppercase tracking-wide">Details</span>
                         </div>
                      </div>

                      {/* Details Grid */}
                      <div className="grid grid-cols-2 gap-3">
                         {/* Type */}
                         {(() => {
                           const isSelectedConsolidation = (
                             (selectedTx.amount < 0 && selectedTx.counterpartyAddress && walletAddresses.includes(selectedTx.counterpartyAddress)) ||
                             (selectedTx.amount > 0 && selectedTx.counterpartyAddress && walletAddresses.includes(selectedTx.counterpartyAddress))
                           );
                           return (
                             <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                               <p className="text-xs text-sanctuary-500 mb-1">Type</p>
                               <p className={`text-sm font-medium ${
                                 isSelectedConsolidation
                                   ? 'text-primary-600 dark:text-primary-400'
                                   : selectedTx.amount > 0
                                   ? 'text-success-600 dark:text-success-400'
                                   : 'text-sanctuary-900 dark:text-sanctuary-100'
                               }`}>
                                 {isSelectedConsolidation ? 'Consolidation' : selectedTx.amount > 0 ? 'Received' : 'Sent'}
                               </p>
                             </div>
                           );
                         })()}

                         {/* Date & Time */}
                         <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                            <p className="text-xs text-sanctuary-500 mb-1">Date & Time</p>
                            <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                               {new Date(selectedTx.timestamp).toLocaleDateString()}
                            </p>
                            <p className="text-xs text-sanctuary-500">
                               {new Date(selectedTx.timestamp).toLocaleTimeString()}
                            </p>
                         </div>

                         {/* Block Height */}
                         <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                            <p className="text-xs text-sanctuary-500 mb-1">Block Height</p>
                            <p className="text-sm font-mono font-medium text-sanctuary-900 dark:text-sanctuary-100">
                               {selectedTx.blockHeight != null && selectedTx.blockHeight > 0
                                 ? selectedTx.blockHeight.toLocaleString()
                                 : <span className="text-sanctuary-400 italic">Unconfirmed</span>}
                            </p>
                         </div>

                         {/* Network Fee - only show for sent transactions */}
                         {selectedTx.amount < 0 ? (
                           <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                              <p className="text-xs text-sanctuary-500 mb-1">Network Fee</p>
                              <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                                 {selectedTx.fee != null && selectedTx.fee > 0
                                   ? format(selectedTx.fee, { forceSats: true })
                                   : <span className="text-sanctuary-400 italic">N/A</span>}
                              </p>
                           </div>
                         ) : (
                           <div className="p-3 rounded-lg surface-muted border border-sanctuary-100 dark:border-sanctuary-800">
                              <p className="text-xs text-sanctuary-500 mb-1">Confirmations</p>
                              <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                                 {selectedTx.confirmations?.toLocaleString() || '0'}
                              </p>
                           </div>
                         )}
                      </div>

                      {/* Counterparty Address - Sender (for receives), Consolidation Address, or Recipient (for sends) */}
                      {selectedTx.counterpartyAddress && (() => {
                        const isSelectedConsolidation = (
                          (selectedTx.amount < 0 && selectedTx.counterpartyAddress && walletAddresses.includes(selectedTx.counterpartyAddress)) ||
                          (selectedTx.amount > 0 && selectedTx.counterpartyAddress && walletAddresses.includes(selectedTx.counterpartyAddress))
                        );
                        return (
                        <div className="surface-muted p-4 rounded-xl border border-sanctuary-100 dark:border-sanctuary-800">
                           <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">
                              {isSelectedConsolidation
                                ? 'Consolidation Address (Your Wallet)'
                                : selectedTx.amount > 0
                                ? 'Sender Address'
                                : 'Recipient Address'}
                           </p>
                           <code className="text-xs font-mono break-all text-sanctuary-700 dark:text-sanctuary-300">
                              {selectedTx.counterpartyAddress}
                           </code>
                        </div>
                        );
                      })()}

                      {/* Your Address - which of your addresses was involved */}
                      {selectedTx.address && (
                        <div className="surface-muted p-4 rounded-xl border border-sanctuary-100 dark:border-sanctuary-800">
                           <p className="text-xs font-medium text-sanctuary-500 uppercase mb-2">
                              {selectedTx.amount > 0 ? 'Your Receiving Address' : 'Your Sending Address'}
                           </p>
                           <code className="text-xs font-mono break-all text-sanctuary-700 dark:text-sanctuary-300">
                              {typeof selectedTx.address === 'string' ? selectedTx.address : selectedTx.address.address}
                           </code>
                        </div>
                      )}

                      {/* Labels Section */}
                      <div className="surface-muted p-4 rounded-xl border border-sanctuary-100 dark:border-sanctuary-800">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-medium text-sanctuary-500 uppercase">Labels</p>
                          {!editingLabels ? (
                            canEdit && (
                              <button
                                onClick={() => handleEditLabels(selectedTx)}
                                className="flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
                              >
                                <Edit2 className="w-3 h-3" />
                                Edit
                              </button>
                            )
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={handleSaveLabels}
                                disabled={savingLabels}
                                className="flex items-center gap-1 text-xs text-white bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 px-2 py-1 rounded transition-colors"
                              >
                                {savingLabels ? (
                                  <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                                Save
                              </button>
                              <button
                                onClick={() => setEditingLabels(false)}
                                className="text-xs text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>

                        {editingLabels ? (
                          <div className="space-y-2">
                            {availableLabels.length === 0 ? (
                              <p className="text-sm text-sanctuary-500">No labels available. Create labels in wallet settings.</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {availableLabels.map(label => {
                                  const isSelected = selectedLabelIds.includes(label.id);
                                  return (
                                    <button
                                      key={label.id}
                                      onClick={() => handleToggleLabel(label.id)}
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium transition-all ${
                                        isSelected
                                          ? 'text-white ring-2 ring-offset-2 ring-sanctuary-500 dark:ring-offset-sanctuary-950'
                                          : 'text-white opacity-50 hover:opacity-75'
                                      }`}
                                      style={{ backgroundColor: label.color }}
                                    >
                                      <Tag className="w-3.5 h-3.5" />
                                      {label.name}
                                      {isSelected && <Check className="w-3.5 h-3.5" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {(selectedTx.labels && selectedTx.labels.length > 0) ? (
                              selectedTx.labels.map(label => (
                                <span
                                  key={label.id}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium text-white"
                                  style={{ backgroundColor: label.color }}
                                >
                                  <Tag className="w-3.5 h-3.5" />
                                  {label.name}
                                </span>
                              ))
                            ) : selectedTx.label ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
                                <Tag className="w-3.5 h-3.5" />
                                {selectedTx.label}
                              </span>
                            ) : (
                              <span className="text-sm text-sanctuary-400 italic">No labels</span>
                            )}
                          </div>
                        )}
                      </div>
                  </div>
               </div>
            </div>
         </div>
      )}
    </>
  );
};