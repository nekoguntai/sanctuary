import { useRef, useState, useEffect, useCallback } from 'react';

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
  dotColor: string;
}

const networkConfigs: Record<TabNetwork, NetworkConfig> = {
  mainnet: {
    label: 'Mainnet',
    dotColor: 'bg-mainnet-500',
  },
  testnet: {
    label: 'Testnet',
    dotColor: 'bg-testnet-500',
  },
  signet: {
    label: 'Signet',
    dotColor: 'bg-signet-500',
  },
};

export const NetworkTabs = ({
  selectedNetwork,
  onNetworkChange,
  walletCounts,
  className = '',
}: NetworkTabsProps) => {
  const networks: TabNetwork[] = ['mainnet', 'testnet', 'signet'];
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    /* v8 ignore start -- defensive guard; ref is always attached after mount */
    if (!navRef.current) return;
    /* v8 ignore stop */
    const activeEl = navRef.current.querySelector('[data-active="true"]') as HTMLElement | null;
    if (activeEl) {
      setIndicator({
        left: activeEl.offsetLeft,
        width: activeEl.offsetWidth,
      });
    }
  }, []);

  useEffect(() => {
    updateIndicator();
  }, [selectedNetwork, updateIndicator]);

  useEffect(() => {
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  return (
    <div className={className}>
      <nav ref={navRef} className="relative inline-flex gap-0.5 p-0.5 surface-secondary rounded-md" aria-label="Network tabs">
        {/* Sliding indicator */}
        <div
          className="absolute top-0.5 bottom-0.5 rounded bg-white dark:bg-sanctuary-700 shadow-sm transition-all duration-300 ease-out z-0"
          style={{ left: indicator.left, width: indicator.width }}
        />
        {networks.map((network) => {
          const config = networkConfigs[network];
          const count = walletCounts[network] || 0;
          const isSelected = selectedNetwork === network;

          return (
            <button
              key={network}
              data-active={isSelected}
              onClick={() => onNetworkChange(network)}
              className={`
                relative z-10 px-3 py-1.5 text-xs font-medium rounded transition-colors duration-200
                ${isSelected
                  ? 'text-sanctuary-900 dark:text-sanctuary-50'
                  : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300'
                }
              `}
            >
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`} aria-hidden="true" />
                <span>{config.label}</span>
                <span className="text-sanctuary-400 text-[10px] tabular-nums">{count}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default NetworkTabs;
