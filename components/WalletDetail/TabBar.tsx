import React from 'react';
import { TabType } from './types';

interface TabBarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  userRole: string;
  draftsCount: number;
}

export const TabBar: React.FC<TabBarProps> = ({
  activeTab,
  onTabChange,
  userRole,
  draftsCount,
}) => {
  const tabs: TabType[] = [
    'tx',
    'utxo',
    'addresses',
    ...(userRole !== 'viewer' ? ['drafts' as TabType] : []),
    'stats',
    ...(userRole === 'owner' ? ['access' as TabType] : []),
    'settings',
    'log',
  ];

  return (
    <div className="overflow-x-auto scrollbar-hide">
      <nav className="flex gap-1 p-1 surface-secondary rounded-xl" aria-label="Tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`${
              activeTab === tab
                ? 'bg-white dark:bg-sanctuary-700 text-primary-700 dark:text-primary-300 shadow-sm'
                : 'text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'
            } whitespace-nowrap py-2 px-3.5 rounded-lg font-medium text-sm capitalize transition-all duration-200 relative focus-visible:ring-2 focus-visible:ring-primary-500`}
          >
            {tab === 'tx' ? 'Transactions' : tab === 'utxo' ? 'UTXOs' : tab}
            {tab === 'drafts' && draftsCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-400 dark:bg-rose-500 text-[10px] font-bold text-white">
                {draftsCount > 9 ? '9+' : draftsCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
};
