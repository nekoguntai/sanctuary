/**
 * useSendTransactionActions Hook (Orchestrator)
 *
 * Composes the sub-hooks (USB signing, QR signing, draft management,
 * payjoin, and broadcast) into a single unified API surface.
 *
 * Handles transaction creation, signing, and broadcasting logic.
 * Extracted from SendTransaction.tsx for use with the wizard-based flow.
 */

import { useState, useCallback } from 'react';
import * as transactionsApi from '../../src/api/transactions';
import * as payjoinApi from '../../src/api/payjoin';
import { ApiError } from '../../src/api/client';
import { createLogger } from '../../utils/logger';
import { useUsbSigning } from './useUsbSigning';
import { useQrSigning } from './useQrSigning';
import { useDraftManagement } from './useDraftManagement';
import { usePayjoin } from './usePayjoin';
import { useBroadcast } from './useBroadcast';
import type { TransactionData, UseSendTransactionActionsProps, UseSendTransactionActionsResult } from './types';

export type { TransactionData, UseSendTransactionActionsProps, UseSendTransactionActionsResult };

const log = createLogger('SendTxActions');

export function useSendTransactionActions({
  walletId,
  wallet,
  state,
  initialPsbt,
  initialTxData,
}: UseSendTransactionActionsProps): UseSendTransactionActionsResult {
  // Core state
  const [isCreating, setIsCreating] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txData, setTxData] = useState<TransactionData | null>(initialTxData || null);
  const [unsignedPsbt, setUnsignedPsbt] = useState<string | null>(initialPsbt || null);
  const [signedRawTx, setSignedRawTx] = useState<string | null>(null);
  // Initialize signedDevices from state for draft resume (state.signedDevices is loaded from draft)
  const [signedDevices, setSignedDevices] = useState<Set<string>>(() => new Set(state.signedDevices));

  // Payjoin state
  const { payjoinStatus, payjoinAttempted, setPayjoinStatus, resetPayjoin } = usePayjoin();

  // Create transaction PSBT
  const createTransaction = useCallback(async (): Promise<TransactionData | null> => {
    setIsCreating(true);
    setError(null);

    try {
      // Validate outputs
      for (let i = 0; i < state.outputs.length; i++) {
        const output = state.outputs[i];
        if (!output.address) {
          setError(`Output ${i + 1}: Please enter a recipient address`);
          return null;
        }
        if (!output.sendMax && (!output.amount || parseInt(output.amount, 10) <= 0)) {
          setError(`Output ${i + 1}: Please enter a valid amount`);
          return null;
        }
      }

      // Prepare outputs for API
      const apiOutputs = state.outputs.map(o => ({
        address: o.address,
        amount: o.sendMax ? 0 : parseInt(o.amount, 10),
        sendMax: o.sendMax,
      }));

      let result: TransactionData;

      if (state.outputs.length > 1 || state.outputs.some(o => o.sendMax)) {
        // Use batch API for multiple outputs or sendMax
        result = await transactionsApi.createBatchTransaction(walletId, {
          outputs: apiOutputs,
          feeRate: state.feeRate,
          selectedUtxoIds: state.selectedUTXOs.size > 0 ? Array.from(state.selectedUTXOs) : undefined,
          enableRBF: state.rbfEnabled,
        });
      } else {
        // Single output
        const singleResult = await transactionsApi.createTransaction(walletId, {
          recipient: state.outputs[0].address,
          amount: parseInt(state.outputs[0].amount, 10),
          feeRate: state.feeRate,
          selectedUtxoIds: state.selectedUTXOs.size > 0 ? Array.from(state.selectedUTXOs) : undefined,
          enableRBF: state.rbfEnabled,
          sendMax: false,
          subtractFees: state.subtractFees,
          decoyOutputs: state.useDecoys ? { enabled: true, count: state.decoyCount } : undefined,
        });

        // Create outputs array with just the main recipient (decoys are change, handled separately)
        const mainOutput = {
          address: state.outputs[0].address,
          amount: singleResult.effectiveAmount || parseInt(state.outputs[0].amount, 10),
        };

        result = {
          ...singleResult,
          outputs: [mainOutput],
        };
      }

      // Attempt Payjoin if URL is present
      if (state.payjoinUrl && state.outputs.length === 1 && !payjoinAttempted.current) {
        setPayjoinStatus('attempting');
        payjoinAttempted.current = true;
        log.info('Attempting Payjoin', { payjoinUrl: state.payjoinUrl, network: wallet.network });

        try {
          // Use wallet's network for payjoin
          const network = (wallet.network || 'mainnet') as 'mainnet' | 'testnet' | 'regtest';
          const payjoinResult = await payjoinApi.attemptPayjoin(result.psbtBase64, state.payjoinUrl, network);

          if (payjoinResult.success && payjoinResult.proposalPsbt) {
            result.psbtBase64 = payjoinResult.proposalPsbt;
            setPayjoinStatus('success');
            log.info('Payjoin successful');
          } else {
            setPayjoinStatus('failed');
            log.warn('Payjoin failed, using regular transaction', { error: payjoinResult.error });
          }
        } catch (pjError) {
          setPayjoinStatus('failed');
          log.warn('Payjoin error', { error: pjError });
        }
      }

      setTxData(result);
      setUnsignedPsbt(result.psbtBase64);
      return result;
    } catch (err) {
      log.error('Failed to create transaction', { error: err });
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to create transaction');
      }
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [walletId, state, wallet.network, payjoinAttempted, setPayjoinStatus]);

  // USB signing (signWithHardwareWallet, signWithDevice)
  const { signWithHardwareWallet, signWithDevice } = useUsbSigning({
    walletId,
    wallet,
    draftId: state.draftId,
    txData,
    unsignedPsbt,
    setIsSigning,
    setError,
    setUnsignedPsbt,
    setSignedRawTx,
    setSignedDevices,
  });

  // QR/airgap signing (downloadPsbt, uploadSignedPsbt, processQrSignedPsbt)
  const { downloadPsbt, uploadSignedPsbt, processQrSignedPsbt } = useQrSigning({
    walletId,
    wallet,
    draftId: state.draftId,
    txData,
    unsignedPsbt,
    setError,
    setUnsignedPsbt,
    setSignedDevices,
  });

  // Draft management (saveDraft)
  const { saveDraft } = useDraftManagement({
    walletId,
    state,
    txData,
    unsignedPsbt,
    signedDevices,
    createTransaction,
    setIsSavingDraft,
    setError,
  });

  // Broadcasting (broadcastTransaction)
  const { broadcastTransaction } = useBroadcast({
    walletId,
    wallet,
    state,
    txData,
    unsignedPsbt,
    signedRawTx,
    setIsBroadcasting,
    setError,
  });

  // Mark device as signed
  const markDeviceSigned = useCallback((deviceId: string) => {
    setSignedDevices(prev => new Set([...prev, deviceId]));
  }, []);

  // Clear error
  const clearError = useCallback(() => setError(null), []);

  // Reset state
  const reset = useCallback(() => {
    setIsCreating(false);
    setIsSigning(false);
    setIsBroadcasting(false);
    setIsSavingDraft(false);
    setError(null);
    setTxData(null);
    setUnsignedPsbt(null);
    setSignedRawTx(null);
    setSignedDevices(new Set());
    resetPayjoin();
  }, [resetPayjoin]);

  return {
    isCreating,
    isSigning,
    isBroadcasting,
    isSavingDraft,
    error,
    txData,
    unsignedPsbt,
    signedRawTx,
    signedDevices,
    payjoinStatus,
    createTransaction,
    signWithHardwareWallet,
    signWithDevice,
    broadcastTransaction,
    saveDraft,
    downloadPsbt,
    uploadSignedPsbt,
    processQrSignedPsbt,
    markDeviceSigned,
    clearError,
    reset,
  };
}
