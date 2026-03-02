import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CoinControlPanel } from '../../components/CoinControlPanel';
import type { UTXO } from '../../types';

const {
  mockGetWalletPrivacy,
  mockAnalyzeSpendPrivacy,
  mockSelectUtxos,
  mockLogError,
} = vi.hoisted(() => ({
  mockGetWalletPrivacy: vi.fn(),
  mockAnalyzeSpendPrivacy: vi.fn(),
  mockSelectUtxos: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('../../src/api/transactions', () => ({
  getWalletPrivacy: (...args: unknown[]) => mockGetWalletPrivacy(...args),
  analyzeSpendPrivacy: (...args: unknown[]) => mockAnalyzeSpendPrivacy(...args),
  selectUtxos: (...args: unknown[]) => mockSelectUtxos(...args),
}));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats} sats`,
  }),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: (...args: unknown[]) => mockLogError(...args),
  }),
}));

vi.mock('../../components/StrategySelector', () => ({
  StrategySelector: ({ onStrategyChange }: { onStrategyChange: (strategy: string) => void }) => (
    <div>
      <button onClick={() => onStrategyChange('privacy')}>mock-strategy-privacy</button>
      <button onClick={() => onStrategyChange('manual')}>mock-strategy-manual</button>
      <button onClick={() => onStrategyChange('unknown')}>mock-strategy-unknown</button>
    </div>
  ),
}));

vi.mock('../../components/CoinControlPanel/UtxoRow', () => ({
  UtxoRow: ({
    utxo,
    onToggle,
  }: {
    utxo: { txid: string; vout: number };
    onToggle: (utxoId: string) => void;
  }) => (
    <button onClick={() => onToggle(`${utxo.txid}:${utxo.vout}`)}>
      row-{utxo.txid}:{utxo.vout}
    </button>
  ),
}));

vi.mock('../../components/SpendPrivacyCard', () => ({
  default: ({ analysis }: { analysis: { grade: string } }) => <div>privacy-{analysis.grade}</div>,
}));

describe('CoinControlPanel second-pass branches', () => {
  const utxos: UTXO[] = [
    {
      id: 'u1',
      txid: 'a',
      vout: 0,
      amount: 15_000,
      address: 'bc1qa',
      confirmations: 3,
      frozen: false,
      scriptType: 'native_segwit',
    },
    {
      id: 'u2',
      txid: 'b',
      vout: 1,
      amount: 20_000,
      address: 'bc1qb',
      confirmations: 5,
      frozen: false,
      scriptType: 'native_segwit',
    },
  ];

  const makeProps = (overrides: Partial<React.ComponentProps<typeof CoinControlPanel>> = {}) => ({
    walletId: 'wallet-1',
    utxos,
    selectedUtxos: new Set<string>(),
    onToggleSelect: vi.fn(),
    onSetSelectedUtxos: vi.fn(),
    feeRate: 10,
    targetAmount: 20_000,
    strategy: 'auto' as const,
    onStrategyChange: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWalletPrivacy.mockResolvedValue({
      utxos: [],
      summary: { averageScore: 0, grade: 'poor' },
    });
    mockAnalyzeSpendPrivacy.mockResolvedValue({
      score: 70,
      grade: 'good',
      linkedAddresses: 1,
      warnings: [],
    });
    mockSelectUtxos.mockResolvedValue({
      selected: [{ txid: 'a', vout: 0 }],
      totalAmount: 15_000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles wallet-privacy fetch resolving after unmount without state updates', async () => {
    let resolvePrivacy: ((value: unknown) => void) | undefined;
    mockGetWalletPrivacy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrivacy = resolve;
        })
    );

    const { unmount } = render(<CoinControlPanel {...makeProps()} />);
    fireEvent.click(screen.getByText(/Coin Control/));
    unmount();

    resolvePrivacy?.({
      utxos: [],
      summary: { averageScore: 0, grade: 'poor' },
    });
    await Promise.resolve();

    expect(mockGetWalletPrivacy).toHaveBeenCalledWith('wallet-1');
  });

  it('ignores stale analysis rejection and clears debounce timeout on cleanup', async () => {
    vi.useFakeTimers();

    let rejectFirst: ((reason?: unknown) => void) | undefined;
    mockAnalyzeSpendPrivacy
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          })
      )
      .mockResolvedValueOnce({
        score: 65,
        grade: 'fair',
        linkedAddresses: 2,
        warnings: [],
      });

    const initialProps = makeProps({
      strategy: 'manual',
      selectedUtxos: new Set(['a:0']),
    });
    const { rerender } = render(<CoinControlPanel {...initialProps} />);
    fireEvent.click(screen.getByText(/Coin Control/));

    await vi.advanceTimersByTimeAsync(350);
    rerender(
      <CoinControlPanel
        {...initialProps}
        selectedUtxos={new Set(['a:0', 'b:1'])}
      />
    );
    await vi.advanceTimersByTimeAsync(350);

    rejectFirst?.(new Error('stale-request'));
    await Promise.resolve();

    expect(mockAnalyzeSpendPrivacy).toHaveBeenCalledTimes(2);
    expect(mockLogError).not.toHaveBeenCalledWith(
      'Failed to analyze spend privacy',
      expect.any(Object)
    );
  });

  it('covers disabled/unknown/manual strategy exits and non-Error selection failure fallback', async () => {
    const onStrategyChange = vi.fn();
    const onSetSelectedUtxos = vi.fn();
    const { rerender } = render(
      <CoinControlPanel
        {...makeProps({
          disabled: false,
          onStrategyChange,
          onSetSelectedUtxos,
        })}
      />
    );
    fireEvent.click(screen.getByText(/Coin Control/));

    rerender(
      <CoinControlPanel
        {...makeProps({
          disabled: true,
          onStrategyChange,
          onSetSelectedUtxos,
        })}
      />
    );
    fireEvent.click(screen.getByText('mock-strategy-privacy'));
    expect(onStrategyChange).not.toHaveBeenCalled();
    expect(mockSelectUtxos).not.toHaveBeenCalled();

    rerender(
      <CoinControlPanel
        {...makeProps({
          disabled: false,
          onStrategyChange,
          onSetSelectedUtxos,
        })}
      />
    );

    fireEvent.click(screen.getByText('mock-strategy-unknown'));
    expect(onStrategyChange).toHaveBeenCalledWith('unknown');
    expect(mockSelectUtxos).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('mock-strategy-manual'));
    expect(mockSelectUtxos).not.toHaveBeenCalled();

    mockSelectUtxos.mockRejectedValueOnce('string-failure');
    fireEvent.click(screen.getByText('mock-strategy-privacy'));
    await waitFor(() => {
      expect(screen.getByText('Selection failed')).toBeInTheDocument();
    });
  });
});
