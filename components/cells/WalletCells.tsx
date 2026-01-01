/**
 * Wallet Cell Renderers
 *
 * Cell components for the WalletList ConfigurableTable.
 * Uses a factory pattern to inject shared dependencies (currency formatting, pending data).
 */

import React from 'react';
import { WalletType } from '../../types';
import type { Wallet } from '../../src/api/wallets';
import { RefreshCw, CheckCircle, AlertCircle, Clock, Users, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { getWalletIcon } from '../ui/CustomIcons';
import type { CellRendererProps } from '../ui/ConfigurableTable';

// Extended wallet type with data needed by cells
export interface WalletWithPending extends Wallet {
  pendingData?: {
    net: number;
    count: number;
    hasIncoming: boolean;
    hasOutgoing: boolean;
  };
}

// Currency formatter interface
interface CurrencyFormatter {
  format: (sats: number) => string;
  formatFiat: (sats: number) => string | null;
  showFiat: boolean;
}

/**
 * Create wallet cell renderers with injected dependencies
 */
export function createWalletCellRenderers(currency: CurrencyFormatter) {
  const { format, formatFiat, showFiat } = currency;

  // Name Cell - Icon + name + script type
  const NameCell: React.FC<CellRendererProps<WalletWithPending>> = ({ item: wallet }) => {
    const isMultisig = wallet.type === 'multi_sig';
    const iconClass = isMultisig
      ? 'text-warning-600 dark:text-warning-400'
      : 'text-success-600 dark:text-success-400';
    const walletTypeForIcon = isMultisig ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG;

    return (
      <div className="flex items-center">
        <div className="flex-shrink-0 h-8 w-8 rounded-full surface-secondary flex items-center justify-center">
          {getWalletIcon(walletTypeForIcon, `w-4 h-4 ${iconClass}`)}
        </div>
        <div className="ml-4">
          <div className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
            {wallet.name}
          </div>
          <div className="text-xs text-sanctuary-500 capitalize">
            {wallet.scriptType.replace('_', ' ')}
          </div>
        </div>
      </div>
    );
  };

  // Type Cell - Badge (multisig/single sig) + shared indicator
  const TypeCell: React.FC<CellRendererProps<WalletWithPending>> = ({ item: wallet }) => {
    const isMultisig = wallet.type === 'multi_sig';
    const badgeClass = isMultisig
      ? 'bg-warning-100 text-warning-800 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20'
      : 'bg-success-100 text-success-800 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20';

    return (
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeClass}`}>
          {isMultisig ? `${wallet.quorum} of ${wallet.totalSigners}` : 'Single Sig'}
        </span>
        {wallet.isShared && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-shared-100 text-shared-800 dark:bg-shared-100 dark:text-shared-700">
            <Users className="w-3 h-3" />
            Shared
          </span>
        )}
      </div>
    );
  };

  // Devices Cell - Device count
  const DevicesCell: React.FC<CellRendererProps<WalletWithPending>> = ({ item: wallet }) => {
    return (
      <div className="text-sm text-sanctuary-900 dark:text-sanctuary-100">
        {wallet.deviceCount} device{wallet.deviceCount !== 1 ? 's' : ''}
      </div>
    );
  };

  // Sync Cell - 5-state sync status
  const SyncCell: React.FC<CellRendererProps<WalletWithPending>> = ({ item: wallet }) => {
    if (wallet.syncInProgress) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Syncing
        </span>
      );
    }
    if (wallet.lastSyncStatus === 'success') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-success-600 dark:text-success-400">
          <CheckCircle className="w-3.5 h-3.5" />
          Synced
        </span>
      );
    }
    if (wallet.lastSyncStatus === 'failed') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-3.5 h-3.5" />
          Failed
        </span>
      );
    }
    if (wallet.lastSyncStatus === 'retrying') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-warning-600 dark:text-warning-400">
          <RefreshCw className="w-3.5 h-3.5" />
          Retrying
        </span>
      );
    }
    if (wallet.lastSyncStatus === 'partial') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-warning-600 dark:text-warning-400">
          <Clock className="w-3.5 h-3.5" />
          Partial
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-sanctuary-400">
        <Clock className="w-3.5 h-3.5" />
        Pending
      </span>
    );
  };

  // Pending Cell - Pending transaction type icons
  const PendingCell: React.FC<CellRendererProps<WalletWithPending>> = ({ item: wallet }) => {
    const pending = wallet.pendingData;

    if (!pending) {
      return <span className="text-sanctuary-300">—</span>;
    }

    return (
      <div className="inline-flex items-center gap-1">
        {pending.hasIncoming && (
          <span title="Pending received">
            <ArrowDownLeft className="w-4 h-4 text-success-500" />
          </span>
        )}
        {pending.hasOutgoing && (
          <span title="Pending sent">
            <ArrowUpRight className="w-4 h-4 text-sent-500" />
          </span>
        )}
      </div>
    );
  };

  // Balance Cell - BTC and fiat with inline net pending
  const BalanceCell: React.FC<CellRendererProps<WalletWithPending>> = ({ item: wallet }) => {
    const pending = wallet.pendingData;

    return (
      <>
        {/* BTC balance with inline net pending */}
        <div className="text-sm font-bold text-sanctuary-900 dark:text-sanctuary-100">
          {format(wallet.balance)}
          {pending && pending.net !== 0 && (
            <span
              className={`ml-1 text-xs font-normal ${
                pending.net > 0
                  ? 'text-success-600 dark:text-success-400'
                  : 'text-sent-600 dark:text-sent-400'
              }`}
            >
              ({pending.net > 0 ? '+' : ''}
              {format(pending.net)})
            </span>
          )}
        </div>
        {/* Fiat balance with inline net pending */}
        {showFiat && formatFiat(wallet.balance) && (
          <div className="text-xs text-primary-500 dark:text-primary-400">
            {formatFiat(wallet.balance)}
            {pending && pending.net !== 0 && (
              <span
                className={`ml-1 text-[10px] ${
                  pending.net > 0
                    ? 'text-success-600 dark:text-success-400'
                    : 'text-sent-600 dark:text-sent-400'
                }`}
              >
                ({pending.net > 0 ? '+' : ''}
                {formatFiat(pending.net)})
              </span>
            )}
          </div>
        )}
      </>
    );
  };

  return {
    name: NameCell,
    type: TypeCell,
    devices: DevicesCell,
    sync: SyncCell,
    pending: PendingCell,
    balance: BalanceCell,
  };
}
