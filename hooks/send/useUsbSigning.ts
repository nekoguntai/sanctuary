/**
 * useUsbSigning Hook
 *
 * Handles USB hardware wallet signing for both single-sig (signWithHardwareWallet)
 * and multi-sig (signWithDevice) flows.
 */

import { useCallback } from 'react';
import * as draftsApi from '../../src/api/drafts';
import { useHardwareWallet } from '../useHardwareWallet';
import { isMultisigType } from '../../types';
import { createLogger } from '../../utils/logger';
import type { Wallet, Device } from '../../types';
import type { TransactionData } from './types';
import { getHardwareWalletType, extractXpubsFromDescriptor } from './types';

const log = createLogger('UsbSigning');

export interface UseUsbSigningDeps {
  walletId: string;
  wallet: Wallet;
  draftId: string | null;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  setIsSigning: (v: boolean) => void;
  setError: (v: string | null) => void;
  setUnsignedPsbt: (v: string | null) => void;
  setSignedRawTx: (v: string | null) => void;
  setSignedDevices: (fn: (prev: Set<string>) => Set<string>) => void;
}

export interface UseUsbSigningResult {
  signWithHardwareWallet: () => Promise<string | null>;
  signWithDevice: (device: Device) => Promise<boolean>;
}

export function useUsbSigning({
  walletId,
  wallet,
  draftId,
  txData,
  unsignedPsbt,
  setIsSigning,
  setError,
  setUnsignedPsbt,
  setSignedRawTx,
  setSignedDevices,
}: UseUsbSigningDeps): UseUsbSigningResult {
  const hardwareWallet = useHardwareWallet();

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
  }, [txData, hardwareWallet, wallet, setIsSigning, setError]);

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
        if (draftId) {
          try {
            await draftsApi.updateDraft(walletId, draftId, {
              signedPsbtBase64: signedPsbt,
              signedDeviceId: device.id,
            });
            log.info('Signature persisted to draft', { draftId, deviceId: device.id });
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
  }, [txData, unsignedPsbt, hardwareWallet, draftId, walletId, wallet, setIsSigning, setError, setUnsignedPsbt, setSignedRawTx, setSignedDevices]);

  return { signWithHardwareWallet, signWithDevice };
}
