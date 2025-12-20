/**
 * Strategy Selector Component
 *
 * Tab-style buttons for UTXO selection strategies.
 * Strategies: Auto (default) | Privacy | Manual | Consolidate
 * Clicking non-Auto strategies expands the UTXO list for manual selection.
 */

import React from 'react';
import { Zap, Shield, Hand, RefreshCw, Info } from 'lucide-react';
import type { SelectionStrategy } from '../src/api/transactions';

// Map API strategy types to our UI strategy types
type UIStrategy = 'auto' | 'privacy' | 'manual' | 'consolidate';

interface StrategySelectorProps {
  strategy: UIStrategy;
  onStrategyChange: (strategy: UIStrategy) => void;
  disabled?: boolean;
}

const strategyConfig = {
  auto: {
    label: 'Auto',
    icon: Zap,
    tooltip: 'Recommended: Automatically select UTXOs for optimal efficiency',
    color: 'text-zen-indigo',
    bgColor: 'bg-zen-indigo/10',
    borderColor: 'border-zen-indigo/50',
    hoverBg: 'hover:bg-zen-indigo/20',
  },
  privacy: {
    label: 'Privacy',
    icon: Shield,
    tooltip: 'Prioritize privacy by minimizing address linking and metadata leakage',
    color: 'text-zen-matcha',
    bgColor: 'bg-zen-matcha/10',
    borderColor: 'border-zen-matcha/50',
    hoverBg: 'hover:bg-zen-matcha/20',
  },
  manual: {
    label: 'Manual',
    icon: Hand,
    tooltip: 'Manually select which UTXOs to include in the transaction',
    color: 'text-zen-gold',
    bgColor: 'bg-zen-gold/10',
    borderColor: 'border-zen-gold/50',
    hoverBg: 'hover:bg-zen-gold/20',
  },
  consolidate: {
    label: 'Consolidate',
    icon: RefreshCw,
    tooltip: 'Combine multiple UTXOs to reduce future fees and improve privacy',
    color: 'text-primary-600',
    bgColor: 'bg-primary-50',
    borderColor: 'border-primary-200',
    hoverBg: 'hover:bg-primary-100',
  },
};

export const StrategySelector: React.FC<StrategySelectorProps> = ({
  strategy,
  onStrategyChange,
  disabled = false,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-sanctuary-600 dark:text-sanctuary-400 uppercase tracking-wide">
          Selection Strategy
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(Object.keys(strategyConfig) as UIStrategy[]).map((key) => {
          const config = strategyConfig[key];
          const Icon = config.icon;
          const isActive = strategy === key;

          return (
            <button
              key={key}
              type="button"
              onClick={() => !disabled && onStrategyChange(key)}
              disabled={disabled}
              className={`
                group relative flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2
                transition-all duration-200 font-medium text-sm
                ${isActive
                  ? `${config.bgColor} ${config.borderColor} ${config.color}`
                  : 'border-sanctuary-200 dark:border-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-400 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : `cursor-pointer ${!isActive ? config.hoverBg : ''}`}
              `}
              title={config.tooltip}
            >
              <Icon className="w-4 h-4" />
              <span>{config.label}</span>

              {/* Tooltip on hover */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-sanctuary-900 dark:bg-sanctuary-100 text-white dark:text-sanctuary-900 text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none whitespace-nowrap z-10 shadow-lg">
                {config.tooltip}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-sanctuary-900 dark:border-t-sanctuary-100"></div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export type { UIStrategy };
