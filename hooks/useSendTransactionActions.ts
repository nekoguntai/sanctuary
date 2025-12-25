/**
 * useSendTransactionActions Hook
 *
 * Handles transaction creation, signing, and broadcasting logic.
 * Extracted from SendTransaction.tsx for use with the wizard-based flow.
 */

import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as transactionsApi from '../src/api/transactions';
import * as draftsApi from '../src/api/drafts';
import * as payjoinApi from '../src/api/payjoin';
import { ApiError } from '../src/api/client';
import { useErrorHandler } from './useErrorHandler';
import { useNotificationSound } from './useNotificationSound';
import { useHardwareWallet } from './useHardwareWallet';
import { useCurrency } from '../contexts/CurrencyContext';
import { createLogger } from '../utils/logger';
import type { Wallet, UTXO, Device } from '../types';
import type { TransactionState } from '../contexts/send/types';
import type { CreateDraftRequest } from '../src/api/drafts';
import type { DeviceType } from '../services/hardwareWallet';

const log = createLogger('SendTxActions');

/**
 * Map device type string to hardware wallet DeviceType
 * E.g., "trezor-safe-7" -> "trezor", "ledger-nano-x" -> "ledger"
 */
function getHardwareWalletType(deviceType: string): DeviceType | null {
  const normalizedType = deviceType.toLowerCase();
  if (normalizedType.includes('trezor')) return 'trezor';
  if (normalizedType.includes('ledger')) return 'ledger';
  if (normalizedType.includes('coldcard')) return 'coldcard';
  if (normalizedType.includes('bitbox')) return 'bitbox';
  if (normalizedType.includes('passport') || normalizedType.includes('foundation')) return 'passport';
  if (normalizedType.includes('jade') || normalizedType.includes('blockstream')) return 'jade';
  return null;
}

export interface TransactionData {
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  effectiveAmount?: number;
  utxos: Array<{
    txid: string;
    vout: number;
    address?: string;
    amount?: number;
  }>;
  outputs?: Array<{ address: string; amount: number }>;
  inputPaths?: string[];
  decoyOutputs?: Array<{ address: string; amount: number }>;
}

export interface UseSendTransactionActionsProps {
  walletId: string;
  wallet: Wallet;
  state: TransactionState;
  // Initial values for draft mode
  initialPsbt?: string | null;
  initialTxData?: TransactionData | null;
}

export interface UseSendTransactionActionsResult {
  // State
  isCreating: boolean;
  isSigning: boolean;
  isBroadcasting: boolean;
  isSavingDraft: boolean;
  error: string | null;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  signedRawTx: string | null;  // Raw tx hex from Trezor signing
  signedDevices: Set<string>;
  payjoinStatus: 'idle' | 'attempting' | 'success' | 'failed';

  // Actions
  createTransaction: () => Promise<TransactionData | null>;
  signWithHardwareWallet: () => Promise<string | null>;
  signWithDevice: (device: Device) => Promise<boolean>;
  broadcastTransaction: (signedPsbt?: string, rawTxHex?: string) => Promise<boolean>;
  saveDraft: (label?: string) => Promise<string | null>;
  downloadPsbt: () => void;
  uploadSignedPsbt: (file: File) => Promise<void>;
  markDeviceSigned: (deviceId: string) => void;
  clearError: () => void;
  reset: () => void;
}

export function useSendTransactionActions({
  walletId,
  wallet,
  state,
  initialPsbt,
  initialTxData,
}: UseSendTransactionActionsProps): UseSendTransactionActionsResult {
  const navigate = useNavigate();
  const { format } = useCurrency();
  const { handleError, showSuccess, showInfo } = useErrorHandler();
  const { playEventSound } = useNotificationSound();
  const hardwareWallet = useHardwareWallet();

  // State - initialize from props for draft mode
  const [isCreating, setIsCreating] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txData, setTxData] = useState<TransactionData | null>(initialTxData || null);
  const [unsignedPsbt, setUnsignedPsbt] = useState<string | null>(initialPsbt || null);
  const [signedRawTx, setSignedRawTx] = useState<string | null>(null);  // Raw tx hex from Trezor
  const [signedDevices, setSignedDevices] = useState<Set<string>>(new Set());
  const [payjoinStatus, setPayjoinStatus] = useState<'idle' | 'attempting' | 'success' | 'failed'>('idle');
  const payjoinAttempted = useRef(false);

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
        if (!output.sendMax && (!output.amount || parseInt(output.amount) <= 0)) {
          setError(`Output ${i + 1}: Please enter a valid amount`);
          return null;
        }
      }

      // Prepare outputs for API
      const apiOutputs = state.outputs.map(o => ({
        address: o.address,
        amount: o.sendMax ? 0 : parseInt(o.amount),
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
          amount: parseInt(state.outputs[0].amount),
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
          amount: singleResult.effectiveAmount || parseInt(state.outputs[0].amount),
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
  }, [walletId, state]);

  // Sign with connected hardware wallet
  const signWithHardwareWallet = useCallback(async (): Promise<string | null> => {
    if (!txData || !hardwareWallet.isConnected || !hardwareWallet.device) {
      setError('Hardware wallet not connected or no transaction to sign');
      return null;
    }

    setIsSigning(true);
    setError(null);

    try {
      const signResult = await hardwareWallet.signPSBT(txData.psbtBase64);
      return signResult.psbt || signResult.rawTx || null;
    } catch (err) {
      log.error('Hardware wallet signing failed', { error: err });
      setError(err instanceof Error ? err.message : 'Hardware wallet signing failed');
      return null;
    } finally {
      setIsSigning(false);
    }
  }, [txData, hardwareWallet]);

  // Sign with a specific device (for multi-sig USB signing)
  const signWithDevice = useCallback(async (device: Device): Promise<boolean> => {
    const psbtToSign = unsignedPsbt || txData?.psbtBase64;
    if (!psbtToSign) {
      setError('No PSBT available to sign');
      return false;
    }

    // Map device type to hardware wallet type
    const hwType = getHardwareWalletType(device.type);
    if (!hwType) {
      setError(`Unsupported device type: ${device.type}. Use PSBT file signing instead.`);
      return false;
    }

    // Only support USB-capable devices
    if (hwType === 'coldcard' || hwType === 'passport') {
      setError(`${device.type} does not support USB signing. Please use PSBT file signing.`);
      return false;
    }

    setIsSigning(true);
    setError(null);

    try {
      log.info('Connecting to device for signing', { deviceId: device.id, type: device.type, hwType });

      // Connect to the hardware wallet
      await hardwareWallet.connect(hwType);

      // Sign the PSBT
      const inputPaths = txData?.inputPaths || [];
      const signResult = await hardwareWallet.signPSBT(psbtToSign, inputPaths);

      if (signResult.psbt || signResult.rawTx) {
        // Update the PSBT with signatures
        const signedPsbt = signResult.psbt || psbtToSign;
        setUnsignedPsbt(signedPsbt);

        // Store raw transaction if returned (Trezor returns fully signed rawTx)
        if (signResult.rawTx) {
          log.info('Storing signed raw transaction from device', {
            deviceId: device.id,
            rawTxLength: signResult.rawTx.length,
            rawTxPreview: signResult.rawTx.substring(0, 50) + '...',
          });
          setSignedRawTx(signResult.rawTx);
        }

        // Mark this device as signed
        setSignedDevices(prev => new Set([...prev, device.id]));

        log.info('Device signing successful', {
          deviceId: device.id,
          hasRawTx: !!signResult.rawTx,
          hasPsbt: !!signResult.psbt
        });
        return true;
      } else {
        setError('Signing did not produce a result');
        return false;
      }
    } catch (err) {
      log.error('Device signing failed', { deviceId: device.id, error: err });
      setError(err instanceof Error ? err.message : 'Failed to sign with device');
      return false;
    } finally {
      setIsSigning(false);
      // Disconnect after signing
      hardwareWallet.disconnect();
    }
  }, [txData, unsignedPsbt, hardwareWallet]);

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
    const rawTxToUse = rawTxHex || signedRawTx;

    if (!psbtToUse && !rawTxToUse) {
      setError('No signed transaction available');
      return false;
    }

    log.info('Broadcasting transaction', { hasPsbt: !!psbtToUse, hasRawTx: !!rawTxToUse });

    setIsBroadcasting(true);
    setError(null);

    try {
      const effectiveAmount = txData.effectiveAmount ||
        (txData.outputs?.reduce((sum, o) => sum + o.amount, 0) || 0);

      const broadcastResult = await transactionsApi.broadcastTransaction(walletId, {
        signedPsbtBase64: psbtToUse,
        rawTxHex: rawTxToUse,
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
  }, [walletId, txData, unsignedPsbt, signedRawTx, state, format, showSuccess, playEventSound, navigate]);

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
        amount: o.sendMax ? 0 : parseInt(o.amount),
        sendMax: o.sendMax,
      }));

      const effectiveAmount = currentTxData.effectiveAmount ||
        (currentTxData.outputs?.reduce((sum, o) => sum + o.amount, 0) ||
         parseInt(state.outputs[0].amount));

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
        // Update existing draft - only update signed PSBT if it differs from original
        await draftsApi.updateDraft(walletId, state.draftId, {
          signedPsbtBase64: unsignedPsbt !== currentTxData.psbtBase64 ? unsignedPsbt || undefined : undefined,
        });
        draftId = state.draftId;
        showSuccess('Draft updated successfully', 'Draft Saved');
      } else {
        // Create new draft
        const result = await draftsApi.createDraft(walletId, draftRequest);
        draftId = result.id;
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
  }, [walletId, txData, unsignedPsbt, state, createTransaction, showSuccess, navigate]);

  // Download PSBT file (base64 format - widely supported)
  const downloadPsbt = useCallback(() => {
    const psbt = unsignedPsbt || txData?.psbtBase64;
    if (!psbt) {
      setError('No PSBT available to download');
      return;
    }

    // Log PSBT info for debugging
    log.debug('Downloading PSBT', {
      length: psbt.length,
      prefix: psbt.substring(0, 20),
      isValidBase64: /^[A-Za-z0-9+/=]+$/.test(psbt),
    });

    // Save as base64 text (most wallets auto-detect format)
    const blob = new Blob([psbt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wallet.name || 'transaction'}_unsigned.psbt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [unsignedPsbt, txData, wallet.name]);

  // Upload signed PSBT (supports both binary and base64 formats)
  const uploadSignedPsbt = useCallback(async (file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);

        // Check if it's binary PSBT (starts with magic bytes 0x70736274 = "psbt")
        // or base64 (starts with "cHNidP8" which is base64 for "psbt\xff")
        let base64Psbt: string;

        if (bytes[0] === 0x70 && bytes[1] === 0x73 && bytes[2] === 0x62 && bytes[3] === 0x74) {
          // Binary PSBT - convert to base64
          let binaryString = '';
          for (let i = 0; i < bytes.length; i++) {
            binaryString += String.fromCharCode(bytes[i]);
          }
          base64Psbt = btoa(binaryString);
          log.debug('Uploaded binary PSBT, converted to base64');
        } else {
          // Assume it's already base64 text
          const textDecoder = new TextDecoder();
          base64Psbt = textDecoder.decode(bytes).trim();
          log.debug('Uploaded base64 PSBT');
        }

        log.debug('Uploaded signed PSBT', { preview: base64Psbt.substring(0, 50) + '...' });
        setUnsignedPsbt(base64Psbt); // Now contains signed PSBT
        setSignedDevices(prev => new Set([...prev, 'psbt-signed']));
        resolve();
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }, []);

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
    setPayjoinStatus('idle');
    payjoinAttempted.current = false;
  }, []);

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
    markDeviceSigned,
    clearError,
    reset,
  };
}
