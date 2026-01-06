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
import { queryClient } from '../providers/QueryProvider';
import { createLogger } from '../utils/logger';
import { isMultisigType } from '../types';
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

/**
 * Extract xpubs from a multisig descriptor keyed by fingerprint
 * Returns a map of fingerprint (lowercase) -> xpub for Trezor multisig signing
 */
function extractXpubsFromDescriptor(descriptor: string | undefined): Record<string, string> | undefined {
  if (!descriptor) {
    log.warn('extractXpubsFromDescriptor: No descriptor provided');
    return undefined;
  }

  log.info('extractXpubsFromDescriptor: Parsing descriptor', {
    descriptorLength: descriptor.length,
    descriptorPreview: descriptor.substring(0, 100) + '...',
  });

  // Match patterns like [fingerprint/path]xpub...
  // Handles sortedmulti, wsh, sh-wsh descriptors
  // The xpub can contain any base58 character (alphanumeric except 0, O, I, l)
  const keyRegex = /\[([a-fA-F0-9]{8})\/[^\]]+\]([xyztuvYZTUV]pub[1-9A-HJ-NP-Za-km-z]+)/g;
  const xpubMap: Record<string, string> = {};

  let match;
  while ((match = keyRegex.exec(descriptor)) !== null) {
    const fingerprint = match[1].toLowerCase();
    const xpub = match[2];
    log.info('extractXpubsFromDescriptor: Found xpub', {
      fingerprint,
      xpubPrefix: xpub.substring(0, 20),
      xpubLength: xpub.length,
    });
    xpubMap[fingerprint] = xpub;
  }

  if (Object.keys(xpubMap).length === 0) {
    log.warn('extractXpubsFromDescriptor: No xpubs found in descriptor');
    return undefined;
  }

  log.info('extractXpubsFromDescriptor: Extracted xpubs', {
    fingerprints: Object.keys(xpubMap),
    count: Object.keys(xpubMap).length,
  });

  return xpubMap;
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
  uploadSignedPsbt: (file: File, deviceId?: string) => Promise<void>;
  processQrSignedPsbt: (signedPsbt: string, deviceId: string) => void;
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
  // Initialize signedDevices from state for draft resume (state.signedDevices is loaded from draft)
  const [signedDevices, setSignedDevices] = useState<Set<string>>(() => new Set(state.signedDevices));
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
      // For multisig wallets, extract xpubs from descriptor for Trezor signing
      const multisigXpubs = isMultisigType(wallet.type)
        ? extractXpubsFromDescriptor(wallet.descriptor)
        : undefined;

      log.info('signWithHardwareWallet: Prepared for signing', {
        walletType: wallet.type,
        isMultisig: isMultisigType(wallet.type),
        hasDescriptor: !!wallet.descriptor,
        descriptorPreview: wallet.descriptor ? wallet.descriptor.substring(0, 200) + '...' : 'N/A',
        hasXpubs: !!multisigXpubs,
        xpubFingerprints: multisigXpubs ? Object.keys(multisigXpubs) : [],
      });

      const signResult = await hardwareWallet.signPSBT(
        txData.psbtBase64,
        txData.inputPaths || [],
        multisigXpubs
      );
      return signResult.psbt || signResult.rawTx || null;
    } catch (err) {
      log.error('Hardware wallet signing failed', { error: err });
      setError(err instanceof Error ? err.message : 'Hardware wallet signing failed');
      return null;
    } finally {
      setIsSigning(false);
    }
  }, [txData, hardwareWallet, wallet]);

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
      // For multisig wallets, extract xpubs from descriptor for Trezor signing
      const multisigXpubs = isMultisigType(wallet.type)
        ? extractXpubsFromDescriptor(wallet.descriptor)
        : undefined;

      log.info('signWithDevice: Prepared for signing', {
        deviceId: device.id,
        walletType: wallet.type,
        isMultisig: isMultisigType(wallet.type),
        hasDescriptor: !!wallet.descriptor,
        descriptorPreview: wallet.descriptor ? wallet.descriptor.substring(0, 200) + '...' : 'N/A',
        hasXpubs: !!multisigXpubs,
        xpubFingerprints: multisigXpubs ? Object.keys(multisigXpubs) : [],
      });

      const signResult = await hardwareWallet.signPSBT(psbtToSign, inputPaths, multisigXpubs);

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

        // Persist signature to draft if we're in draft mode
        if (state.draftId) {
          try {
            await draftsApi.updateDraft(walletId, state.draftId, {
              signedPsbtBase64: signedPsbt,
              signedDeviceId: device.id,
            });
            log.info('Signature persisted to draft', { draftId: state.draftId, deviceId: device.id });
          } catch (persistErr) {
            log.warn('Failed to persist signature to draft', { error: persistErr });
            // Don't fail the signing - the signature is still valid locally
          }
        }

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
  }, [txData, unsignedPsbt, hardwareWallet, state.draftId, walletId]);

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
  }, [walletId, txData, unsignedPsbt, signedDevices, state, createTransaction, showSuccess, navigate]);

  // Download PSBT file (binary format - required by most hardware wallets)
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

    // Convert base64 to binary (BIP 174 standard format for .psbt files)
    const binaryString = atob(psbt);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Verify it starts with PSBT magic bytes
    if (bytes[0] !== 0x70 || bytes[1] !== 0x73 || bytes[2] !== 0x62 || bytes[3] !== 0x74) {
      log.warn('PSBT does not start with magic bytes', {
        bytes: Array.from(bytes.slice(0, 8)),
      });
    }

    const blob = new Blob([bytes], { type: 'application/octet-stream' });
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
  // deviceId is optional - for multisig, pass the device ID to track which device signed
  const uploadSignedPsbt = useCallback(async (file: File, deviceId?: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
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

          // Use provided deviceId or fallback to 'psbt-signed' for single-sig
          const effectiveDeviceId = deviceId || 'psbt-signed';

          log.debug('Uploaded signed PSBT', {
            preview: base64Psbt.substring(0, 50) + '...',
            deviceId: effectiveDeviceId
          });
          setUnsignedPsbt(base64Psbt); // Now contains signed PSBT
          setSignedDevices(prev => new Set([...prev, effectiveDeviceId]));

          // Persist signature to draft if we're in draft mode
          if (state.draftId) {
            try {
              await draftsApi.updateDraft(walletId, state.draftId, {
                signedPsbtBase64: base64Psbt,
                signedDeviceId: effectiveDeviceId,
              });
              log.info('Uploaded PSBT signature persisted to draft', {
                draftId: state.draftId,
                deviceId: effectiveDeviceId
              });
            } catch (persistErr) {
              log.warn('Failed to persist uploaded PSBT to draft', { error: persistErr });
            }
          }

          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }, [state.draftId, walletId]);

  // Process QR-scanned signed PSBT
  const processQrSignedPsbt = useCallback(async (signedPsbt: string, deviceId: string) => {
    log.info('Processing QR-signed PSBT', { deviceId, psbtLength: signedPsbt.length });
    setUnsignedPsbt(signedPsbt);
    setSignedDevices(prev => new Set([...prev, deviceId]));

    // Persist signature to draft if we're in draft mode
    if (state.draftId) {
      try {
        await draftsApi.updateDraft(walletId, state.draftId, {
          signedPsbtBase64: signedPsbt,
          signedDeviceId: deviceId,
        });
        log.info('QR signature persisted to draft', { draftId: state.draftId, deviceId });
      } catch (persistErr) {
        log.warn('Failed to persist QR signature to draft', { error: persistErr });
      }
    }
  }, [state.draftId, walletId]);

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
    processQrSignedPsbt,
    markDeviceSigned,
    clearError,
    reset,
  };
}
