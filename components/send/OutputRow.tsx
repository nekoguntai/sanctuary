/**
 * OutputRow Component
 *
 * Single output row for multi-output transactions including:
 * - Address input (with consolidation dropdown option)
 * - Amount input with send-max toggle
 * - QR scanner trigger
 * - Validation display
 * - Payjoin indicator
 *
 * Extracted from SendTransaction.tsx for maintainability.
 */

import React, { RefObject } from 'react';
import { Check, X, Shield, QrCode, ChevronDown, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import type { OutputEntry } from '../../hooks/useOutputManagement';

export interface OutputRowProps {
  // Output data
  output: OutputEntry;
  index: number;
  totalOutputs: number;
  isValid: boolean | null;

  // Handlers
  onAddressChange: (index: number, value: string) => void;
  onAmountChange: (index: number, displayValue: string, satsValue: string) => void;
  onAmountBlur: (index: number) => void;
  onRemove: (index: number) => void;
  onToggleSendMax: (index: number) => void;
  onScanQR: (index: number) => void;

  // Consolidation mode
  isConsolidation?: boolean;
  walletAddresses?: string[];

  // State flags
  disabled?: boolean;
  showScanner?: boolean;
  scanningOutputIndex?: number | null;

  // Payjoin
  payjoinUrl?: string | null;
  payjoinStatus?: 'idle' | 'attempting' | 'success' | 'failed';

  // QR Scanner refs (only needed when scanner is active for this output)
  videoRef?: RefObject<HTMLVideoElement>;
  canvasRef?: RefObject<HTMLCanvasElement>;

  // Currency display
  unit: string;
  unitLabel: string;
  displayValue: string;

  // Max amount calculation
  maxAmount: number;
  formatAmount: (sats: number) => string;
}

export function OutputRow({
  output,
  index,
  totalOutputs,
  isValid,
  onAddressChange,
  onAmountChange,
  onAmountBlur,
  onRemove,
  onToggleSendMax,
  onScanQR,
  isConsolidation = false,
  walletAddresses = [],
  disabled = false,
  showScanner = false,
  scanningOutputIndex = null,
  payjoinUrl = null,
  payjoinStatus = 'idle',
  videoRef,
  canvasRef,
  unit,
  unitLabel,
  displayValue,
  maxAmount,
  formatAmount,
}: OutputRowProps) {
  const isMultiOutput = totalOutputs > 1;
  const isScanningThis = showScanner && scanningOutputIndex === index;
  const hasPayjoin = payjoinUrl && index === 0;

  // Determine border color for address input
  const getAddressBorderClass = () => {
    if (isValid === true) return 'border-green-500 dark:border-green-400';
    if (isValid === false) return 'border-rose-500 dark:border-rose-400';
    if (hasPayjoin) return 'border-zen-indigo dark:border-zen-indigo';
    return 'border-sanctuary-300 dark:border-sanctuary-700';
  };

  return (
    <div className={`space-y-2 ${isMultiOutput ? 'p-3 rounded-lg surface-secondary border border-sanctuary-200 dark:border-sanctuary-700' : ''}`}>
      {/* Multi-output header */}
      {isMultiOutput && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-sanctuary-500">Output #{index + 1}</span>
          {!disabled && (
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="text-sanctuary-400 hover:text-rose-500 transition-colors"
              title="Remove output"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Address Input */}
      {isConsolidation && index === 0 ? (
        <div className="relative">
          <select
            value={output.address}
            onChange={(e) => onAddressChange(index, e.target.value)}
            disabled={disabled}
            className={`block w-full px-4 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-700 surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors appearance-none pr-10 font-mono text-sm ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {walletAddresses.map((addr, idx) => (
              <option key={addr} value={addr}>
                #{idx}: {addr.slice(0, 12)}...{addr.slice(-8)}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-4 top-3.5 w-5 h-5 text-sanctuary-400 pointer-events-none" />
        </div>
      ) : (
        <div className="flex space-x-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={output.address}
              onChange={(e) => onAddressChange(index, e.target.value)}
              disabled={disabled}
              placeholder="bc1q... or bitcoin:..."
              className={`block w-full px-4 py-2.5 rounded-xl border ${getAddressBorderClass()} surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors text-sm ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            {hasPayjoin ? (
              <Shield className="absolute right-4 top-3 w-4 h-4 text-zen-indigo" />
            ) : isValid === true ? (
              <Check className="absolute right-4 top-3 w-4 h-4 text-green-500" />
            ) : isValid === false ? (
              <X className="absolute right-4 top-3 w-4 h-4 text-rose-500" />
            ) : null}
          </div>
          {!disabled && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onScanQR(index)}
            >
              {isScanningThis ? <X className="w-4 h-4" /> : <QrCode className="w-4 h-4" />}
            </Button>
          )}
        </div>
      )}

      {/* Validation error */}
      {!isConsolidation && isValid === false && (
        <p className="text-xs text-rose-500">Invalid Bitcoin address</p>
      )}

      {/* Payjoin indicator */}
      {hasPayjoin && (
        <div className="flex items-center space-x-1.5 mt-1">
          <Shield className="w-3 h-3 text-zen-indigo" />
          <p className="text-xs text-zen-indigo">
            Payjoin enabled - enhanced privacy for this transaction
            {payjoinStatus === 'attempting' && ' (attempting...)'}
            {payjoinStatus === 'success' && ' ✓'}
            {payjoinStatus === 'failed' && ' (fell back to regular send)'}
          </p>
        </div>
      )}

      {/* QR Scanner */}
      {isScanningThis && videoRef && canvasRef && (
        <div className="relative overflow-hidden rounded-xl bg-black aspect-video flex items-center justify-center">
          <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="z-10 border-2 border-white/50 w-48 h-48 rounded-lg"></div>
          <p className="absolute bottom-4 z-10 text-white bg-black/50 px-3 py-1 rounded-full text-xs">Scan Bitcoin QR Code</p>
        </div>
      )}

      {/* Amount Input */}
      <div className="flex items-center space-x-2">
        <div className="flex-1 relative">
          <input
            type="text"
            inputMode={unit === 'btc' ? 'decimal' : 'numeric'}
            value={output.sendMax ? formatAmount(maxAmount) : displayValue}
            onChange={(e) => {
              const value = e.target.value;
              // Allow empty, digits, and decimal point for BTC mode
              const isValidBtc = value === '' || /^[0-9]*\.?[0-9]*$/.test(value);
              const isValidSats = value === '' || /^[0-9]*$/.test(value);

              if ((unit === 'btc' && isValidBtc) || (unit !== 'btc' && isValidSats)) {
                onAmountChange(index, value, value);
              }
            }}
            onBlur={() => onAmountBlur(index)}
            placeholder="0"
            readOnly={output.sendMax || disabled}
            disabled={disabled}
            className={`block w-full px-4 py-2.5 pr-20 rounded-xl border text-sm ${
              output.sendMax
                ? 'border-primary-400 dark:border-primary-500 bg-primary-50/50 dark:bg-primary-900/10'
                : 'border-sanctuary-300 dark:border-sanctuary-700'
            } surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
          <div className="absolute right-3 top-2.5 text-sanctuary-400 text-xs flex items-center">
            {output.sendMax && !disabled && (
              <button
                type="button"
                onClick={() => onToggleSendMax(index)}
                className="mr-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-primary-500 text-white rounded hover:bg-primary-600 transition-colors"
                title="Click to exit MAX mode"
              >
                MAX
              </button>
            )}
            <span className="pointer-events-none">{unitLabel}</span>
          </div>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onToggleSendMax(index)}
            className={`px-3 py-2.5 text-xs font-medium rounded-xl border transition-colors ${
              output.sendMax
                ? 'bg-primary-500 text-white border-primary-500 hover:bg-primary-600'
                : 'border-sanctuary-300 dark:border-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
            }`}
          >
            MAX
          </button>
        )}
      </div>
    </div>
  );
}
