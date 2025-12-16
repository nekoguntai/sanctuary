/**
 * Transaction Flow Preview Component
 *
 * Visualizes Bitcoin transaction inputs and outputs in a flow diagram,
 * styled similar to mempool.space's transaction visualization.
 */

import React, { useMemo } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';

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

const truncateAddress = (address: string): string => {
  if (!address || address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
};

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
    const minHeight = 40;
    const maxHeight = 80;
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
      <div className="px-5 py-4 border-b border-[#2d2f43]/50 flex items-center justify-between">
        <span className="text-sm font-bold text-white">
          Transaction Preview
          {isEstimate && (
            <span className="ml-2 text-xs font-medium text-gray-300">(estimated)</span>
          )}
        </span>
        <div className="flex items-center gap-4 text-xs font-medium text-gray-300">
          <span>{inputs.length} input{inputs.length !== 1 ? 's' : ''}</span>
          <span>→</span>
          <span>{outputs.length} output{outputs.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Flow Visualization */}
      <div className="p-5">
        <div className="flex items-stretch gap-3 min-h-[140px]">
          {/* Inputs Column */}
          <div className="flex-1 flex flex-col gap-2">
            {inputs.map((input, idx) => (
              <div
                key={`${input.txid}:${input.vout}`}
                className="flex items-center rounded-2xl overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-green-500/30"
                style={{ height: getBarHeight(input.amount) }}
              >
                {/* Amount bar with gradient */}
                <div
                  className="h-full flex items-center justify-end px-4 min-w-[110px] rounded-l-2xl"
                  style={{
                    background: `linear-gradient(135deg, ${inputColor} 0%, #15803d 100%)`,
                  }}
                >
                  <span className="text-white text-sm font-semibold whitespace-nowrap drop-shadow-sm">
                    {isEstimate && '~'}{format(input.amount)}
                  </span>
                </div>
                {/* Address */}
                <div className="flex-1 px-4 py-2 bg-[#2d2f43]/80 backdrop-blur-sm flex items-center rounded-r-2xl">
                  <span className="font-mono text-xs text-white/90 truncate">
                    {truncateAddress(input.address)}
                  </span>
                  {input.label && (
                    <span className="ml-2 px-2 py-0.5 text-[10px] font-medium rounded-full bg-[#3d3f53] text-white/70">
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
          <div className="w-14 flex flex-col items-center justify-center relative">
            {/* Vertical connecting line with glow */}
            <div className="absolute top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-[#1a9436] via-[#4e4e7a] to-[#9c4dc4] shadow-lg shadow-purple-500/20" />
            {/* Arrow indicator */}
            <div className="relative z-10 w-8 h-8 rounded-full bg-gradient-to-br from-[#4e4e7a] to-[#3d3f53] shadow-lg flex items-center justify-center border border-[#5e5e8a]/30">
              <span className="text-white text-sm font-medium">→</span>
            </div>
          </div>

          {/* Outputs Column */}
          <div className="flex-1 flex flex-col gap-2">
            {outputs.map((output, idx) => (
              <div
                key={`${output.address}-${idx}`}
                className="flex items-center rounded-2xl overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-purple-500/30"
                style={{ height: getBarHeight(output.amount) }}
              >
                {/* Address */}
                <div className="flex-1 px-4 py-2 bg-[#2d2f43]/80 backdrop-blur-sm flex items-center rounded-l-2xl">
                  <span className="font-mono text-xs text-white/90 truncate">
                    {truncateAddress(output.address)}
                  </span>
                  {output.isChange && (
                    <span className="ml-2 px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/30 text-amber-300">
                      change
                    </span>
                  )}
                  {output.label && (
                    <span className="ml-2 px-2 py-0.5 text-[10px] font-medium rounded-full bg-[#3d3f53] text-white/70">
                      {output.label}
                    </span>
                  )}
                </div>
                {/* Amount bar with gradient */}
                <div
                  className="h-full flex items-center justify-start px-4 min-w-[110px] rounded-r-2xl"
                  style={{
                    background: output.isChange
                      ? `linear-gradient(135deg, ${changeColor} 0%, #4b5563 100%)`
                      : `linear-gradient(135deg, ${outputColor} 0%, #7c3aed 100%)`,
                  }}
                >
                  <span className="text-white text-sm font-semibold whitespace-nowrap drop-shadow-sm">
                    {isEstimate && '~'}{format(output.amount)}
                  </span>
                </div>
              </div>
            ))}

            {/* Fee row */}
            {fee > 0 && (
              <div
                className="flex items-center rounded-2xl overflow-hidden transition-all duration-300 hover:scale-[1.02]"
                style={{ height: Math.max(36, getBarHeight(fee) * 0.6) }}
              >
                <div className="flex-1 px-4 py-2 bg-[#2d2f43]/80 backdrop-blur-sm flex items-center rounded-l-2xl">
                  <span className="text-xs font-medium text-white/80">
                    Fee ({feeRate} sat/vB)
                  </span>
                </div>
                <div
                  className="h-full flex items-center justify-start px-4 min-w-[110px] rounded-r-2xl"
                  style={{
                    background: `linear-gradient(135deg, ${feeColor} 0%, #b91c1c 100%)`,
                  }}
                >
                  <span className="text-white text-sm font-semibold whitespace-nowrap drop-shadow-sm">
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
      <div className="px-4 py-3 border-t border-[#2d2f43] flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: inputColor }} />
          <span className="text-white/70 font-medium">Total:</span>
          <span className="text-white font-bold">
            {isEstimate && '~'}{format(totalInput)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/70 font-medium">Total:</span>
          <span className="text-white font-bold">
            {isEstimate && '~'}{format(totalOutput)}
          </span>
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: outputColor }} />
        </div>
      </div>
    </div>
  );
};

export default TransactionFlowPreview;
