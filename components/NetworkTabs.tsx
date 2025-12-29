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
    color: 'text-sanctuary-500 dark:text-sanctuary-400',  // Muted when not selected
    bgColor: 'bg-mainnet-50 dark:bg-mainnet-900/30',
    borderColor: 'border-mainnet-500 dark:border-mainnet-400',
    activeColor: 'text-white',  // White text for contrast on colored bg
    activeBg: 'bg-mainnet-500 dark:bg-mainnet-500',
  },
  testnet: {
    label: 'Testnet',
    color: 'text-sanctuary-500 dark:text-sanctuary-400',
    bgColor: 'bg-testnet-50 dark:bg-testnet-900/30',
    borderColor: 'border-testnet-500 dark:border-testnet-400',
    activeColor: 'text-white',
    activeBg: 'bg-testnet-500 dark:bg-testnet-500',
  },
  signet: {
    label: 'Signet',
    color: 'text-sanctuary-500 dark:text-sanctuary-400',
    bgColor: 'bg-signet-50 dark:bg-signet-900/30',
    borderColor: 'border-signet-500 dark:border-signet-400',
    activeColor: 'text-white',
    activeBg: 'bg-signet-500 dark:bg-signet-500',
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
                : isEmpty
                  ? 'bg-transparent text-sanctuary-400 dark:text-sanctuary-600 border-sanctuary-200 dark:border-sanctuary-800'
                  : `bg-transparent ${config.color} ${config.borderColor} hover:${config.bgColor}`
              }
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
