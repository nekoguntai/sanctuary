/**
 * Dust Warning Badge Component
 *
 * Inline indicator for dust UTXOs showing amber warning icon, label, and tooltip
 * with spend cost details. A UTXO is considered dust when the fee to spend it
 * exceeds or approaches its value.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface DustWarningBadgeProps {
  spendCost: number;
  utxoAmount: number;
  feeRate: number;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export const DustWarningBadge: React.FC<DustWarningBadgeProps> = ({
  spendCost,
  utxoAmount,
  feeRate,
  size = 'sm',
  showLabel = true,
}) => {
  const costPercentage = Math.round((spendCost / utxoAmount) * 100);

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[9px]',
    md: 'px-2 py-1 text-[10px]',
  };

  const iconSizeClasses = {
    sm: 'w-2.5 h-2.5',
    md: 'w-3 h-3',
  };

  return (
    <span
      className={`inline-flex items-center rounded font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 ${sizeClasses[size]}`}
      title={`Uneconomical to spend: costs ${spendCost.toLocaleString()} sats (${costPercentage}% of value) at ${feeRate.toFixed(1)} sat/vB. Consider consolidating when fees are lower.`}
    >
      <AlertTriangle className={`${iconSizeClasses[size]} mr-0.5`} />
      {showLabel && 'DUST'}
    </span>
  );
};
