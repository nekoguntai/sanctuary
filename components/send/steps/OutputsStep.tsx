/**
 * OutputsStep Component
 *
 * Combined step for recipients, coin control, and fees.
 * All transaction composition happens here so max calculations are accurate.
 */

import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Check,
  Lock,
  AlertCircle,
  Clock,
  Coins,
  Zap,
  Settings2,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import { OutputRow } from '../OutputRow';
import { FeeSelector } from '../FeeSelector';
import { AdvancedOptions } from '../AdvancedOptions';
import { WizardNavigation } from '../WizardNavigation';
import { useSendTransaction } from '../../../contexts/send';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { parseBip21Uri } from '../../../utils/bip21Parser';
import { validateAddress } from '../../../utils/validateAddress';
import { calculateUTXOAge, getAgeCategoryColor } from '../../../utils/utxoAge';
import { analyzeSpendPrivacy, getWalletPrivacy, type SpendPrivacyAnalysis, type UtxoPrivacyInfo } from '../../../src/api/transactions';
import SpendPrivacyCard from '../../SpendPrivacyCard';
import { PrivacyBadge } from '../../PrivacyBadge';
import type { UTXO } from '../../../types';

export function OutputsStep() {
  const {
    state,
    dispatch,
    wallet,
    utxos,
    spendableUtxos,
    addOutput,
    removeOutput,
    updateOutputAddress,
    updateOutputAmount,
    toggleSendMax,
    walletAddresses,
    selectedTotal,
    estimatedFee,
    totalOutputAmount,
    toggleUtxo,
    selectAllUtxos,
    clearUtxoSelection,
    toggleCoinControl,
    fees,
    mempoolBlocks,
    queuedBlocksSummary,
    setFeeRate,
  } = useSendTransaction();

  const { unit, format, formatFiat } = useCurrency();

  // Panel expansion states
  const [coinControlExpanded, setCoinControlExpanded] = useState(state.showCoinControl);
  const [feeExpanded, setFeeExpanded] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  // Privacy analysis state
  const [privacyAnalysis, setPrivacyAnalysis] = useState<SpendPrivacyAnalysis | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [utxoPrivacyMap, setUtxoPrivacyMap] = useState<Map<string, UtxoPrivacyInfo>>(new Map());

  // Video ref for QR scanning
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isConsolidation = state.transactionType === 'consolidation';
  const isSweep = state.transactionType === 'sweep';

  // Auto-set consolidation address to first unused receive address if empty
  useEffect(() => {
    if (isConsolidation && state.outputs.length > 0 && !state.outputs[0].address && walletAddresses.length > 0) {
      // Filter to only receive addresses (not change addresses)
      const receiveAddresses = walletAddresses.filter(a => !a.isChange);
      if (receiveAddresses.length > 0) {
        // Find first unused receive address, or fall back to first receive address
        const firstUnused = receiveAddresses.find(a => !a.used);
        const selectedAddress = firstUnused ? firstUnused.address : receiveAddresses[0].address;
        updateOutputAddress(0, selectedAddress);
      }
    }
  }, [isConsolidation, state.outputs, walletAddresses, updateOutputAddress]);

  // Group UTXOs by status
  const { available, manuallyFrozen, draftLocked } = useMemo(() => {
    const available: UTXO[] = [];
    const manuallyFrozen: UTXO[] = [];
    const draftLocked: UTXO[] = [];

    for (const utxo of utxos) {
      if (utxo.spent) continue;
      if (utxo.frozen) {
        manuallyFrozen.push(utxo);
      } else if (utxo.lockedByDraftId || utxo.spendable === false) {
        draftLocked.push(utxo);
      } else {
        available.push(utxo);
      }
    }

    return { available, manuallyFrozen, draftLocked };
  }, [utxos]);

  // Calculate the effective available balance (respects coin control selection)
  const effectiveAvailable = useMemo(() => {
    if (state.showCoinControl && state.selectedUTXOs.size > 0) {
      return selectedTotal;
    }
    return spendableUtxos.reduce((sum, u) => sum + u.amount, 0);
  }, [state.showCoinControl, state.selectedUTXOs.size, selectedTotal, spendableUtxos]);

  // Calculate max sendable (available minus fee)
  const maxSendable = useMemo(() => {
    return Math.max(0, effectiveAvailable - estimatedFee);
  }, [effectiveAvailable, estimatedFee]);

  // Calculate max for each output
  const calculateMaxForOutput = useCallback((index: number) => {
    const otherTotal = state.outputs.reduce((sum, o, i) => {
      if (i === index || o.sendMax) return sum;
      return sum + (parseInt(o.amount) || 0);
    }, 0);

    return Math.max(0, effectiveAvailable - otherTotal - estimatedFee);
  }, [state.outputs, effectiveAvailable, estimatedFee]);

  // Calculate remaining balance needed
  const remainingNeeded = useMemo(() => {
    if (!state.showCoinControl || state.selectedUTXOs.size === 0) return 0;
    const needed = totalOutputAmount + estimatedFee;
    return Math.max(0, needed - selectedTotal);
  }, [state.showCoinControl, state.selectedUTXOs.size, totalOutputAmount, estimatedFee, selectedTotal]);

  // Fee warnings
  const feeWarnings = useMemo(() => {
    const warnings: string[] = [];

    // Warning 1: Fee is excessive relative to amount being sent (>10% of amount)
    if (totalOutputAmount > 0 && estimatedFee > 0) {
      const feePercentage = (estimatedFee / totalOutputAmount) * 100;
      if (feePercentage > 10) {
        warnings.push(`Fee is ${feePercentage.toFixed(1)}% of the amount being sent`);
      }
    }

    // Warning 2: Fee rate is much higher than slow estimate (>2x)
    if (fees && state.feeRate > 0) {
      const slowRate = fees.hourFee || fees.minimumFee || 1;
      if (state.feeRate > slowRate * 2) {
        warnings.push(`Fee rate (${state.feeRate} sat/vB) is ${(state.feeRate / slowRate).toFixed(1)}x the economy rate (${slowRate} sat/vB)`);
      }
    }

    return warnings;
  }, [totalOutputAmount, estimatedFee, fees, state.feeRate]);

  // Fetch UTXO privacy data for display
  useEffect(() => {
    const fetchUtxoPrivacy = async () => {
      try {
        const data = await getWalletPrivacy(wallet.id);
        const privacyMap = new Map<string, UtxoPrivacyInfo>();
        for (const utxo of data.utxos) {
          // Use txid:vout as key to match how UTXOs are identified in the UI
          const key = `${utxo.txid}:${utxo.vout}`;
          privacyMap.set(key, utxo);
        }
        setUtxoPrivacyMap(privacyMap);
      } catch {
        // Silently fail - privacy data is optional
      }
    };
    fetchUtxoPrivacy();
  }, [wallet.id]);

  // Fetch privacy analysis when UTXOs are selected
  useEffect(() => {
    if (!state.showCoinControl || state.selectedUTXOs.size < 1) {
      setPrivacyAnalysis(null);
      return;
    }

    const fetchPrivacy = async () => {
      setPrivacyLoading(true);
      try {
        const utxoIds = Array.from(state.selectedUTXOs);
        const analysis = await analyzeSpendPrivacy(wallet.id, utxoIds);
        setPrivacyAnalysis(analysis);
      } catch (err) {
        // Silently fail - privacy analysis is optional
        setPrivacyAnalysis(null);
      } finally {
        setPrivacyLoading(false);
      }
    };

    // Debounce to avoid too many API calls
    const timeoutId = setTimeout(fetchPrivacy, 300);
    return () => clearTimeout(timeoutId);
  }, [state.showCoinControl, state.selectedUTXOs, wallet.id]);

  // Handle address change with BIP21 parsing
  const handleAddressChange = useCallback((index: number, value: string) => {
    if (value.toLowerCase().startsWith('bitcoin:')) {
      try {
        const parsed = parseBip21Uri(value);
        updateOutputAddress(index, parsed.address);
        if (parsed.amount) {
          updateOutputAmount(index, parsed.amount.toString());
        }
        if (parsed.payjoinUrl) {
          dispatch({ type: 'SET_PAYJOIN_URL', url: parsed.payjoinUrl });
        }
        return;
      } catch {
        // Not a valid BIP21
      }
    }

    updateOutputAddress(index, value);

    if (index === 0 && state.payjoinUrl) {
      dispatch({ type: 'SET_PAYJOIN_URL', url: null });
    }
  }, [updateOutputAddress, updateOutputAmount, dispatch, state.payjoinUrl]);

  // Validate addresses on change
  useEffect(() => {
    const validationResults = state.outputs.map((output) => {
      if (!output.address.trim()) return null;
      return validateAddress(output.address);
    });

    dispatch({ type: 'SET_OUTPUTS_VALID', valid: validationResults });
  }, [state.outputs, dispatch]);

  // Handle QR scan
  const handleScanQR = useCallback((index: number) => {
    if (state.scanningOutputIndex === index) {
      dispatch({ type: 'SET_SCANNING_OUTPUT_INDEX', index: null });
    } else {
      dispatch({ type: 'SET_SCANNING_OUTPUT_INDEX', index });
    }
  }, [state.scanningOutputIndex, dispatch]);

  // Format amount for display
  const formatDisplayValue = useCallback((sats: number) => {
    if (unit === 'btc') {
      return (sats / 100_000_000).toFixed(8).replace(/\.?0+$/, '');
    }
    return sats.toString();
  }, [unit]);

  // Get display value for output
  const getDisplayValue = useCallback((output: typeof state.outputs[0]) => {
    if (output.displayValue !== undefined) {
      return output.displayValue;
    }
    if (!output.amount) return '';
    const sats = parseInt(output.amount);
    if (isNaN(sats)) return output.amount;
    return formatDisplayValue(sats);
  }, [formatDisplayValue]);

  // Handle amount change
  const handleAmountChange = useCallback((index: number, displayValue: string, satsValue: string) => {
    let finalSats = satsValue;
    if (unit === 'btc' && displayValue) {
      const btcValue = parseFloat(displayValue);
      if (!isNaN(btcValue)) {
        finalSats = Math.round(btcValue * 100_000_000).toString();
      }
    }
    updateOutputAmount(index, finalSats, displayValue);
  }, [unit, updateOutputAmount]);

  // Handle amount blur
  const handleAmountBlur = useCallback((index: number) => {
    const output = state.outputs[index];
    if (output.displayValue !== undefined) {
      dispatch({
        type: 'UPDATE_OUTPUT',
        index,
        field: 'displayValue',
        value: undefined,
      });
    }
  }, [state.outputs, dispatch]);

  // Toggle coin control panel
  const handleToggleCoinControl = useCallback(() => {
    const newExpanded = !coinControlExpanded;
    setCoinControlExpanded(newExpanded);
    if (newExpanded && !state.showCoinControl) {
      toggleCoinControl();
    }
  }, [coinControlExpanded, state.showCoinControl, toggleCoinControl]);

  // Check if a UTXO is selected
  const isSelected = (utxo: UTXO) => {
    return state.selectedUTXOs.has(`${utxo.txid}:${utxo.vout}`);
  };

  // Advanced options handlers
  const handleRbfChange = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_RBF_ENABLED', enabled });
  }, [dispatch]);

  const handleSubtractFeesChange = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_SUBTRACT_FEES', enabled });
  }, [dispatch]);

  const handleDecoysChange = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_USE_DECOYS', enabled });
  }, [dispatch]);

  const handleDecoyCountChange = useCallback((count: number) => {
    dispatch({ type: 'SET_DECOY_COUNT', count });
  }, [dispatch]);

  // Render single UTXO row
  const renderUtxo = (utxo: UTXO, selectable: boolean = true) => {
    const utxoId = `${utxo.txid}:${utxo.vout}`;
    const selected = isSelected(utxo);

    return (
      <div
        key={utxoId}
        onClick={() => selectable && toggleUtxo(utxoId)}
        className={`
          p-3 rounded-lg border transition-all
          ${selectable ? 'cursor-pointer hover:shadow-sm' : 'cursor-not-allowed opacity-50'}
          ${selected
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
            : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-300'
          }
        `}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {selectable && (
              <div
                className={`
                  w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                  ${selected
                    ? 'border-primary-500 bg-primary-500'
                    : 'border-sanctuary-300 dark:border-sanctuary-600'
                  }
                `}
              >
                {selected && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
            )}
            {!selectable && utxo.frozen && (
              <Lock className="w-3.5 h-3.5 text-sanctuary-400" />
            )}

            <div className="min-w-0">
              <div className="font-mono text-xs text-sanctuary-900 dark:text-sanctuary-100 truncate">
                {utxo.address.slice(0, 8)}...{utxo.address.slice(-6)}
              </div>
              <div className="text-[10px] text-sanctuary-500 flex items-center gap-1.5">
                {utxo.confirmations < 6 ? (
                  <span className="text-amber-500 flex items-center gap-0.5">
                    <AlertCircle className="w-2.5 h-2.5" />
                    {utxo.confirmations} conf
                  </span>
                ) : (
                  (() => {
                    const age = calculateUTXOAge({ confirmations: utxo.confirmations, date: utxo.date });
                    return (
                      <span className={`flex items-center gap-0.5 ${getAgeCategoryColor(age.category)}`}>
                        <Clock className="w-2.5 h-2.5" />
                        {age.shortText}
                      </span>
                    );
                  })()
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Privacy Badge */}
            {(() => {
              const privacyInfo = utxoPrivacyMap.get(utxoId);
              if (privacyInfo?.score) {
                return (
                  <PrivacyBadge
                    grade={privacyInfo.score.grade}
                    score={privacyInfo.score.score}
                    size="sm"
                  />
                );
              }
              return null;
            })()}

            <div className="text-right">
              <div className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100">
                {format(utxo.amount)}
              </div>
              {formatFiat(utxo.amount) && (
                <div className="text-[10px] text-sanctuary-500">
                  {formatFiat(utxo.amount)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          {isConsolidation ? 'Consolidation' : isSweep ? 'Sweep' : 'Compose Transaction'}
        </h2>
        <p className="text-sm text-sanctuary-500 mt-1">
          {isConsolidation
            ? 'Select UTXOs to consolidate and destination'
            : isSweep
              ? 'Sweep all funds to a destination'
              : 'Configure your transaction'
          }
        </p>
      </div>

      {/* Summary Bar */}
      <div className="surface-elevated p-3 rounded-xl border border-sanctuary-200 dark:border-sanctuary-700">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-sanctuary-500">Available: </span>
              <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {format(effectiveAvailable)}
              </span>
            </div>
            <div>
              <span className="text-sanctuary-500">Fee: </span>
              <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                {format(estimatedFee)}
              </span>
              <span className="text-xs text-sanctuary-400 ml-1">
                ({state.feeRate} sat/vB)
              </span>
            </div>
          </div>
          <div>
            <span className="text-sanctuary-500">Max: </span>
            <span className="font-semibold text-primary-600 dark:text-primary-400">
              {format(maxSendable)}
            </span>
          </div>
        </div>
      </div>

      {/* Fee Warnings */}
      {feeWarnings.length > 0 && (
        <div className="space-y-2">
          {feeWarnings.map((warning, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <span className="text-sm text-amber-700 dark:text-amber-300">{warning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recipients Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
          {isConsolidation ? 'Destination' : state.outputs.length > 1 ? `Recipients (${state.outputs.length})` : 'Recipient'}
        </h3>

        {state.outputs.map((output, index) => (
          <OutputRow
            key={index}
            output={output}
            index={index}
            totalOutputs={state.outputs.length}
            isValid={state.outputsValid[index]}
            onAddressChange={handleAddressChange}
            onAmountChange={handleAmountChange}
            onAmountBlur={handleAmountBlur}
            onRemove={removeOutput}
            onToggleSendMax={toggleSendMax}
            onScanQR={handleScanQR}
            isConsolidation={isConsolidation}
            walletAddresses={walletAddresses}
            disabled={false}
            showScanner={state.scanningOutputIndex === index}
            scanningOutputIndex={state.scanningOutputIndex}
            payjoinUrl={state.payjoinUrl}
            payjoinStatus={state.payjoinStatus}
            videoRef={videoRef}
            canvasRef={canvasRef}
            unit={unit}
            unitLabel={unit === 'btc' ? 'BTC' : 'sats'}
            displayValue={getDisplayValue(output)}
            maxAmount={calculateMaxForOutput(index)}
            formatAmount={formatDisplayValue}
          />
        ))}

        {/* Add Output Button */}
        {state.transactionType === 'standard' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={addOutput}
            className="w-full"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Recipient
          </Button>
        )}
      </div>

      {/* Collapsible Panels */}
      <div className="space-y-2">
        {/* Coin Control Panel */}
        <div className="surface-secondary rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 overflow-hidden">
          <button
            onClick={handleToggleCoinControl}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-sanctuary-500" />
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Coin Control
              </span>
              {state.showCoinControl && state.selectedUTXOs.size > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                  {state.selectedUTXOs.size} UTXOs
                </span>
              )}
            </div>
            {coinControlExpanded ? (
              <ChevronUp className="w-4 h-4 text-sanctuary-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-sanctuary-400" />
            )}
          </button>

          {coinControlExpanded && (
            <div className="px-4 pb-4 space-y-3 border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={selectAllUtxos}>
                  Select All
                </Button>
                <Button variant="secondary" size="sm" onClick={clearUtxoSelection}>
                  Clear
                </Button>
                {!state.showCoinControl && (
                  <Button variant="primary" size="sm" onClick={toggleCoinControl}>
                    Enable
                  </Button>
                )}
              </div>

              {state.showCoinControl && remainingNeeded > 0 && (
                <div className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Need {format(remainingNeeded)} more to cover transaction
                </div>
              )}

              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {available.length === 0 ? (
                  <div className="text-center py-4 text-sanctuary-500 text-sm">
                    No spendable UTXOs
                  </div>
                ) : (
                  available.map(utxo => renderUtxo(utxo, true))
                )}
              </div>

              {/* Privacy Analysis Card */}
              {privacyAnalysis && state.selectedUTXOs.size >= 1 && (
                <SpendPrivacyCard analysis={privacyAnalysis} className="mt-3" />
              )}

              {/* Manually Frozen UTXOs (red) */}
              {manuallyFrozen.length > 0 && (
                <div className="pt-2 border-t border-sanctuary-200 dark:border-sanctuary-700">
                  <h4 className="text-xs font-medium text-rose-500 flex items-center gap-1 mb-2">
                    <Lock className="w-3 h-3" />
                    Frozen ({manuallyFrozen.length})
                  </h4>
                  <div className="space-y-2 opacity-60">
                    {manuallyFrozen.slice(0, 2).map(utxo => renderUtxo(utxo, false))}
                    {manuallyFrozen.length > 2 && (
                      <div className="text-xs text-sanctuary-500 text-center">
                        +{manuallyFrozen.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Draft-Locked UTXOs (blue) */}
              {draftLocked.length > 0 && (
                <div className="pt-2 border-t border-sanctuary-200 dark:border-sanctuary-700">
                  <h4 className="text-xs font-medium text-blue-500 flex items-center gap-1 mb-2">
                    <FileText className="w-3 h-3" />
                    Locked by Drafts ({draftLocked.length})
                  </h4>
                  <div className="space-y-2 opacity-60">
                    {draftLocked.slice(0, 2).map(utxo => renderUtxo(utxo, false))}
                    {draftLocked.length > 2 && (
                      <div className="text-xs text-sanctuary-500 text-center">
                        +{draftLocked.length - 2} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fee Panel */}
        <div className="surface-secondary rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 overflow-hidden">
          <button
            onClick={() => setFeeExpanded(!feeExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-sanctuary-500" />
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Network Fee
              </span>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
                {state.feeRate} sat/vB • {format(estimatedFee)}
              </span>
            </div>
            {feeExpanded ? (
              <ChevronUp className="w-4 h-4 text-sanctuary-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-sanctuary-400" />
            )}
          </button>

          {feeExpanded && (
            <div className="px-4 pb-4 border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
              <FeeSelector
                feeRate={state.feeRate}
                setFeeRate={setFeeRate}
                fees={fees}
                mempoolBlocks={mempoolBlocks}
                queuedBlocksSummary={queuedBlocksSummary}
              />
            </div>
          )}
        </div>

        {/* Advanced Options Panel */}
        <div className="surface-secondary rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 overflow-hidden">
          <button
            onClick={() => setAdvancedExpanded(!advancedExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-sanctuary-500" />
              <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Advanced Options
              </span>
              {(state.rbfEnabled || state.useDecoys || state.subtractFees) && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-700 dark:text-sanctuary-300">
                  {[
                    state.rbfEnabled && 'RBF',
                    state.useDecoys && 'Decoys',
                    state.subtractFees && 'Subtract',
                  ].filter(Boolean).join(', ')}
                </span>
              )}
            </div>
            {advancedExpanded ? (
              <ChevronUp className="w-4 h-4 text-sanctuary-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-sanctuary-400" />
            )}
          </button>

          {advancedExpanded && (
            <div className="px-4 pb-4 border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
              <AdvancedOptions
                showAdvanced={true}
                setShowAdvanced={() => {}}
                enableRBF={state.rbfEnabled}
                setEnableRBF={handleRbfChange}
                subtractFeesFromAmount={state.subtractFees}
                setSubtractFeesFromAmount={handleSubtractFeesChange}
                enableDecoyOutputs={state.useDecoys}
                setEnableDecoyOutputs={handleDecoysChange}
                decoyCount={state.decoyCount}
                setDecoyCount={handleDecoyCountChange}
                disabled={false}
              />
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <WizardNavigation />
    </div>
  );
}
