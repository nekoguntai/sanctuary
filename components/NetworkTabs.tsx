import React from 'react';
import { WalletNetwork } from '../types';

// Networks we support tabs for (excluding regtest which is dev-only)
export type TabNetwork = 'mainnet' | 'testnet' | 'signet';

interface NetworkTabsProps {
  selectedNetwork: TabNetwork;
  onNetworkChange: (network: TabNetwork) => void;
  walletCounts: Record<TabNetwork, number>;
  className?: string;
}

interface NetworkConfig {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  activeColor: string;
  activeBg: string;
}

const networkConfigs: Record<TabNetwork, NetworkConfig> = {
  mainnet: {
    label: 'Mainnet',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    activeColor: 'text-emerald-700 dark:text-emerald-300',
    activeBg: 'bg-emerald-100 dark:bg-emerald-900/40',
  },
  testnet: {
    label: 'Testnet',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    activeColor: 'text-amber-700 dark:text-amber-300',
    activeBg: 'bg-amber-100 dark:bg-amber-900/40',
  },
  signet: {
    label: 'Signet',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    borderColor: 'border-purple-200 dark:border-purple-800',
    activeColor: 'text-purple-700 dark:text-purple-300',
    activeBg: 'bg-purple-100 dark:bg-purple-900/40',
  },
};

export const NetworkTabs: React.FC<NetworkTabsProps> = ({
  selectedNetwork,
  onNetworkChange,
  walletCounts,
  className = '',
}) => {
  const networks: TabNetwork[] = ['mainnet', 'testnet', 'signet'];

  return (
    <div className={`flex space-x-2 ${className}`}>
      {networks.map((network) => {
        const config = networkConfigs[network];
        const count = walletCounts[network] || 0;
        const isSelected = selectedNetwork === network;
        const isEmpty = count === 0;

        return (
          <button
            key={network}
            onClick={() => onNetworkChange(network)}
            className={`
              relative px-4 py-2 rounded-xl font-medium text-sm transition-all duration-200
              border-2
              ${isSelected
                ? `${config.activeBg} ${config.activeColor} ${config.borderColor} shadow-sm`
                : `bg-transparent ${isEmpty ? 'text-sanctuary-400 dark:text-sanctuary-600 border-sanctuary-200 dark:border-sanctuary-800' : `${config.color} border-transparent hover:${config.bgColor}`}`
              }
              ${!isSelected && !isEmpty && 'hover:border-sanctuary-300 dark:hover:border-sanctuary-700'}
            `}
          >
            <span className="flex items-center space-x-2">
              <span>{config.label}</span>
              <span className={`
                px-1.5 py-0.5 rounded-md text-xs font-semibold
                ${isSelected
                  ? 'bg-white/50 dark:bg-black/20'
                  : isEmpty
                    ? 'bg-sanctuary-100 dark:bg-sanctuary-800'
                    : 'bg-white/50 dark:bg-white/10'
                }
              `}>
                {count}
              </span>
            </span>
            {isSelected && (
              <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-2 h-2 rounded-full ${config.activeBg} border-2 ${config.borderColor}`} />
            )}
          </button>
        );
      })}
    </div>
  );
};

export default NetworkTabs;
