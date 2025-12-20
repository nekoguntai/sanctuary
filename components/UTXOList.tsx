import React, { useState, useEffect, useMemo } from 'react';
import { UTXO, WalletScriptType } from '../types';
import { Lock, Unlock, Check, ArrowUpRight, ExternalLink, FileText, AlertTriangle, Shield } from 'lucide-react';
import { Button } from './ui/Button';
import { useCurrency } from '../contexts/CurrencyContext';
import { Amount } from './Amount';
import * as bitcoinApi from '../src/api/bitcoin';
import { useFeeEstimates } from '../hooks/queries/useBitcoin';
import { PrivacyBadge } from './PrivacyBadge';
import type { UtxoPrivacyInfo, WalletPrivacySummary } from '../src/api/transactions';
import { createLogger } from '../utils/logger';

const log = createLogger('UTXOList');

// Input virtual bytes by script type (for dust calculation)
const INPUT_VBYTES: Record<WalletScriptType, number> = {
  legacy: 148,
  nested_segwit: 91,
  native_segwit: 68,
  taproot: 57.5,
};

/**
 * Calculate the dust threshold for a UTXO
 * A UTXO is considered dust if the fee to spend it exceeds its value
 * @param feeRate - Current fee rate in sat/vB
 * @param scriptType - Script type of the UTXO
 * @returns Dust threshold in satoshis
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

interface UTXOListProps {
  utxos: UTXO[];
  onToggleFreeze: (txid: string, vout: number) => void;
  selectable?: boolean;
  selectedUtxos?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSendSelected?: () => void;
  // Optional privacy data
  privacyData?: UtxoPrivacyInfo[];
  privacySummary?: WalletPrivacySummary;
  showPrivacy?: boolean;
}

export const UTXOList: React.FC<UTXOListProps> = ({
  utxos,
  onToggleFreeze,
  selectable = false,
  selectedUtxos = new Set(),
  onToggleSelect,
  onSendSelected,
  privacyData,
  privacySummary,
  showPrivacy = false,
}) => {
  const { format } = useCurrency();
  const [explorerUrl, setExplorerUrl] = useState('https://mempool.space');
  const { data: feeEstimates } = useFeeEstimates();

  // Create a map of privacy scores by UTXO ID for quick lookup
  const privacyMap = useMemo(() => {
    if (!privacyData) return new Map<string, UtxoPrivacyInfo>();
    return new Map(privacyData.map(p => [`${p.txid}:${p.vout}`, p]));
  }, [privacyData]);

  // Use the hour fee rate for dust calculation (reasonable baseline)
  const currentFeeRate = feeEstimates?.hour || 1;

  // Calculate dust statistics
  const dustStats = useMemo(() => {
    const dustUtxos = utxos.filter(u => !u.frozen && !u.lockedByDraftId && isDustUtxo(u, currentFeeRate));
    const dustTotal = dustUtxos.reduce((sum, u) => sum + u.amount, 0);
    return {
      count: dustUtxos.length,
      total: dustTotal,
    };
  }, [utxos, currentFeeRate]);

  // Load explorer URL from server config
  useEffect(() => {
    bitcoinApi.getStatus().then(status => {
      if (status.explorerUrl) setExplorerUrl(status.explorerUrl);
    }).catch(err => {
      log.error('Failed to fetch explorer URL', { error: err });
    });
  }, []);

  const selectedCount = selectedUtxos.size;
  const selectedAmount = utxos
    .filter(u => selectedUtxos.has(`${u.txid}:${u.vout}`))
    .reduce((acc, u) => acc + u.amount, 0);

  // UTXO Garden Logic
  const maxAmount = Math.max(...utxos.map(u => u.amount), 1);
  const now = Date.now();
  const DAY_MS = 86400000;

  const getAgeColor = (timestamp: number) => {
      const age = now - timestamp;
      if (age < DAY_MS) return 'bg-zen-matcha border-zen-matcha'; // Fresh
      if (age < DAY_MS * 30) return 'bg-zen-indigo border-zen-indigo'; // Month
      if (age < DAY_MS * 365) return 'bg-zen-gold border-zen-gold'; // Year
      return 'bg-sanctuary-700 border-sanctuary-700'; // Ancient
  };

  // Calculate proportional size using square root scaling (area proportional to amount)
  const MIN_SIZE = 14; // Minimum size in pixels
  const MAX_SIZE = 48; // Maximum size in pixels
  const getSize = (amount: number) => {
      // Use square root so circle AREA is proportional to amount (more perceptually accurate)
      const ratio = Math.sqrt(amount / maxAmount);
      return Math.round(MIN_SIZE + ratio * (MAX_SIZE - MIN_SIZE));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-4 sticky top-0 surface-muted z-10 py-2">
         <div className="flex items-center space-x-4">
            <h4 className="text-sm font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wide">Available Outputs</h4>
            <span className="text-xs text-sanctuary-400 surface-secondary px-2 py-1 rounded-full">{utxos.length} UTXOs</span>
         </div>
         <div className="flex items-center space-x-2">
            {selectable && selectedCount > 0 && onSendSelected && (
                <Button size="sm" onClick={onSendSelected} className="animate-fade-in">
                <ArrowUpRight className="w-4 h-4 mr-2" />
                Send {format(selectedAmount)}
                </Button>
            )}
         </div>
      </div>

      {/* Visualization Section - Always Visible */}
      <div className="surface-elevated rounded-xl p-3 border border-sanctuary-200 dark:border-sanctuary-800">
        <div className="flex flex-wrap gap-1.5 items-center justify-start">
            {utxos.map((utxo) => {
                const id = `${utxo.txid}:${utxo.vout}`;
                const isSelected = selectedUtxos.has(id);
                const utxoTimestamp = typeof utxo.date === 'string' ? new Date(utxo.date).getTime() : (utxo.date ?? now);
                const isLocked = !!utxo.lockedByDraftId;
                const isDisabled = utxo.frozen || isLocked;
                const isDust = !utxo.frozen && !isLocked && isDustUtxo(utxo, currentFeeRate);
                const spendCost = isDust ? getSpendCost(utxo, currentFeeRate) : 0;
                const colorClass = utxo.frozen || isLocked || isDust ? '' : getAgeColor(utxoTimestamp);

                // Red striped pattern for frozen UTXOs
                // Using zen-vermilion color (#e05a47)
                const frozenStyle = utxo.frozen ? {
                  background: `repeating-linear-gradient(
                    45deg,
                    #e05a47,
                    #e05a47 4px,
                    #c44a3a 4px,
                    #c44a3a 8px
                  )`
                } : {};

                // Cyan striped pattern for locked UTXOs (reserved for draft)
                const lockedStyle = isLocked && !utxo.frozen ? {
                  background: `repeating-linear-gradient(
                    45deg,
                    #06b6d4,
                    #06b6d4 4px,
                    #0891b2 4px,
                    #0891b2 8px
                  )`
                } : {};

                // Amber/orange dotted pattern for dust UTXOs (uneconomical to spend)
                const dustStyle = isDust ? {
                  background: `radial-gradient(circle at 25% 25%, #f59e0b 2px, transparent 2px),
                               radial-gradient(circle at 75% 75%, #f59e0b 2px, transparent 2px),
                               #d97706`
                } : {};

                const size = getSize(utxo.amount);
                const statusLabel = utxo.frozen ? '(Frozen)'
                  : isLocked ? `(Locked: ${utxo.lockedByDraftLabel || 'Draft'})`
                  : isDust ? `(Dust - costs ${format(spendCost)} to spend)`
                  : '';
                return (
                    <div
                        key={id}
                        onClick={() => !isDisabled && onToggleSelect && onToggleSelect(id)}
                        style={{
                            width: size,
                            height: size,
                            ...frozenStyle,
                            ...lockedStyle,
                            ...dustStyle
                        }}
                        className={`
                            relative rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-125 hover:z-10
                            ${isDisabled ? 'cursor-not-allowed' : ''}
                            ${isSelected ? 'ring-2 ring-offset-1 ring-sanctuary-400 dark:ring-offset-sanctuary-900' : ''}
                            ${colorClass} text-white shadow-md
                        `}
                        title={`${format(utxo.amount)} - ${utxo.label || 'No Label'} ${statusLabel}`}
                    >
                       <span className="text-[9px] font-bold opacity-0 hover:opacity-100 transition-opacity absolute bg-black/80 text-white px-1.5 py-0.5 rounded whitespace-nowrap -top-6 z-20 pointer-events-none">
                          {format(utxo.amount)}
                       </span>
                    </div>
                );
            })}
        </div>
        <div className="mt-3 pt-2 border-t border-sanctuary-100 dark:border-sanctuary-800 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-sanctuary-500">
            <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-zen-matcha mr-1"></span>Fresh</div>
            <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-zen-indigo mr-1"></span>&lt;1mo</div>
            <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-zen-gold mr-1"></span>&lt;1yr</div>
            <div className="flex items-center"><span className="w-2 h-2 rounded-full bg-sanctuary-700 mr-1"></span>Ancient</div>
            <div className="flex items-center"><span className="w-2 h-2 rounded-full mr-1" style={{background: 'radial-gradient(circle at 25% 25%, #f59e0b 1px, transparent 1px), radial-gradient(circle at 75% 75%, #f59e0b 1px, transparent 1px), #d97706'}}></span>Dust</div>
            <div className="flex items-center"><span className="w-2 h-2 rounded-full mr-1" style={{background: 'repeating-linear-gradient(45deg, #06b6d4, #06b6d4 2px, #0891b2 2px, #0891b2 4px)'}}></span>Locked</div>
            <div className="flex items-center"><span className="w-2 h-2 rounded-full mr-1" style={{background: 'repeating-linear-gradient(45deg, #e05a47, #e05a47 2px, #c44a3a 2px, #c44a3a 4px)'}}></span>Frozen</div>
            {showPrivacy && (
              <div className="flex items-center"><Shield className="w-2 h-2 mr-1 text-zen-indigo" />Privacy</div>
            )}
        </div>
      </div>

      {/* Privacy Summary */}
      {showPrivacy && privacySummary && (
        <div className="flex items-center gap-3 p-3 rounded-lg surface-secondary border border-sanctuary-200 dark:border-sanctuary-700">
          <Shield className="w-5 h-5 text-sanctuary-500 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-sanctuary-800 dark:text-sanctuary-200">
                Wallet Privacy Score: {privacySummary.averageScore}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                privacySummary.grade === 'excellent' ? 'bg-zen-matcha/10 text-zen-matcha' :
                privacySummary.grade === 'good' ? 'bg-zen-indigo/10 text-zen-indigo' :
                privacySummary.grade === 'fair' ? 'bg-zen-gold/10 text-zen-gold' :
                'bg-zen-vermilion/10 text-zen-vermilion'
              }`}>
                {privacySummary.grade}
              </span>
            </div>
            {privacySummary.recommendations.length > 0 && (
              <p className="text-xs text-sanctuary-500 mt-0.5">
                {privacySummary.recommendations[0]}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Dust Warning Banner */}
      {dustStats.count > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              <span className="font-medium">{dustStats.count} dust UTXO{dustStats.count > 1 ? 's' : ''}</span>
              {' '}totaling <span className="font-mono">{format(dustStats.total)}</span>
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
              These outputs cost more to spend than they're worth at current fee rates ({currentFeeRate.toFixed(1)} sat/vB).
              Consider consolidating when fees are lower.
            </p>
          </div>
        </div>
      )}

      {/* Tabular List Section */}
      <div className="grid gap-3">
        {utxos.map((utxo) => {
        const id = `${utxo.txid}:${utxo.vout}`;
        const isSelected = selectedUtxos.has(id);
        const isFrozen = utxo.frozen;
        const isLocked = !!utxo.lockedByDraftId;
        const isDisabled = isFrozen || isLocked;
        const isDust = !isFrozen && !isLocked && isDustUtxo(utxo, currentFeeRate);
        const spendCost = isDust ? getSpendCost(utxo, currentFeeRate) : 0;
        const privacyInfo = privacyMap.get(id);

        return (
            <div
            key={id}
            className={`group relative p-4 rounded-xl border transition-all duration-200
                ${isFrozen
                ? 'bg-zen-vermilion/5 border-zen-vermilion/20 dark:bg-zen-vermilion/10'
                : isLocked
                    ? 'bg-cyan-50 border-cyan-200 dark:bg-cyan-900/10 dark:border-cyan-800/50'
                    : isDust
                        ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800/50'
                        : isSelected
                            ? 'bg-zen-gold/10 border-zen-gold/50 shadow-sm'
                            : 'bg-white border-sanctuary-200 dark:bg-sanctuary-900 dark:border-sanctuary-800 hover:border-sanctuary-300 dark:hover:border-sanctuary-700 shadow-sm'
                }`}
            >
            <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4">
                {selectable && !isDisabled && (
                    <div
                    onClick={() => onToggleSelect && onToggleSelect(id)}
                    className={`mt-1 flex-shrink-0 w-5 h-5 rounded border cursor-pointer flex items-center justify-center transition-colors ${isSelected ? 'bg-sanctuary-800 border-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900' : 'border-sanctuary-300 dark:border-sanctuary-600 hover:border-sanctuary-400'}`}
                    >
                    {isSelected && <Check className="w-3 h-3" />}
                    </div>
                )}

                <div className="space-y-1">
                    <div className={`font-mono font-medium flex items-center gap-2 ${isFrozen ? 'text-zen-vermilion' : isLocked ? 'text-cyan-600 dark:text-cyan-400' : isDust ? 'text-amber-600 dark:text-amber-400' : 'text-sanctuary-900 dark:text-sanctuary-100'}`}>
                      <Amount sats={utxo.amount} size="lg" />
                      {isDust && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title={`Costs ${format(spendCost)} to spend at current fees`}>
                          <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                          DUST
                        </span>
                      )}
                      {showPrivacy && privacyInfo && (
                        <PrivacyBadge
                          score={privacyInfo.score.score}
                          grade={privacyInfo.score.grade}
                          size="sm"
                        />
                      )}
                    </div>
                    <a
                      href={`${explorerUrl}/address/${utxo.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-sanctuary-500 font-mono break-all max-w-md hover:text-primary-500 dark:hover:text-primary-400 hover:underline inline-flex items-center"
                      title={`View address ${utxo.address} on block explorer`}
                    >
                    {utxo.address}
                    <ExternalLink className="w-2.5 h-2.5 ml-1 flex-shrink-0" />
                    </a>
                    <div className="flex flex-wrap gap-1">
                    {utxo.label && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-sanctuary-100 text-sanctuary-800 dark:bg-sanctuary-800 dark:text-sanctuary-300">
                        {utxo.label}
                    </span>
                    )}
                    {isLocked && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300" title={`Reserved for draft: ${utxo.lockedByDraftLabel || 'Unnamed draft'}`}>
                        <FileText className="w-3 h-3 mr-1" />
                        {utxo.lockedByDraftLabel || 'Pending Draft'}
                    </span>
                    )}
                    </div>
                </div>
                </div>

                <div className="flex flex-col items-end space-y-2">
                <button 
                    onClick={(e) => { e.stopPropagation(); onToggleFreeze(utxo.txid, utxo.vout); }}
                    title={isFrozen ? "Unfreeze coin for spending" : "Freeze coin to prevent spending"}
                    className={`p-2 rounded-lg transition-colors ${
                        isFrozen 
                        ? "bg-zen-vermilion/10 text-zen-vermilion hover:bg-zen-vermilion/20" 
                        : "text-sanctuary-300 hover:text-zen-matcha hover:bg-zen-matcha/10"
                    }`}
                >
                    {isFrozen ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                </button>
                <div className="text-xs text-sanctuary-400 text-right">
                    {utxo.confirmations.toLocaleString()} confs
                    <br/>
                    <span className="text-[10px] opacity-70">{new Date(utxo.date).toLocaleDateString()}</span>
                    <br/>
                    <a
                      href={`${explorerUrl}/tx/${utxo.txid}#vout=${utxo.vout}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center font-mono text-[10px] text-primary-500 hover:text-primary-600 dark:text-primary-400 dark:hover:text-primary-300 hover:underline"
                      title={`View transaction ${utxo.txid} output #${utxo.vout} on block explorer`}
                    >
                      txid:{utxo.txid.substring(0,8)}...:{utxo.vout}
                      <ExternalLink className="w-2.5 h-2.5 ml-1" />
                    </a>
                </div>
                </div>
            </div>
            </div>
        );
        })}
      </div>
    </div>
  );
};