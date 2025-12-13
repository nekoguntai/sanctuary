import React, { useState, useEffect, useRef } from 'react';
import { Transaction, Wallet, WalletType, Label } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import { Amount } from './Amount';
import * as bitcoinApi from '../src/api/bitcoin';
import * as labelsApi from '../src/api/labels';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Clock, Tag, CheckCircle2, MoreHorizontal, ExternalLink, Copy, X, ArrowDown, Check, Edit2 } from 'lucide-react';
import { LabelBadges } from './LabelSelector';

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
}

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  showWalletBadge = false,
  wallets = [],
  walletAddresses = [],
  onWalletClick,
  onTransactionClick,
  highlightedTxId,
  onLabelsChange,
  canEdit = true
}) => {
  const { format } = useCurrency();
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [explorerUrl, setExplorerUrl] = useState('https://mempool.space');
  const [copied, setCopied] = useState(false);
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());

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
      console.error('Failed to fetch explorer URL:', err);
    });
  }, []);

  useEffect(() => {
    if (highlightedTxId && transactions.length > 0) {
       const el = itemRefs.current.get(highlightedTxId);
       if (el) {
          setTimeout(() => {
             el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      console.error('Failed to copy:', err);
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
      console.error('Failed to load labels:', err);
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
      console.error('Failed to save labels:', err);
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

  if (transactions.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-sanctuary-400 dark:text-sanctuary-500">No transactions found.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flow-root mt-6">
        <ul className="-my-5 divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
          {transactions.map((tx) => {
            const isReceive = tx.amount > 0;
            // Check if this is a consolidation transaction:
            // Case 1: Transaction type is explicitly 'consolidation' (from sync)
            // Case 2: Sent transaction where recipient is a wallet address
            // Case 3: Received transaction where sender (counterpartyAddress) is also a wallet address
            const isConsolidation = (
              // Case 1: Explicitly marked as consolidation by sync
              tx.type === 'consolidation' ||
              // Case 2: Sent to self
              (tx.amount < 0 && tx.counterpartyAddress && walletAddresses.includes(tx.counterpartyAddress)) ||
              // Case 3: Received from self (sync recorded receive side of consolidation)
              (tx.amount > 0 && tx.counterpartyAddress && walletAddresses.includes(tx.counterpartyAddress))
            );
            const isHighlighted = highlightedTxId === tx.id;
            const txWallet = getWallet(tx.walletId);
            const isMultisig = txWallet?.type === WalletType.MULTI_SIG;
            
            // Determine badge colors based on wallet type using Semantic colors
            // Updated to remove transparent borders in dark mode to fix glow effect
            const badgeClass = isMultisig
                ? 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300 hover:bg-warning-200 dark:hover:bg-warning-900/50'
                : 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-300 hover:bg-success-200 dark:hover:bg-success-900/50';

            return (
              <li 
                key={tx.id} 
                ref={(el) => {
                    if (el) itemRefs.current.set(tx.id, el);
                    else itemRefs.current.delete(tx.id);
                }}
                className={`py-4 rounded-lg transition-all duration-500 px-2 -mx-2 cursor-pointer group 
                    ${isHighlighted 
                        ? 'bg-warning-50 dark:bg-warning-950/20 ring-1 ring-warning-200 dark:ring-warning-800 shadow-sm' 
                        : 'hover:bg-sanctuary-50/50 dark:hover:bg-sanctuary-800'
                    }`}
                onClick={() => handleTxClick(tx)}
              >
                <div className="flex items-center space-x-4">
                  <div className="flex-shrink-0">
                    <span className={`inline-flex items-center justify-center h-10 w-10 rounded-full ${
                      isConsolidation
                        ? 'bg-primary-100 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                        : isReceive
                        ? 'bg-success-100 text-success-600 dark:bg-success-500/10 dark:text-success-400'
                        : 'bg-sanctuary-200 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400'
                    }`}>
                      {isConsolidation ? <RefreshCw className="h-5 w-5" /> : isReceive ? <ArrowDownLeft className="h-5 w-5" /> : <ArrowUpRight className="h-5 w-5" />}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 truncate">
                        {isConsolidation ? 'Consolidation' : isReceive ? 'Received' : 'Sent'}
                      </p>
                      <div className={`text-sm font-semibold ${
                        isConsolidation
                          ? 'text-primary-600 dark:text-primary-400'
                          : isReceive
                          ? 'text-success-600 dark:text-success-400'
                          : 'text-sanctuary-900 dark:text-sanctuary-100'
                      }`}>
                        <Amount
                          sats={isConsolidation ? Math.abs(tx.amount) : tx.amount}
                          showSign={isReceive}
                          size="sm"
                          className="items-end"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center text-xs text-sanctuary-500 dark:text-sanctuary-500 space-x-2">
                        <span className="flex items-center">
                          {tx.confirmed ? (
                            <CheckCircle2 className="w-3 h-3 mr-1 text-success-500" />
                          ) : (
                            <Clock className="w-3 h-3 mr-1 text-warning-500" />
                          )}
                          {tx.confirmed
                            ? `${tx.confirmations?.toLocaleString() || ''} confs`
                            : 'Pending'}
                        </span>
                        <span>•</span>
                        <span>{new Date(tx.timestamp).toLocaleDateString()}</span>
                        {/* Show multiple labels if available, fall back to single label */}
                        {(tx.labels && tx.labels.length > 0) ? (
                          <>
                            <span>•</span>
                            <LabelBadges labels={tx.labels} maxDisplay={2} size="sm" />
                          </>
                        ) : tx.label && (
                          <>
                            <span>•</span>
                            <span className="flex items-center surface-secondary px-1.5 py-0.5 rounded text-sanctuary-600 dark:text-sanctuary-300">
                              <Tag className="w-3 h-3 mr-1" />
                              {tx.label}
                            </span>
                          </>
                        )}
                        {showWalletBadge && txWallet && (
                          <>
                             <span>•</span>
                             <span 
                                className={`px-1.5 py-0.5 rounded transition-colors ${badgeClass} ${onWalletClick ? 'cursor-pointer' : ''}`}
                                onClick={(e) => {
                                  if (onWalletClick) {
                                    e.stopPropagation();
                                    onWalletClick(tx.walletId);
                                  }
                                }}
                             >
                               {txWallet.name}
                             </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center space-x-3">
                        {tx.fee != null && tx.fee > 0 && !isReceive && (
                          <span className="text-xs text-sanctuary-400">Fee: {format(tx.fee, { forceSats: true })}</span>
                        )}
                        <button
                           onClick={(e) => {
                               e.stopPropagation();
                               setSelectedTx(tx);
                           }}
                           className="text-xs text-sanctuary-500 dark:text-sanctuary-400 opacity-0 group-hover:opacity-100 transition-opacity underline flex items-center hover:text-primary-600 dark:hover:text-primary-400"
                        >
                           Details <MoreHorizontal className="w-3 h-3 ml-1" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

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
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${selectedTx.confirmed ? 'bg-success-100 text-success-800 dark:bg-success-500/20 dark:text-success-300' : 'bg-warning-100 text-warning-800 dark:bg-warning-500/20 dark:text-warning-300'}`}>
                         {selectedTx.confirmed ? <CheckCircle2 className="w-4 h-4 mr-2" /> : <Clock className="w-4 h-4 mr-2" />}
                         {selectedTx.confirmed
                           ? `${selectedTx.confirmations?.toLocaleString() || ''} Confirmations`
                           : 'Pending Confirmation'}
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
                              {selectedTx.address}
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