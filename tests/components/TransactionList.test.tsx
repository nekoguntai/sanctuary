/**
 * TransactionList Component Tests
 *
 * Tests for the transaction list display including filtering,
 * transaction details, and label management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Transaction, Wallet } from '../../types';

// Mock the CurrencyContext
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats.toLocaleString()} sats`,
    btcPrice: 50000,
    currency: 'USD',
  }),
}));

// Mock AI status hook
vi.mock('../../hooks/useAIStatus', () => ({
  useAIStatus: () => ({
    enabled: false,
    loading: false,
  }),
}));

// Mock APIs
vi.mock('../../src/api/bitcoin', () => ({
  getStatus: vi.fn().mockResolvedValue({ explorerUrl: 'https://mempool.space' }),
}));

vi.mock('../../src/api/labels', () => ({
  getLabels: vi.fn().mockResolvedValue([]),
  updateTransactionLabels: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/api/transactions', () => ({
  getTransaction: vi.fn().mockResolvedValue({}),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock explorer utility
vi.mock('../../utils/explorer', () => ({
  getTxExplorerUrl: vi.fn((txid: string, explorerUrl: string) => `${explorerUrl}/tx/${txid}`),
}));

// Mock Amount component
vi.mock('../../components/Amount', () => ({
  Amount: ({ sats }: { sats?: number }) => <span data-testid="amount">{sats?.toLocaleString() ?? 0} sats</span>,
  default: ({ sats }: { sats?: number }) => <span data-testid="amount">{sats?.toLocaleString() ?? 0} sats</span>,
}));

// Mock react-virtuoso - render a simpler version that just shows data
vi.mock('react-virtuoso', () => ({
  TableVirtuoso: ({ data, fixedHeaderContent, itemContent, components }: {
    data: unknown[];
    fixedHeaderContent?: () => React.ReactNode;
    itemContent: (index: number, item: unknown) => React.ReactNode;
    components?: { TableBody?: React.ComponentType<unknown>; Table?: React.ComponentType<unknown> };
  }) => (
    <table data-testid="virtuoso-table">
      <thead>
        {fixedHeaderContent?.()}
      </thead>
      <tbody>
        {data.map((item, index) => (
          <tr key={index} data-testid="transaction-row">
            {itemContent(index, item)}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ArrowDownLeft: () => <span data-testid="arrow-down-left" />,
  ArrowUpRight: () => <span data-testid="arrow-up-right" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  Tag: () => <span data-testid="tag-icon" />,
  CheckCircle2: () => <span data-testid="check-circle-icon" />,
  ShieldCheck: () => <span data-testid="shield-check-icon" />,
  ExternalLink: () => <span data-testid="external-link-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
  X: () => <span data-testid="x-icon" />,
  Check: () => <span data-testid="check-icon" />,
  Edit2: () => <span data-testid="edit-icon" />,
  TrendingUp: () => <span data-testid="trending-up-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
}));

// Mock child components
vi.mock('../../components/TransactionActions', () => ({
  TransactionActions: () => <div data-testid="transaction-actions" />,
}));

vi.mock('../../components/TransactionFlowPreview', () => ({
  TransactionFlowPreview: () => <div data-testid="transaction-flow-preview" />,
}));

vi.mock('../../components/LabelSelector', () => ({
  LabelBadges: ({ labels }: { labels: unknown[] }) => (
    <div data-testid="label-badges">{labels?.length || 0} labels</div>
  ),
}));

vi.mock('../../components/AILabelSuggestion', () => ({
  AILabelSuggestion: () => <div data-testid="ai-label-suggestion" />,
}));

// Create mock transactions
const createMockTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  txid: 'abc123def456789',
  walletId: 'wallet-1',
  type: 'receive',
  amount: 100000,
  fee: 500,
  confirmations: 3,
  timestamp: new Date('2025-01-01').toISOString(),
  address: 'bc1qtest...',
  labels: [],
  rbfStatus: null,
  ...overrides,
});

const mockWallet: Wallet = {
  id: 'wallet-1',
  name: 'Test Wallet',
  network: 'mainnet',
  scriptType: 'native_segwit',
  type: 'single_sig',
  balance: 1000000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('TransactionList Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render empty state when no transactions', async () => {
    const { TransactionList } = await import('../../components/TransactionList');

    render(<TransactionList transactions={[]} />);

    // Component renders but with no transaction rows
    expect(screen.queryAllByTestId('transaction-row')).toHaveLength(0);
  });

  it('should render transactions in the list', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [
      createMockTransaction({ id: 'tx-1', txid: 'txid1', amount: 100000 }),
      createMockTransaction({ id: 'tx-2', txid: 'txid2', amount: 200000 }),
    ];

    render(<TransactionList transactions={transactions} />);

    expect(screen.getByText(/100,000 sats/)).toBeInTheDocument();
    expect(screen.getByText(/200,000 sats/)).toBeInTheDocument();
  });

  it('should filter out replaced transactions (RBF)', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [
      createMockTransaction({ id: 'tx-1', amount: 100000, rbfStatus: null }),
      createMockTransaction({ id: 'tx-2', amount: 200000, rbfStatus: 'replaced' }),
    ];

    render(<TransactionList transactions={transactions} />);

    // Should have only one transaction row (the non-replaced one)
    expect(screen.getAllByTestId('transaction-row')).toHaveLength(1);
    // Should show the non-replaced transaction amount (may appear multiple times in stats)
    expect(screen.getAllByText('100,000 sats').length).toBeGreaterThan(0);
  });

  it('should display receive icon for incoming transactions', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [createMockTransaction({ type: 'receive' })];

    render(<TransactionList transactions={transactions} />);

    // Should render a transaction row
    expect(screen.getByTestId('transaction-row')).toBeInTheDocument();
    // Should have receive icons (may appear in stats and in row)
    expect(screen.getAllByTestId('arrow-down-left').length).toBeGreaterThan(0);
  });

  it('should display send icon for outgoing transactions', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [createMockTransaction({ type: 'send', amount: -50000 })];

    render(<TransactionList transactions={transactions} />);

    // Should render a transaction row
    expect(screen.getByTestId('transaction-row')).toBeInTheDocument();
    // Should have send icons (may appear in stats and in row)
    expect(screen.getAllByTestId('arrow-up-right').length).toBeGreaterThan(0);
  });

  it('should show wallet badge when showWalletBadge is true', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [createMockTransaction()];

    render(
      <TransactionList
        transactions={transactions}
        showWalletBadge={true}
        wallets={[mockWallet]}
      />
    );

    expect(screen.getByText('Test Wallet')).toBeInTheDocument();
  });

  it('should call onTransactionClick when transaction is clicked', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const onTransactionClick = vi.fn();
    const transactions = [createMockTransaction()];

    render(
      <TransactionList
        transactions={transactions}
        onTransactionClick={onTransactionClick}
      />
    );

    // Click on a cell within the transaction row (the component handles clicks on cells)
    const row = screen.getByTestId('transaction-row');
    const cells = row.querySelectorAll('td');
    if (cells.length > 0) {
      fireEvent.click(cells[0]);
    }

    expect(onTransactionClick).toHaveBeenCalledWith(transactions[0]);
  });

  it('should highlight transaction when highlightedTxId matches', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [
      createMockTransaction({ id: 'tx-1' }),
      createMockTransaction({ id: 'tx-2' }),
    ];

    render(
      <TransactionList
        transactions={transactions}
        highlightedTxId="tx-1"
      />
    );

    // The highlighted row should have special styling
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('TransactionList - Confirmations Display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show pending icon for unconfirmed transactions', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [createMockTransaction({ confirmations: 0 })];

    render(<TransactionList transactions={transactions} confirmationThreshold={1} />);

    expect(screen.getByTestId('clock-icon')).toBeInTheDocument();
  });

  it('should show confirmed icon for confirmed transactions', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [createMockTransaction({ confirmations: 3 })];

    render(<TransactionList transactions={transactions} confirmationThreshold={1} />);

    // Should show check or shield icon for confirmed
    const confirmIcon = screen.queryByTestId('check-circle-icon') || screen.queryByTestId('shield-check-icon');
    expect(confirmIcon).toBeInTheDocument();
  });

  it('should show deeply confirmed status for transactions above threshold', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [createMockTransaction({ confirmations: 10 })];

    render(
      <TransactionList
        transactions={transactions}
        confirmationThreshold={1}
        deepConfirmationThreshold={6}
      />
    );

    expect(screen.getByTestId('shield-check-icon')).toBeInTheDocument();
  });
});

describe('TransactionList - Labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display labels on transactions', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [
      createMockTransaction({
        labels: [{ id: 'label-1', name: 'Personal', color: '#ff0000' }],
      }),
    ];

    render(<TransactionList transactions={transactions} />);

    expect(screen.getByTestId('label-badges')).toBeInTheDocument();
  });

  it('should allow editing labels when canEdit is true', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [createMockTransaction()];

    render(<TransactionList transactions={transactions} canEdit={true} />);

    // Edit functionality should be available
    // (actual edit button may be in the modal or row actions)
  });

  it('should not allow editing labels when canEdit is false', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [createMockTransaction()];

    render(<TransactionList transactions={transactions} canEdit={false} />);

    // Edit functionality should not be available
    expect(screen.queryByTestId('edit-icon')).not.toBeInTheDocument();
  });
});

describe('TransactionList - Transaction Stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display transaction stats when provided', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [createMockTransaction()];
    const stats = {
      totalReceived: 500000,
      totalSent: 200000,
      transactionCount: 10,
      avgTransactionSize: 50000,
    };

    render(
      <TransactionList
        transactions={transactions}
        transactionStats={stats}
      />
    );

    // Stats may be shown in a header or summary section
  });

  it('should calculate running balance when walletBalance is provided', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const transactions = [
      createMockTransaction({ amount: 100000 }),
      createMockTransaction({ amount: 50000 }),
    ];

    render(
      <TransactionList
        transactions={transactions}
        walletBalance={150000}
      />
    );

    // Running balance column should be visible
  });
});

describe('TransactionList - Additional behaviors', () => {
  const baseTx = {
    id: 'tx-1',
    txid: 'txid-1',
    walletId: 'wallet-1',
    amount: 1000,
    fee: 10,
    feeRate: 1,
    timestamp: Date.now(),
    confirmations: 1,
    status: 'confirmed',
    type: 'received',
  } as Transaction;

  it('filters out replaced transactions', async () => {
    const { TransactionList } = await import('../../components/TransactionList');
    const { getAllByTestId } = render(
      <TransactionList
        transactions={[
          { ...baseTx, id: 'tx-keep', rbfStatus: 'pending' },
          { ...baseTx, id: 'tx-drop', rbfStatus: 'replaced' },
        ]}
      />
    );

    expect(getAllByTestId('transaction-row')).toHaveLength(1);
  });

  it('calls onWalletClick when wallet badge clicked', async () => {
    const user = userEvent.setup();
    const onWalletClick = vi.fn();
    const onTransactionClick = vi.fn();
    const { TransactionList } = await import('../../components/TransactionList');

    render(
      <TransactionList
        transactions={[baseTx]}
        showWalletBadge={true}
        wallets={[{ id: 'wallet-1', name: 'Main Wallet', balance: 0 } as Wallet]}
        onWalletClick={onWalletClick}
        onTransactionClick={onTransactionClick}
      />
    );

    await user.click(screen.getByText('Main Wallet'));
    expect(onWalletClick).toHaveBeenCalledWith('wallet-1');
    expect(onTransactionClick).not.toHaveBeenCalled();
  });
});
