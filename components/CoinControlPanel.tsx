/**
 * Coin Control Panel Component
 *
 * Main container for all coin control functionality with progressive disclosure.
 * Default state: Collapsed with minimal info "Coin Control (Auto)" or "Coin Control (3 selected)"
 * Expanded state: Full control with strategies, privacy scores, dust warnings, UTXO list
 *
 * Key UX Principle: Hidden for base users, powerful for advanced users
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, ChevronUp, Sliders, Check, Lock, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import type { UTXO, WalletScriptType } from '../types';
import type { SpendPrivacyAnalysis, WalletPrivacyResponse, SelectionStrategy } from '../src/api/transactions';
import { StrategySelector, UIStrategy } from './StrategySelector';
import SpendPrivacyCard from './SpendPrivacyCard';
import { DustWarningBadge } from './DustWarningBadge';
import { PrivacyBadge } from './PrivacyBadge';
import { useCurrency } from '../contexts/CurrencyContext';
import * as transactionsApi from '../src/api/transactions';
import { createLogger } from '../utils/logger';
import { calculateUTXOAge, getAgeCategoryColor } from '../utils/utxoAge';

// Map UI strategy to backend API strategy
const strategyToApiStrategy: Record<UIStrategy, SelectionStrategy | null> = {
  auto: 'efficiency',      // Auto uses efficiency (minimize fees)
  privacy: 'privacy',      // Privacy maximizes privacy score
  manual: null,            // Manual = no API call, user selects
  consolidate: 'smallest_first', // Consolidate picks small UTXOs first
};

const log = createLogger('CoinControl');

// Input virtual bytes by script type (for dust calculation)
const INPUT_VBYTES: Record<WalletScriptType, number> = {
  legacy: 148,
  nested_segwit: 91,
  native_segwit: 68,
  taproot: 57.5,
};

/**
 * Calculate the dust threshold for a UTXO
 */
function calculateDustThreshold(feeRate: number, scriptType: WalletScriptType = 'native_segwit'): number {
  const inputVBytes = INPUT_VBYTES[scriptType] || INPUT_VBYTES.native_segwit;
  return Math.ceil(inputVBytes * feeRate);
}

/**
 * Check if a UTXO is dust at the current fee rate
 */
function isDustUtxo(utxo: UTXO, feeRate: number): boolean {
  const scriptType = utxo.scriptType || 'native_segwit';
  const threshold = calculateDustThreshold(feeRate, scriptType);
  return utxo.amount < threshold;
}

/**
 * Calculate the cost to spend a UTXO
 */
function getSpendCost(utxo: UTXO, feeRate: number): number {
  const scriptType = utxo.scriptType || 'native_segwit';
  const inputVBytes = INPUT_VBYTES[scriptType] || INPUT_VBYTES.native_segwit;
  return Math.ceil(inputVBytes * feeRate);
}

interface CoinControlPanelProps {
  walletId: string;
  utxos: UTXO[];
  selectedUtxos: Set<string>;
  onToggleSelect: (utxoId: string) => void;
  onSetSelectedUtxos: (utxoIds: Set<string>) => void;
  feeRate: number;
  targetAmount: number; // Amount user wants to send (for UTXO selection)
  strategy?: UIStrategy;
  onStrategyChange?: (strategy: UIStrategy) => void;
  disabled?: boolean;
  className?: string;
}

export const CoinControlPanel: React.FC<CoinControlPanelProps> = ({
  walletId,
  utxos,
  selectedUtxos,
  onToggleSelect,
  onSetSelectedUtxos,
  feeRate,
  targetAmount,
  strategy = 'auto',
  onStrategyChange,
  disabled = false,
  className = '',
}) => {
  const { format } = useCurrency();
  const [isExpanded, setIsExpanded] = useState(false);
  const [privacyData, setPrivacyData] = useState<WalletPrivacyResponse | null>(null);
  const [spendAnalysis, setSpendAnalysis] = useState<SpendPrivacyAnalysis | null>(null);
  const [loadingPrivacy, setLoadingPrivacy] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [strategyError, setStrategyError] = useState<string | null>(null);

  // Refs for debounce and request tracking
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const requestIdRef = useRef<number>(0);

  // Calculate selected total
  const selectedTotal = useMemo(() => {
    return utxos
      .filter(u => selectedUtxos.has(`${u.txid}:${u.vout}`))
      .reduce((acc, u) => acc + u.amount, 0);
  }, [utxos, selectedUtxos]);

  // Create privacy map for quick lookup
  const privacyMap = useMemo(() => {
    if (!privacyData) return new Map();
    return new Map(privacyData.utxos.map(p => [`${p.txid}:${p.vout}`, p]));
  }, [privacyData]);

  // Fetch wallet privacy data when panel expands
  useEffect(() => {
    const fetchPrivacyData = async () => {
      if (isExpanded && !privacyData && !loadingPrivacy) {
        setLoadingPrivacy(true);
        try {
          const data = await transactionsApi.getWalletPrivacy(walletId);
          setPrivacyData(data);
        } catch (err) {
          log.error('Failed to fetch wallet privacy', { error: err });
        } finally {
          setLoadingPrivacy(false);
        }
      }
    };
    fetchPrivacyData();
  }, [isExpanded, walletId, privacyData, loadingPrivacy]);

  // Debounced spend analysis when selection changes
  useEffect(() => {
    if (!isExpanded || selectedUtxos.size === 0) {
      setSpendAnalysis(null);
      return;
    }

    // Clear any existing timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setLoadingAnalysis(true);

    // Increment request ID to track the latest request
    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;

    debounceRef.current = setTimeout(async () => {
      const utxoIds = Array.from(selectedUtxos);

      try {
        const analysis = await transactionsApi.analyzeSpendPrivacy(walletId, utxoIds);
        // Only update state if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setSpendAnalysis(analysis);
        }
      } catch (err) {
        // Only log/handle error if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          log.error('Failed to analyze spend privacy', { error: err });
        }
      } finally {
        // Only update loading state if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setLoadingAnalysis(false);
        }
      }
    }, 300); // Debounce 300ms

    // Cleanup function - clear timeout and increment request ID to invalidate in-flight requests
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      // Increment request ID to mark any in-flight requests as stale
      requestIdRef.current += 1;
    };
  }, [isExpanded, selectedUtxos, walletId]);

  // Handle strategy change - calls API for non-manual strategies
  const handleStrategyChange = useCallback(async (newStrategy: UIStrategy) => {
    if (disabled || loadingStrategy) return;

    // Expand panel when switching away from auto
    if (newStrategy !== 'auto' && !isExpanded) {
      setIsExpanded(true);
    }

    onStrategyChange?.(newStrategy);
    setStrategyError(null);

    // Manual strategy = clear selection and let user pick
    if (newStrategy === 'manual') {
      // Don't clear - user is taking over manual control
      return;
    }

    // For auto strategies, call the API to select UTXOs
    const apiStrategy = strategyToApiStrategy[newStrategy];
    if (!apiStrategy) return;

    // Need a target amount to select UTXOs
    if (targetAmount <= 0) {
      // Clear any existing selection - strategy will select when amount is entered
      onSetSelectedUtxos(new Set());
      return;
    }

    setLoadingStrategy(true);
    try {
      const result = await transactionsApi.selectUtxos(walletId, {
        amount: targetAmount,
        feeRate: feeRate || 1,
        strategy: apiStrategy,
      });

      // Convert selected UTXOs to Set of IDs
      const selectedIds = new Set(
        result.selected.map(u => `${u.txid}:${u.vout}`)
      );
      onSetSelectedUtxos(selectedIds);

      log.info('Strategy auto-selected UTXOs', {
        strategy: newStrategy,
        apiStrategy,
        count: result.selected.length,
        total: result.totalAmount,
      });
    } catch (err) {
      log.error('Failed to auto-select UTXOs', { error: err });
      setStrategyError(err instanceof Error ? err.message : 'Selection failed');
    } finally {
      setLoadingStrategy(false);
    }
  }, [disabled, loadingStrategy, isExpanded, onStrategyChange, walletId, targetAmount, feeRate, onSetSelectedUtxos]);

  // Handle manual UTXO toggle (only callable in manual mode)
  const handleManualToggle = useCallback((utxoId: string) => {
    onToggleSelect(utxoId);
  }, [onToggleSelect]);

  // Summary text for collapsed state
  const summaryText = useMemo(() => {
    if (selectedUtxos.size > 0) {
      return `${selectedUtxos.size} selected`;
    }
    return strategy === 'auto' ? 'Auto' : strategy.charAt(0).toUpperCase() + strategy.slice(1);
  }, [selectedUtxos.size, strategy]);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Collapsible Header */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => !disabled && setIsExpanded(!isExpanded)}
          disabled={disabled}
          className={`flex items-center text-sm font-medium text-sanctuary-600 dark:text-sanctuary-400 hover:text-sanctuary-900 dark:hover:text-sanctuary-200 transition-colors ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <Sliders className="w-4 h-4 mr-2" />
          Coin Control ({summaryText})
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 ml-1" />
          ) : (
            <ChevronDown className="w-4 h-4 ml-1" />
          )}
        </button>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="space-y-4 animate-fade-in">
          {/* Strategy Selector */}
          <StrategySelector
            strategy={strategy}
            onStrategyChange={handleStrategyChange}
            disabled={disabled || loadingStrategy}
          />

          {/* Loading indicator for strategy selection */}
          {loadingStrategy && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-sanctuary-50 dark:bg-sanctuary-800/50 text-sanctuary-600 dark:text-sanctuary-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Selecting optimal UTXOs...</span>
            </div>
          )}

          {/* Strategy error */}
          {strategyError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm">{strategyError}</span>
            </div>
          )}

          {/* Spend Privacy Card (when UTXOs selected) */}
          {spendAnalysis && selectedUtxos.size > 0 && (
            <SpendPrivacyCard analysis={spendAnalysis} />
          )}

          {/* UTXO List */}
          <div className={`surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden ${disabled ? 'opacity-60' : ''}`}>
            <div className="p-4 surface-muted border-b border-sanctuary-100 dark:border-sanctuary-800 flex justify-between items-center">
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {disabled ? 'Selected Inputs (locked)' : strategy === 'manual' ? 'Select Inputs' : 'Inputs (auto-selected)'}
              </span>
              <span className="text-xs text-sanctuary-500">
                {selectedUtxos.size} selected
              </span>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {utxos.map(utxo => {
                const id = `${utxo.txid}:${utxo.vout}`;
                const isSelected = selectedUtxos.has(id);
                const isLocked = !!utxo.lockedByDraftId;
                // Disable selection when not in manual mode (strategy controls selection)
                const isDisabled = utxo.frozen || isLocked || disabled || strategy !== 'manual';
                const isDust = !utxo.frozen && !isLocked && isDustUtxo(utxo, feeRate);
                const spendCost = isDust ? getSpendCost(utxo, feeRate) : 0;
                const privacyInfo = privacyMap.get(id);

                // Striped pattern for frozen UTXOs
                const frozenStyle = utxo.frozen ? {
                  backgroundImage: `repeating-linear-gradient(
                    45deg,
                    transparent,
                    transparent 4px,
                    rgba(190,18,60,0.08) 4px,
                    rgba(190,18,60,0.08) 8px
                  )`
                } : {};

                // Striped pattern for locked UTXOs
                const lockedStyle = isLocked && !utxo.frozen ? {
                  backgroundImage: `repeating-linear-gradient(
                    45deg,
                    transparent,
                    transparent 4px,
                    rgba(6,182,212,0.08) 4px,
                    rgba(6,182,212,0.08) 8px
                  )`
                } : {};

                return (
                  <div
                    key={id}
                    onClick={() => !isDisabled && handleManualToggle(id)}
                    style={{...frozenStyle, ...lockedStyle}}
                    className={`p-4 flex items-center justify-between border-b border-sanctuary-50 dark:border-sanctuary-800 last:border-0 transition-colors ${
                      isSelected
                        ? 'bg-amber-50 dark:bg-amber-900/10'
                        : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
                    } ${
                      utxo.frozen
                        ? 'opacity-70 bg-rose-50 dark:bg-rose-900/10'
                        : ''
                    } ${
                      isLocked
                        ? 'opacity-70 bg-cyan-50 dark:bg-cyan-900/10'
                        : ''
                    } ${
                      isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? 'bg-sanctuary-800 border-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900'
                          : 'border-sanctuary-300 dark:border-sanctuary-600'
                      }`}>
                        {isSelected && <Check className="w-3 h-3" />}
                      </div>

                      {/* UTXO Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                            {format(utxo.amount)}
                          </span>

                          {/* Dust Warning */}
                          {isDust && (
                            <DustWarningBadge
                              spendCost={spendCost}
                              utxoAmount={utxo.amount}
                              feeRate={feeRate}
                              size="sm"
                            />
                          )}

                          {/* Privacy Badge */}
                          {privacyInfo && (
                            <PrivacyBadge
                              score={privacyInfo.score.score}
                              grade={privacyInfo.score.grade}
                              size="sm"
                            />
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-sanctuary-500 font-mono truncate">
                            {utxo.address.substring(0, 16)}...
                          </span>
                          {utxo.label && (
                            <span className="text-xs text-sanctuary-400">
                              {utxo.label}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status Indicators */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {utxo.frozen && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                            <Lock className="w-3 h-3 mr-1" />
                            Frozen
                          </span>
                        )}
                        {isLocked && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
                            <FileText className="w-3 h-3 mr-1" />
                            {utxo.lockedByDraftLabel || 'Draft'}
                          </span>
                        )}
                        {(() => {
                          const age = calculateUTXOAge(utxo);
                          return (
                            <span className={`text-xs ${getAgeCategoryColor(age.category)}`} title={`${utxo.confirmations.toLocaleString()} confirmations`}>
                              {age.shortText}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selection Summary Footer */}
          {selectedUtxos.size > 0 && (
            <div className="flex items-center justify-between p-3 rounded-xl surface-muted border border-sanctuary-200 dark:border-sanctuary-700">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
                  Selected Total:
                </span>
                <span className="text-sm font-bold text-sanctuary-900 dark:text-sanctuary-100">
                  {format(selectedTotal)}
                </span>
              </div>
              <div className="text-xs text-sanctuary-500">
                {selectedUtxos.size} UTXO{selectedUtxos.size !== 1 ? 's' : ''}
              </div>
            </div>
          )}

          {/* Warning if insufficient funds */}
          {selectedUtxos.size > 0 && selectedTotal === 0 && (
            <div className="flex items-center p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
              <span className="text-sm">
                Selected inputs have zero balance or are unspendable.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
