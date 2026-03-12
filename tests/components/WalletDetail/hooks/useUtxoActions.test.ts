import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useUtxoActions } from '../../../../components/WalletDetail/hooks/useUtxoActions';
import * as transactionsApi from '../../../../src/api/transactions';
import { logError } from '../../../../utils/errorHandler';

const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

vi.mock('../../../../src/api/transactions', () => ({
  freezeUTXO: vi.fn(),
}));

vi.mock('../../../../utils/errorHandler', () => ({
  logError: vi.fn(),
}));

describe('useUtxoActions', () => {
  const setUTXOs = vi.fn();
  const setUtxoStats = vi.fn();
  const handleError = vi.fn();
  const navigate = vi.fn();

  const baseUtxos = [
    {
      id: 'utxo-1',
      txid: 'tx-1',
      vout: 0,
      frozen: false,
      amount: 1000,
    },
    {
      id: 'utxo-2',
      txid: 'tx-2',
      vout: 1,
      frozen: true,
      amount: 2000,
    },
  ] as any;

  const renderUtxoActions = (overrides: Partial<Parameters<typeof useUtxoActions>[0]> = {}) =>
    renderHook(() =>
      useUtxoActions({
        walletId: 'wallet-1',
        utxos: baseUtxos,
        setUTXOs,
        setUtxoStats,
        handleError,
        navigate,
        ...overrides,
      })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transactionsApi.freezeUTXO).mockResolvedValue(undefined as never);
  });

  it('optimistically toggles freeze state and persists on success', async () => {
    const { result } = renderUtxoActions();

    await act(async () => {
      await result.current.handleToggleFreeze('tx-1', 0);
    });

    expect(transactionsApi.freezeUTXO).toHaveBeenCalledWith('utxo-1', true);
    expect(setUTXOs).toHaveBeenCalledTimes(1);
    expect(setUtxoStats).toHaveBeenCalledTimes(1);

    const setUtxosUpdater = setUTXOs.mock.calls[0][0];
    const setStatsUpdater = setUtxoStats.mock.calls[0][0];

    const updatedUtxos = setUtxosUpdater(baseUtxos);
    const updatedStats = setStatsUpdater(baseUtxos);

    expect(updatedUtxos[0].frozen).toBe(true);
    expect(updatedStats[0].frozen).toBe(true);
  });

  it('reverts optimistic updates and reports errors when freeze call fails', async () => {
    vi.mocked(transactionsApi.freezeUTXO).mockRejectedValueOnce(new Error('freeze failed'));
    const { result } = renderUtxoActions();

    await act(async () => {
      await result.current.handleToggleFreeze('tx-1', 0);
    });

    expect(setUTXOs).toHaveBeenCalledTimes(2);
    expect(setUtxoStats).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(loggerSpies, expect.any(Error), 'Failed to freeze UTXO');
    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Freeze UTXO');

    const optimistic = setUTXOs.mock.calls[0][0];
    const rollback = setUTXOs.mock.calls[1][0];
    const statsOptimistic = setUtxoStats.mock.calls[0][0];
    const statsRollback = setUtxoStats.mock.calls[1][0];

    const afterOptimistic = optimistic(baseUtxos);
    const afterRollback = rollback(afterOptimistic);
    const statsAfterOptimistic = statsOptimistic(baseUtxos);
    const statsAfterRollback = statsRollback(statsAfterOptimistic);
    expect(afterRollback[0].frozen).toBe(false);
    expect(statsAfterRollback[0].frozen).toBe(false);
  });

  it('guards when utxo is missing or missing id', async () => {
    const { result: missingResult } = renderUtxoActions({
      utxos: [],
    });

    await act(async () => {
      await missingResult.current.handleToggleFreeze('tx-1', 0);
    });

    expect(loggerSpies.error).toHaveBeenCalledWith('UTXO not found or missing ID');
    expect(transactionsApi.freezeUTXO).not.toHaveBeenCalled();
    expect(setUTXOs).not.toHaveBeenCalled();
    expect(setUtxoStats).not.toHaveBeenCalled();

    const { result: noIdResult } = renderUtxoActions({
      utxos: [{ txid: 'tx-1', vout: 0, amount: 1000, address: 'bc1qtest', confirmations: 1, frozen: false }],
    });

    await act(async () => {
      await noIdResult.current.handleToggleFreeze('tx-1', 0);
    });

    expect(loggerSpies.error).toHaveBeenCalledWith('UTXO not found or missing ID');
    expect(transactionsApi.freezeUTXO).not.toHaveBeenCalled();
  });

  it('toggles selected ids, resets selection on wallet change, and navigates with selected set', async () => {
    const { result, rerender } = renderUtxoActions({ walletId: 'wallet-1' });

    act(() => {
      result.current.handleToggleSelect('tx-1:0');
      result.current.handleToggleSelect('tx-2:1');
    });
    expect(Array.from(result.current.selectedUtxos)).toEqual(['tx-1:0', 'tx-2:1']);

    act(() => {
      result.current.handleToggleSelect('tx-1:0');
    });
    expect(Array.from(result.current.selectedUtxos)).toEqual(['tx-2:1']);

    act(() => {
      result.current.handleSendSelected();
    });
    expect(navigate).toHaveBeenCalledWith('/wallets/wallet-1/send', {
      state: { preSelected: ['tx-2:1'] },
    });

    rerender();
    expect(Array.from(result.current.selectedUtxos)).toEqual(['tx-2:1']);

    const { result: changedWalletResult, rerender: rerenderChanged } = renderUtxoActions({ walletId: 'wallet-9' });
    act(() => {
      changedWalletResult.current.handleToggleSelect('tx-1:0');
    });
    expect(Array.from(changedWalletResult.current.selectedUtxos)).toEqual(['tx-1:0']);

    rerenderChanged();
    expect(Array.from(changedWalletResult.current.selectedUtxos)).toEqual(['tx-1:0']);
  });

  it('clears selected utxos when walletId actually changes', () => {
    const { result, rerender } = renderHook(
      ({ walletId }) =>
        useUtxoActions({
          walletId,
          utxos: baseUtxos,
          setUTXOs,
          setUtxoStats,
          handleError,
          navigate,
        }),
      {
        initialProps: { walletId: 'wallet-1' as string | undefined },
      }
    );

    act(() => {
      result.current.handleToggleSelect('tx-1:0');
    });
    expect(Array.from(result.current.selectedUtxos)).toEqual(['tx-1:0']);

    rerender({ walletId: 'wallet-2' });
    expect(Array.from(result.current.selectedUtxos)).toEqual([]);
  });
});
