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
    color: 'text-success-700 dark:text-success-600',
    bgColor: 'bg-success-50 dark:bg-success-900/30',
    borderColor: 'border-success-500 dark:border-success-500',
    activeColor: 'text-white dark:text-white',
    activeBg: 'bg-success-600 dark:bg-success-600',
  },
  testnet: {
    label: 'Testnet',
    color: 'text-warning-700 dark:text-warning-600',
    bgColor: 'bg-warning-50 dark:bg-warning-900/30',
    borderColor: 'border-warning-500 dark:border-warning-500',
    activeColor: 'text-white dark:text-white',
    activeBg: 'bg-warning-600 dark:bg-warning-600',
  },
  signet: {
    label: 'Signet',
    color: 'text-purple-700 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-900/30',
    borderColor: 'border-purple-500 dark:border-purple-500',
    activeColor: 'text-white dark:text-white',
    activeBg: 'bg-purple-600 dark:bg-purple-600',
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
                  ? 'bg-white/30 text-white'
                  : isEmpty
                    ? 'bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500 dark:text-sanctuary-400'
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
