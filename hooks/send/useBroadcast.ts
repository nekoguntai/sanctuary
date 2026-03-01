/**
 * useBroadcast Hook
 *
 * Handles transaction broadcasting, including post-broadcast cleanup
 * (query cache refresh, draft deletion, navigation).
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as bitcoin from 'bitcoinjs-lib';
import * as transactionsApi from '../../src/api/transactions';
import * as draftsApi from '../../src/api/drafts';
import { useErrorHandler } from '../useErrorHandler';
import { useNotificationSound } from '../useNotificationSound';
import { useCurrency } from '../../contexts/CurrencyContext';
import { queryClient } from '../../providers/QueryProvider';
import { isMultisigType } from '../../types';
import { createLogger } from '../../utils/logger';
import type { Wallet } from '../../types';
import type { TransactionState } from '../../contexts/send/types';
import type { TransactionData } from './types';

const log = createLogger('Broadcast');

export interface UseBroadcastDeps {
  walletId: string;
  wallet: Wallet;
  state: TransactionState;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  signedRawTx: string | null;
  setIsBroadcasting: (v: boolean) => void;
  setError: (v: string | null) => void;
}

export interface UseBroadcastResult {
  broadcastTransaction: (signedPsbt?: string, rawTxHex?: string) => Promise<boolean>;
}

export function useBroadcast({
  walletId,
  wallet,
  state,
  txData,
  unsignedPsbt,
  signedRawTx,
  setIsBroadcasting,
  setError,
}: UseBroadcastDeps): UseBroadcastResult {
  const navigate = useNavigate();
  const { format } = useCurrency();
  const { showSuccess } = useErrorHandler();
  const { playEventSound } = useNotificationSound();

  // Broadcast signed transaction
  const broadcastTransaction = useCallback(async (
    signedPsbt?: string,
    rawTxHex?: string
  ): Promise<boolean> => {
    if (!txData) {
      setError('No transaction to broadcast');
      return false;
    }

    const psbtToUse = signedPsbt || unsignedPsbt;
    // Use passed rawTxHex, or fall back to stored signedRawTx from Trezor signing
    // IMPORTANT: For multisig, do NOT use rawTxHex - it only contains one device's signature
    // The PSBT path handles combining signatures from multiple devices
    const isMultisig = isMultisigType(wallet.type);
    const rawTxToUse = isMultisig ? undefined : (rawTxHex || signedRawTx);

    if (!psbtToUse && !rawTxToUse) {
      setError('No signed transaction available');
      return false;
    }

    log.info('Broadcasting transaction', {
      hasPsbt: !!psbtToUse,
      hasRawTx: !!rawTxToUse,
      isMultisig,
      rawTxSkipped: isMultisig && !!(rawTxHex || signedRawTx),
    });

    // Log PSBT signature details for debugging
    if (psbtToUse && isMultisig) {
      try {
        const debugPsbt = bitcoin.Psbt.fromBase64(psbtToUse);
        for (let i = 0; i < debugPsbt.data.inputs.length; i++) {
          const input = debugPsbt.data.inputs[i];
          if (input.partialSig) {
            log.info('BROADCAST PSBT SIGNATURES', {
              inputIndex: i,
              signatureCount: input.partialSig.length,
              signatures: input.partialSig.map(ps => ({
                pubkeyPrefix: ps.pubkey.slice(0, 8).toString('hex'),
                sigLength: ps.signature.length,
                sigHexStart: ps.signature.slice(0, 10).toString('hex'),
                sigHexEnd: ps.signature.slice(-5).toString('hex'),
              })),
            });
          }
        }
      } catch (parseError) {
        log.warn('Failed to parse PSBT for debug', { error: parseError });
      }
    }

    setIsBroadcasting(true);
    setError(null);

    try {
      const effectiveAmount = txData.effectiveAmount ||
        (txData.outputs?.reduce((sum, o) => sum + o.amount, 0) || 0);

      const broadcastResult = await transactionsApi.broadcastTransaction(walletId, {
        signedPsbtBase64: psbtToUse ?? undefined,
        rawTxHex: rawTxToUse ?? undefined,
        recipient: state.outputs[0].address,
        amount: effectiveAmount,
        fee: txData.fee,
        utxos: txData.utxos,
      });

      const outputsMsg = state.outputs.length > 1
        ? `${state.outputs.length} outputs`
        : format(effectiveAmount);

      showSuccess(
        `Transaction broadcast successfully! TXID: ${broadcastResult.txid.substring(0, 16)}... Amount: ${outputsMsg}, Fee: ${format(txData.fee)}`,
        'Transaction Broadcast'
      );

      playEventSound('send');

      // Refetch React Query caches so Dashboard updates immediately
      // IMPORTANT: Use refetchQueries (not invalidateQueries) to ensure data is fetched BEFORE navigation.
      // invalidateQueries only marks as stale and triggers background refetch, which races with navigate().
      // Using refetchQueries with await ensures the pending transaction appears in the UI right away.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['pendingTransactions'] }),
        queryClient.refetchQueries({ queryKey: ['wallets'] }),
        queryClient.refetchQueries({ queryKey: ['wallet', walletId] }),
      ]);
      // These can be invalidated (background refresh is fine)
      queryClient.invalidateQueries({ queryKey: ['recentTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['transactions', walletId] });

      // Delete draft if exists
      if (state.draftId) {
        try {
          await draftsApi.deleteDraft(walletId, state.draftId);
        } catch (e) {
          log.error('Failed to delete draft after broadcast', { error: e });
        }
      }

      // Navigate back to wallet
      navigate(`/wallets/${walletId}`);
      return true;
    } catch (err) {
      log.error('Transaction broadcast failed', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to broadcast transaction');
      return false;
    } finally {
      setIsBroadcasting(false);
    }
  }, [walletId, txData, unsignedPsbt, signedRawTx, state, format, showSuccess, playEventSound, navigate, wallet.type, setIsBroadcasting, setError]);

  return { broadcastTransaction };
}
