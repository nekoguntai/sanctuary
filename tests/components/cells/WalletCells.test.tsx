import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createWalletCellRenderers, type WalletWithPending } from '../../../components/cells/WalletCells';
import type { TableColumnConfig } from '../../../types';

vi.mock('lucide-react', () => ({
  RefreshCw: () => <span data-testid="refresh-icon" />,
  CheckCircle: () => <span data-testid="check-icon" />,
  AlertCircle: () => <span data-testid="alert-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  Users: () => <span data-testid="users-icon" />,
  ArrowDownLeft: () => <span data-testid="incoming-icon" />,
  ArrowUpRight: () => <span data-testid="outgoing-icon" />,
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  getWalletIcon: (_type: string, _className?: string) => <span data-testid="wallet-icon" />,
}));

const baseColumn: TableColumnConfig = { id: 'name', label: 'Name' };

const baseWallet: WalletWithPending = {
  id: 'wallet-1',
  name: 'Primary Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  deviceCount: 2,
  balance: 100000,
  syncInProgress: false,
  lastSyncStatus: 'success',
  isShared: false,
  quorum: 2,
  totalSigners: 3,
};

describe('WalletCells', () => {
  it('renders name cell with icon and script type', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(<renderers.name item={{ ...baseWallet, type: 'multi_sig' }} column={baseColumn} />);
    expect(screen.getByText('Primary Wallet')).toBeInTheDocument();
    expect(screen.getByText('native segwit')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-icon')).toBeInTheDocument();
  });

  it('renders type cell with multisig badge and shared indicator', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    render(
      <renderers.type
        item={{ ...baseWallet, type: 'multi_sig', isShared: true, quorum: 2, totalSigners: 3 }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Shared')).toBeInTheDocument();
    expect(screen.getByTestId('users-icon')).toBeInTheDocument();
  });

  it('renders devices count correctly', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    const { rerender } = render(<renderers.devices item={baseWallet} column={baseColumn} />);
    expect(screen.getByText('2 devices')).toBeInTheDocument();

    rerender(<renderers.devices item={{ ...baseWallet, deviceCount: 1 }} column={baseColumn} />);
    expect(screen.getByText('1 device')).toBeInTheDocument();
  });

  it('renders sync state icons', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    const { rerender } = render(
      <renderers.sync item={{ ...baseWallet, syncInProgress: true }} column={baseColumn} />
    );
    expect(screen.getByText('Syncing')).toBeInTheDocument();

    rerender(<renderers.sync item={{ ...baseWallet, syncInProgress: false, lastSyncStatus: 'failed' }} column={baseColumn} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();

    rerender(<renderers.sync item={{ ...baseWallet, lastSyncStatus: 'retrying' }} column={baseColumn} />);
    expect(screen.getByText('Retrying')).toBeInTheDocument();

    rerender(<renderers.sync item={{ ...baseWallet, lastSyncStatus: 'partial' }} column={baseColumn} />);
    expect(screen.getByText('Partial')).toBeInTheDocument();

    rerender(<renderers.sync item={{ ...baseWallet, lastSyncStatus: undefined }} column={baseColumn} />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders pending icons when pending data exists', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: () => null,
      showFiat: false,
    });

    const { rerender } = render(
      <renderers.pending item={baseWallet} column={baseColumn} />
    );
    expect(screen.getByText('—')).toBeInTheDocument();

    rerender(
      <renderers.pending
        item={{
          ...baseWallet,
          pendingData: { net: 1000, count: 2, hasIncoming: true, hasOutgoing: true },
        }}
        column={baseColumn}
      />
    );
    expect(screen.getByTestId('incoming-icon')).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-icon')).toBeInTheDocument();
  });

  it('renders balance with pending net and fiat', () => {
    const renderers = createWalletCellRenderers({
      format: (sats) => `${sats} sats`,
      formatFiat: (sats) => `$${(sats / 100000).toFixed(2)}`,
      showFiat: true,
    });

    render(
      <renderers.balance
        item={{
          ...baseWallet,
          pendingData: { net: -5000, count: 1, hasIncoming: false, hasOutgoing: true },
        }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('100000 sats')).toBeInTheDocument();
    expect(screen.getByText('(-5000 sats)')).toBeInTheDocument();
    expect(screen.getByText('$1.00')).toBeInTheDocument();
    expect(screen.getByText('($-0.05)')).toBeInTheDocument();
  });
});
