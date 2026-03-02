import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Label, Transaction } from '../../../types';
import type { TransactionStats } from '../../../src/api/transactions';
import { useTransactionList } from '../../../components/TransactionList/hooks/useTransactionList';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as labelsApi from '../../../src/api/labels';
import * as transactionsApi from '../../../src/api/transactions';

vi.mock('../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../../src/api/labels', () => ({
  getLabels: vi.fn(),
  setTransactionLabels: vi.fn(),
  createLabel: vi.fn(),
}));

vi.mock('../../../src/api/transactions', () => ({
  getTransaction: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  txid: 'txid-1',
  walletId: 'wallet-1',
  amount: 1000,
  confirmations: 1,
  labels: [],
  ...overrides,
});

describe('useTransactionList branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      explorerUrl: 'https://mempool.space',
    } as Awaited<ReturnType<typeof bitcoinApi.getStatus>>);
    vi.mocked(labelsApi.getLabels).mockResolvedValue([]);
    vi.mocked(labelsApi.setTransactionLabels).mockResolvedValue({});
    vi.mocked(labelsApi.createLabel).mockResolvedValue({
      id: 'lbl-new',
      walletId: 'wallet-1',
      userId: 'user-1',
      name: 'New Label',
      color: '#6366f1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(transactionsApi.getTransaction).mockResolvedValue(makeTx());
  });

  it('keeps default explorer URL when API response omits explorerUrl', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValueOnce({} as Awaited<ReturnType<typeof bitcoinApi.getStatus>>);

    const { result } = renderHook(() => useTransactionList({ transactions: [] }));

    await waitFor(() => expect(bitcoinApi.getStatus).toHaveBeenCalled());
    expect(result.current.explorerUrl).toBe('https://mempool.space');
  });

  it('handles highlighted scroll branch for missing and found transaction indexes', () => {
    vi.useFakeTimers();
    const scrollToIndex = vi.fn();
    const tx1 = makeTx({ id: 'tx-1', txid: 'txid-1' });
    const tx2 = makeTx({ id: 'tx-2', txid: 'txid-2' });

    const { result, rerender } = renderHook(
      ({ highlightedTxId }) => useTransactionList({ transactions: [tx1, tx2], highlightedTxId }),
      { initialProps: { highlightedTxId: undefined as string | undefined } }
    );

    act(() => {
      result.current.virtuosoRef.current = { scrollToIndex };
    });

    rerender({ highlightedTxId: 'missing-id' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(scrollToIndex).not.toHaveBeenCalled();

    rerender({ highlightedTxId: 'tx-2' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(scrollToIndex).toHaveBeenCalledWith({
      index: 1,
      align: 'center',
      behavior: 'smooth',
    });
  });

  it('no-ops save labels and AI suggestion when no transaction is selected', async () => {
    const { result } = renderHook(() => useTransactionList({ transactions: [makeTx()] }));

    await act(async () => {
      await result.current.handleSaveLabels();
      await result.current.handleAISuggestion('Coffee');
    });

    expect(labelsApi.setTransactionLabels).not.toHaveBeenCalled();
    expect(labelsApi.createLabel).not.toHaveBeenCalled();
  });

  it('edits labels, toggles add/remove branches, and saves selected labels', async () => {
    const tx = makeTx({ id: 'tx-edit', txid: 'txid-edit', labels: undefined });
    const onLabelsChange = vi.fn();
    const labelA: Label = {
      id: 'lbl-a',
      walletId: 'wallet-1',
      userId: 'user-1',
      name: 'A',
      color: '#111111',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const labelB: Label = {
      id: 'lbl-b',
      walletId: 'wallet-1',
      userId: 'user-1',
      name: 'B',
      color: '#222222',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(labelsApi.getLabels).mockResolvedValueOnce([labelA, labelB]);

    const { result } = renderHook(() =>
      useTransactionList({
        transactions: [tx],
        onLabelsChange,
      })
    );

    act(() => {
      result.current.handleTxClick(tx);
    });
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('txid-edit'));

    await act(async () => {
      await result.current.handleEditLabels(tx);
    });
    expect(result.current.selectedLabelIds).toEqual([]);

    act(() => {
      result.current.handleToggleLabel('lbl-a');
    });
    expect(result.current.selectedLabelIds).toEqual(['lbl-a']);

    act(() => {
      result.current.handleToggleLabel('lbl-a');
    });
    expect(result.current.selectedLabelIds).toEqual([]);

    act(() => {
      result.current.handleToggleLabel('lbl-b');
    });
    expect(result.current.selectedLabelIds).toEqual(['lbl-b']);

    await act(async () => {
      await result.current.handleSaveLabels();
    });

    expect(labelsApi.setTransactionLabels).toHaveBeenCalledWith('tx-edit', ['lbl-b']);
    expect(result.current.selectedTx?.labels?.map(l => l.id)).toEqual(['lbl-b']);
    expect(onLabelsChange).toHaveBeenCalledTimes(1);
  });

  it('applies AI suggestions for existing labels, avoids duplicate selection, and creates missing labels', async () => {
    const tx = makeTx({ id: 'tx-ai', txid: 'txid-ai', walletId: 'wallet-ai', labels: [] });
    const existing: Label = {
      id: 'lbl-existing',
      walletId: 'wallet-ai',
      userId: 'user-1',
      name: 'Groceries',
      color: '#00aa00',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const created: Label = {
      id: 'lbl-created',
      walletId: 'wallet-ai',
      userId: 'user-1',
      name: 'Coffee',
      color: '#6366f1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(labelsApi.getLabels).mockResolvedValueOnce([existing]);
    vi.mocked(labelsApi.createLabel).mockResolvedValueOnce(created);
    vi.mocked(labelsApi.getLabels).mockResolvedValueOnce([existing, created]);

    const { result } = renderHook(() =>
      useTransactionList({
        transactions: [tx],
      })
    );

    act(() => {
      result.current.handleTxClick(tx);
    });
    await waitFor(() => expect(transactionsApi.getTransaction).toHaveBeenCalledWith('txid-ai'));

    await act(async () => {
      await result.current.handleEditLabels(tx);
    });

    await act(async () => {
      await result.current.handleAISuggestion('groceries');
    });
    expect(labelsApi.createLabel).not.toHaveBeenCalled();
    expect(result.current.selectedLabelIds).toEqual(['lbl-existing']);

    await act(async () => {
      await result.current.handleAISuggestion('groceries');
    });
    expect(result.current.selectedLabelIds).toEqual(['lbl-existing']);

    await act(async () => {
      await result.current.handleAISuggestion('Coffee');
    });

    expect(labelsApi.createLabel).toHaveBeenCalledWith('wallet-ai', {
      name: 'Coffee',
      color: '#6366f1',
    });
    expect(result.current.selectedLabelIds).toEqual(expect.arrayContaining(['lbl-existing', 'lbl-created']));
  });

  it('covers consolidation classification and txStats fee branches', () => {
    const txConsolidationType = makeTx({
      id: 'c-type',
      txid: 'txid-c-type',
      type: 'consolidation',
      amount: -1000,
      fee: 0,
    });
    const txConsolidationSendToSelf = makeTx({
      id: 'c-self-send',
      txid: 'txid-c-self-send',
      amount: -2000,
      counterpartyAddress: 'bc1self',
      fee: 200,
    });
    const txConsolidationReceiveFromSelf = makeTx({
      id: 'c-self-recv',
      txid: 'txid-c-self-recv',
      amount: 3000,
      counterpartyAddress: 'bc1self',
      fee: 300,
    });
    const txReceive = makeTx({
      id: 'recv',
      txid: 'txid-recv',
      amount: 4000,
      type: 'received',
      fee: 100,
    });
    const txSentWithFee = makeTx({
      id: 'sent-fee',
      txid: 'txid-sent-fee',
      amount: -5000,
      counterpartyAddress: 'bc1external',
      fee: 500,
    });
    const txSentWithoutFee = makeTx({
      id: 'sent-no-fee',
      txid: 'txid-sent-no-fee',
      amount: -6000,
      counterpartyAddress: 'bc1external-2',
      fee: undefined,
    });
    const txReplaced = makeTx({
      id: 'replaced',
      txid: 'txid-replaced',
      amount: 7000,
      rbfStatus: 'replaced',
    });

    const { result } = renderHook(() =>
      useTransactionList({
        transactions: [
          txConsolidationType,
          txConsolidationSendToSelf,
          txConsolidationReceiveFromSelf,
          txReceive,
          txSentWithFee,
          txSentWithoutFee,
          txReplaced,
        ],
        walletAddresses: ['bc1self'],
      })
    );

    expect(result.current.filteredTransactions).toHaveLength(6);

    expect(result.current.getTxTypeInfo(txConsolidationSendToSelf)).toEqual({
      isReceive: false,
      isConsolidation: true,
    });
    expect(result.current.getTxTypeInfo(txConsolidationReceiveFromSelf)).toEqual({
      isReceive: true,
      isConsolidation: true,
    });
    expect(result.current.getTxTypeInfo(txReceive)).toEqual({
      isReceive: true,
      isConsolidation: false,
    });

    expect(result.current.txStats).toEqual({
      total: 6,
      received: 1,
      sent: 2,
      consolidations: 3,
      totalReceived: 4000,
      totalSent: 11000,
      totalFees: 1000,
    });
  });

  it('uses provided transactionStats when available', () => {
    const transactionStats: TransactionStats = {
      totalCount: 9,
      receivedCount: 4,
      sentCount: 3,
      consolidationCount: 2,
      totalReceived: 120000,
      totalSent: 90000,
      totalFees: 1400,
      walletBalance: 500000,
    };

    const { result } = renderHook(() =>
      useTransactionList({
        transactions: [makeTx()],
        transactionStats,
      })
    );

    expect(result.current.txStats).toEqual({
      total: 9,
      received: 4,
      sent: 3,
      consolidations: 2,
      totalReceived: 120000,
      totalSent: 90000,
      totalFees: 1400,
    });
  });
});
