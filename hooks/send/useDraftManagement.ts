/**
 * useDraftManagement Hook
 *
 * Handles saving and updating transaction drafts.
 * Supports both creating new drafts and updating existing ones,
 * including persisting signature state for multisig flows.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as draftsApi from '../../src/api/drafts';
import { ApiError } from '../../src/api/client';
import { useErrorHandler } from '../useErrorHandler';
import { createLogger } from '../../utils/logger';
import type { TransactionState } from '../../contexts/send/types';
import type { CreateDraftRequest } from '../../src/api/drafts';
import type { TransactionData } from './types';

const log = createLogger('DraftMgmt');

export interface UseDraftManagementDeps {
  walletId: string;
  state: TransactionState;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  signedDevices: Set<string>;
  createTransaction: () => Promise<TransactionData | null>;
  setIsSavingDraft: (v: boolean) => void;
  setError: (v: string | null) => void;
}

export interface UseDraftManagementResult {
  saveDraft: (label?: string) => Promise<string | null>;
}

export function useDraftManagement({
  walletId,
  state,
  txData,
  unsignedPsbt,
  signedDevices,
  createTransaction,
  setIsSavingDraft,
  setError,
}: UseDraftManagementDeps): UseDraftManagementResult {
  const navigate = useNavigate();
  const { showSuccess } = useErrorHandler();

  // Save as draft
  const saveDraft = useCallback(async (label?: string): Promise<string | null> => {
    let currentTxData = txData;
    if (!currentTxData) {
      // Create transaction first
      currentTxData = await createTransaction();
      if (!currentTxData) return null;
    }
    setIsSavingDraft(true);
    setError(null);

    try {
      const apiOutputs = state.outputs.map(o => ({
        address: o.address,
        amount: o.sendMax ? 0 : parseInt(o.amount, 10),
        sendMax: o.sendMax,
      }));

      const effectiveAmount = currentTxData.effectiveAmount ||
        (currentTxData.outputs?.reduce((sum, o) => sum + o.amount, 0) ||
         parseInt(state.outputs[0].amount, 10));

      const usedUtxoIds = currentTxData.utxos?.map(u => `${u.txid}:${u.vout}`) || [];

      // Build inputs array for flow visualization
      // Note: The API only returns txid/vout for UTXOs, address/amount come from extended response
      const inputsToSave = currentTxData.utxos?.map(u => ({
        txid: u.txid,
        vout: u.vout,
        address: u.address || '',
        amount: u.amount || 0,
      })) || [];

      const outputsToSave = currentTxData.outputs
        ? currentTxData.outputs.map((txOutput, idx) => ({
            address: txOutput.address,
            amount: txOutput.amount,
            sendMax: apiOutputs[idx]?.sendMax || false,
          }))
        : apiOutputs;

      const draftRequest: CreateDraftRequest = {
        recipient: state.outputs[0].address,
        amount: effectiveAmount,
        feeRate: state.feeRate,
        selectedUtxoIds: usedUtxoIds.length > 0 ? usedUtxoIds : undefined,
        enableRBF: state.rbfEnabled,
        subtractFees: state.subtractFees,
        sendMax: state.outputs.some(o => o.sendMax),
        outputs: outputsToSave,
        inputs: inputsToSave.length > 0 ? inputsToSave : undefined,
        decoyOutputs: currentTxData.decoyOutputs,
        payjoinUrl: state.payjoinUrl || undefined,
        psbtBase64: currentTxData.psbtBase64,
        fee: currentTxData.fee,
        totalInput: currentTxData.totalInput,
        totalOutput: currentTxData.totalOutput,
        changeAmount: currentTxData.changeAmount || 0,
        changeAddress: currentTxData.changeAddress,
        effectiveAmount: currentTxData.effectiveAmount,
        inputPaths: currentTxData.inputPaths || [],
        label,
      };

      let draftId: string;

      if (state.draftId) {
        // Update existing draft
        // Note: For Trezor, the PSBT may not change (raw tx is returned instead),
        // so we check signedDevices to detect if signing happened
        const hasSignatures = signedDevices.size > 0 || unsignedPsbt !== currentTxData.psbtBase64;
        await draftsApi.updateDraft(walletId, state.draftId, {
          // Only include signature data if signing has occurred
          signedPsbtBase64: hasSignatures && unsignedPsbt ? unsignedPsbt : undefined,
          signedDeviceId: signedDevices.size > 0 ? Array.from(signedDevices)[0] : undefined,
        });
        draftId = state.draftId;
        showSuccess('Draft updated successfully', 'Draft Saved');
      } else {
        // Create new draft
        const result = await draftsApi.createDraft(walletId, draftRequest);
        draftId = result.id;

        // If signing has occurred, save the signed state immediately
        // This handles the case where user signs first, then clicks "save draft"
        // Note: For Trezor, PSBT may be unchanged but signedDevices will be populated
        const hasSignatures = signedDevices.size > 0 || (unsignedPsbt && unsignedPsbt !== currentTxData.psbtBase64);
        if (hasSignatures && unsignedPsbt) {
          log.info('Saving signed PSBT to newly created draft', {
            draftId,
            signedDevices: Array.from(signedDevices),
            psbtChanged: unsignedPsbt !== currentTxData.psbtBase64,
          });
          await draftsApi.updateDraft(walletId, draftId, {
            signedPsbtBase64: unsignedPsbt,
            signedDeviceId: signedDevices.size > 0 ? Array.from(signedDevices)[0] : undefined,
          });
        }

        showSuccess('Transaction saved as draft', 'Draft Saved');
      }

      navigate(`/wallets/${walletId}`);
      return draftId;
    } catch (err) {
      log.error('Failed to save draft', { error: err });
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to save draft');
      }
      return null;
    } finally {
      setIsSavingDraft(false);
    }
  }, [walletId, txData, unsignedPsbt, signedDevices, state, createTransaction, showSuccess, navigate, setIsSavingDraft, setError]);

  return { saveDraft };
}
