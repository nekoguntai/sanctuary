/**
 * Transaction Flow Preview Component
 *
 * Visualizes Bitcoin transaction inputs and outputs in a flow diagram,
 * styled similar to mempool.space's transaction visualization.
 */

import React, { useMemo } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import { truncateAddress } from '../utils/formatters';

export interface FlowInput {
  txid: string;
  vout: number;
  address: string;
  amount: number;
  label?: string;
}

export interface FlowOutput {
  address: string;
  amount: number;
  isChange?: boolean;
  label?: string;
}

interface TransactionFlowPreviewProps {
  inputs: FlowInput[];
  outputs: FlowOutput[];
  fee: number;
  feeRate: number;
  totalInput: number;
  totalOutput: number;
  isEstimate?: boolean;
  className?: string;
}

export const TransactionFlowPreview: React.FC<TransactionFlowPreviewProps> = ({
  inputs,
  outputs,
  fee,
  feeRate,
  totalInput,
  totalOutput,
  isEstimate = false,
  className = '',
}) => {
  const { format } = useCurrency();

  // Calculate proportional heights for visualization
  const maxAmount = useMemo(() => {
    const allAmounts = [...inputs.map(i => i.amount), ...outputs.map(o => o.amount), fee];
    return Math.max(...allAmounts, 1);
  }, [inputs, outputs, fee]);

  const getBarHeight = (amount: number) => {
    const minHeight = 28;
    const maxHeight = 48;
    const proportion = amount / maxAmount;
    return Math.max(minHeight, proportion * maxHeight);
  };

  if (inputs.length === 0 && outputs.length === 0) {
    return null;
  }

  // mempool.space inspired colors
  const inputColor = '#1a9436'; // Green for inputs
  const outputColor = '#9c4dc4'; // Purple for outputs
  const changeColor = '#6c757d'; // Gray for change
  const feeColor = '#dc3545'; // Red for fee

  return (
    <div className={`rounded-3xl overflow-hidden bg-[#1d1f31] shadow-xl shadow-black/20 ring-1 ring-white/10 ${className}`}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#2d2f43]/50 flex items-center justify-between">
        <span className="text-xs font-bold text-white">
          Preview
          {isEstimate && (
            <span className="ml-1 text-[10px] font-medium text-gray-400">(est.)</span>
          )}
        </span>
        <div className="flex items-center gap-2 text-[10px] font-medium text-gray-400">
          <span>{inputs.length} in</span>
          <span>→</span>
          <span>{outputs.length} out</span>
        </div>
      </div>

      {/* Flow Visualization */}
      <div className="p-3">
        <div className="flex items-stretch gap-2 min-h-[80px]">
          {/* Inputs Column */}
          <div className="flex-1 flex flex-col gap-2">
            {inputs.map((input, idx) => (
              <div
                key={`${input.txid}:${input.vout}`}
                className="flex items-center rounded-xl overflow-hidden transition-all duration-200 hover:scale-[1.01]"
                style={{ height: getBarHeight(input.amount) }}
              >
                {/* Amount bar with gradient */}
                <div
                  className="h-full flex items-center justify-end px-2 min-w-[80px] rounded-l-xl"
                  style={{
                    background: `linear-gradient(135deg, ${inputColor} 0%, #15803d 100%)`,
                  }}
                >
                  <span className="text-white text-xs font-semibold whitespace-nowrap drop-shadow-sm">
                    {isEstimate && '~'}{format(input.amount)}
                  </span>
                </div>
                {/* Address */}
                <div className="flex-1 min-w-0 px-2 py-1 bg-[#2d2f43]/80 backdrop-blur-sm flex items-center rounded-r-xl overflow-hidden">
                  <span className="font-mono text-xs text-white/90 truncate flex-shrink min-w-0">
                    {truncateAddress(input.address, 8, 8)}
                  </span>
                  {input.label && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-cyan-500 text-white flex-shrink-0 whitespace-nowrap">
                      {input.label}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {inputs.length === 0 && (
              <div className="flex-1 flex items-center justify-center rounded-2xl bg-[#2d2f43]/50 text-white/60 text-sm font-medium">
                No inputs
              </div>
            )}
          </div>

          {/* Center Flow Lines */}
          <div className="w-8 flex flex-col items-center justify-center relative">
            {/* Vertical connecting line */}
            <div className="absolute top-1 bottom-1 w-0.5 rounded-full bg-gradient-to-b from-[#1a9436] via-[#4e4e7a] to-[#9c4dc4]" />
            {/* Arrow indicator */}
            <div className="relative z-10 w-5 h-5 rounded-full bg-[#4e4e7a] flex items-center justify-center">
              <span className="text-white text-xs">→</span>
            </div>
          </div>

          {/* Outputs Column */}
          <div className="flex-1 flex flex-col gap-2">
            {outputs.map((output, idx) => (
              <div
                key={`${output.address}-${idx}`}
                className="flex items-center rounded-xl overflow-hidden transition-all duration-200 hover:scale-[1.01]"
                style={{ height: getBarHeight(output.amount) }}
              >
                {/* Address */}
                <div className="flex-1 min-w-0 px-2 py-1 bg-[#2d2f43]/80 backdrop-blur-sm flex items-center rounded-l-xl overflow-hidden">
                  <span className="font-mono text-xs text-white/90 truncate flex-shrink min-w-0">
                    {truncateAddress(output.address, 8, 8)}
                  </span>
                  {output.isChange && (
                    <span className="ml-1 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-amber-500/30 text-amber-300 flex-shrink-0 whitespace-nowrap">
                      change
                    </span>
                  )}
                  {output.label && (
                    <span className="ml-1 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-cyan-500 text-white flex-shrink-0 whitespace-nowrap">
                      {output.label}
                    </span>
                  )}
                </div>
                {/* Amount bar with gradient */}
                <div
                  className="h-full flex items-center justify-start px-2 min-w-[80px] rounded-r-xl"
                  style={{
                    background: output.isChange
                      ? `linear-gradient(135deg, ${changeColor} 0%, #4b5563 100%)`
                      : `linear-gradient(135deg, ${outputColor} 0%, #7c3aed 100%)`,
                  }}
                >
                  <span className="text-white text-xs font-semibold whitespace-nowrap drop-shadow-sm">
                    {isEstimate && '~'}{format(output.amount)}
                  </span>
                </div>
              </div>
            ))}

            {/* Fee row */}
            {fee > 0 && (
              <div
                className="flex items-center rounded-xl overflow-hidden transition-all duration-200"
                style={{ height: Math.max(24, getBarHeight(fee) * 0.5) }}
              >
                <div className="flex-1 px-2 py-1 bg-[#2d2f43]/80 backdrop-blur-sm flex items-center rounded-l-xl">
                  <span className="text-[10px] font-medium text-white/80">
                    Fee ({feeRate} sat/vB)
                  </span>
                </div>
                <div
                  className="h-full flex items-center justify-start px-2 min-w-[80px] rounded-r-xl"
                  style={{
                    background: `linear-gradient(135deg, ${feeColor} 0%, #b91c1c 100%)`,
                  }}
                >
                  <span className="text-white text-xs font-semibold whitespace-nowrap drop-shadow-sm">
                    {isEstimate && '~'}{fee.toLocaleString()} sats
                  </span>
                </div>
              </div>
            )}

            {outputs.length === 0 && fee === 0 && (
              <div className="flex-1 flex items-center justify-center rounded-2xl bg-[#2d2f43]/50 text-white/60 text-sm font-medium">
                No outputs
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer with totals */}
      <div className="px-3 py-2 border-t border-[#2d2f43] flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: inputColor }} />
          <span className="text-white/70">In:</span>
          <span className="text-white font-semibold">
            {isEstimate && '~'}{format(totalInput)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-white/70">Out:</span>
          <span className="text-white font-semibold">
            {isEstimate && '~'}{format(totalOutput)}
          </span>
          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: outputColor }} />
        </div>
      </div>
    </div>
  );
};

export default TransactionFlowPreview;
