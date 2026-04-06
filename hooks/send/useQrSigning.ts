/**
 * useQrSigning Hook
 *
 * Handles QR/airgap signing flows: downloading PSBTs, uploading signed PSBTs,
 * and processing QR-scanned signed PSBTs. Includes PSBT combination logic
 * for multisig wallets that require multiple device signatures.
 */

import { useCallback } from 'react';
import * as bitcoin from 'bitcoinjs-lib';
import * as draftsApi from '../../src/api/drafts';
import { isMultisigType } from '../../types';
import { createLogger } from '../../utils/logger';
import { downloadBinary } from '../../utils/download';
import { uint8ArrayEquals, toHex } from '../../utils/bufferUtils';
import type { Wallet } from '../../types';
import type { TransactionData } from './types';

const log = createLogger('QrSigning');

export interface UseQrSigningDeps {
  walletId: string;
  wallet: Wallet;
  draftId: string | null;
  txData: TransactionData | null;
  unsignedPsbt: string | null;
  setError: (v: string | null) => void;
  setUnsignedPsbt: (v: string | null) => void;
  setSignedDevices: (fn: (prev: Set<string>) => Set<string>) => void;
}

export interface UseQrSigningResult {
  downloadPsbt: () => void;
  uploadSignedPsbt: (file: File, deviceId?: string, deviceFingerprint?: string) => Promise<void>;
  processQrSignedPsbt: (signedPsbt: string, deviceId: string) => void;
}

export function useQrSigning({
  walletId,
  wallet,
  draftId,
  txData,
  unsignedPsbt,
  setError,
  setUnsignedPsbt,
  setSignedDevices,
}: UseQrSigningDeps): UseQrSigningResult {

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

    downloadBinary(bytes, `${wallet.name || 'transaction'}_unsigned.psbt`);
  }, [unsignedPsbt, txData, wallet.name, setError]);

  // Upload signed PSBT (supports both binary and base64 formats)
  // deviceId is optional - for multisig, pass the device ID to track which device signed
  const uploadSignedPsbt = useCallback(async (file: File, deviceId?: string, deviceFingerprint?: string): Promise<void> => {
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
            deviceId: effectiveDeviceId,
            deviceFingerprint,
            hasExistingPsbt: !!unsignedPsbt,
            existingPsbtLength: unsignedPsbt?.length || 0,
            walletType: wallet.type,
            isMultisig: isMultisigType(wallet.type),
          });

          // Validate uploaded PSBT has a signature from the expected device
          if (deviceFingerprint && isMultisigType(wallet.type)) {
            try {
              const uploadedPsbt = bitcoin.Psbt.fromBase64(base64Psbt);
              let hasSignatureFromDevice = false;

              // Check each input for a signature from the expected device
              for (const input of uploadedPsbt.data.inputs) {
                if (input.partialSig && input.bip32Derivation) {
                  for (const ps of input.partialSig) {
                    // Find the bip32Derivation entry for this pubkey
                    const derivation = input.bip32Derivation.find(d =>
                      uint8ArrayEquals(d.pubkey, ps.pubkey)
                    );
                    if (derivation) {
                      const sigFingerprint = toHex(derivation.masterFingerprint);
                      log.debug('Signature fingerprint check', {
                        sigFingerprint,
                        expectedFingerprint: deviceFingerprint,
                        matches: sigFingerprint === deviceFingerprint,
                      });
                      if (sigFingerprint === deviceFingerprint) {
                        hasSignatureFromDevice = true;
                        break;
                      }
                    }
                  }
                }
                if (hasSignatureFromDevice) break;
              }

              if (!hasSignatureFromDevice) {
                const error = `This PSBT does not contain a signature from the selected device (${deviceFingerprint}). Please upload the correct file.`;
                log.error('Uploaded PSBT missing expected signature', { deviceFingerprint });
                reject(new Error(error));
                return;
              }
              log.debug('Signature validation passed');
            } catch (validationError) {
              log.warn('Could not validate signature', { error: validationError });
              // Continue anyway if validation fails - might be a format issue
            }
          }

          // For multisig, combine new signatures with existing PSBT instead of replacing
          let combinedPsbt = base64Psbt;
          if (unsignedPsbt && isMultisigType(wallet.type)) {
            log.debug('Will combine PSBTs');
            try {
              const existingPsbtObj = bitcoin.Psbt.fromBase64(unsignedPsbt);
              const newPsbtObj = bitcoin.Psbt.fromBase64(base64Psbt);

              // Count signatures before combining
              let existingSigCount = 0;
              let newSigCount = 0;
              const existingPubkeys: string[] = [];
              const newPubkeys: string[] = [];
              for (const input of existingPsbtObj.data.inputs) {
                if (input.partialSig) {
                  existingSigCount += input.partialSig.length;
                  input.partialSig.forEach(ps => existingPubkeys.push(toHex(ps.pubkey).substring(0, 16)));
                }
              }
              for (const input of newPsbtObj.data.inputs) {
                if (input.partialSig) {
                  newSigCount += input.partialSig.length;
                  input.partialSig.forEach(ps => newPubkeys.push(toHex(ps.pubkey).substring(0, 16)));
                }
              }

              log.debug('Combining PSBTs', {
                existingSigCount,
                newSigCount,
                existingPubkeys,
                newPubkeys,
                sameKey: existingPubkeys[0] === newPubkeys[0]
              });

              // Combine PSBTs - this merges partial signatures from both
              existingPsbtObj.combine(newPsbtObj);

              // Count total signatures after combining
              let totalSigs = 0;
              for (const input of existingPsbtObj.data.inputs) {
                if (input.partialSig) totalSigs += input.partialSig.length;
              }

              log.debug('Combined PSBTs', { totalSignatures: totalSigs });
              combinedPsbt = existingPsbtObj.toBase64();
            } catch (combineError) {
              log.error('PSBT combine failed', { error: combineError });
              // Fall back to just using the new PSBT
              combinedPsbt = base64Psbt;
            }
          } else {
            log.debug('Not combining - no existing PSBT or not multisig');
          }

          setUnsignedPsbt(combinedPsbt);
          setSignedDevices(prev => new Set([...prev, effectiveDeviceId]));

          // Persist signature to draft if we're in draft mode
          if (draftId) {
            try {
              await draftsApi.updateDraft(walletId, draftId, {
                signedPsbtBase64: combinedPsbt,
                signedDeviceId: effectiveDeviceId,
              });
              log.info('Uploaded PSBT signature persisted to draft', {
                draftId,
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
  }, [draftId, walletId, unsignedPsbt, wallet.type, setError, setUnsignedPsbt, setSignedDevices]);

  // Process QR-scanned signed PSBT
  const processQrSignedPsbt = useCallback(async (signedPsbt: string, deviceId: string) => {
    log.info('Processing QR-signed PSBT', { deviceId, psbtLength: signedPsbt.length });

    // For multisig, combine new signatures with existing PSBT instead of replacing
    let combinedPsbt = signedPsbt;
    if (unsignedPsbt && isMultisigType(wallet.type)) {
      try {
        const existingPsbtObj = bitcoin.Psbt.fromBase64(unsignedPsbt);
        const newPsbtObj = bitcoin.Psbt.fromBase64(signedPsbt);

        // Count signatures before combining
        let existingSigCount = 0;
        let newSigCount = 0;
        for (const input of existingPsbtObj.data.inputs) {
          if (input.partialSig) existingSigCount += input.partialSig.length;
        }
        for (const input of newPsbtObj.data.inputs) {
          if (input.partialSig) newSigCount += input.partialSig.length;
        }

        log.info('Combining PSBTs', { existingSigCount, newSigCount });

        // Combine PSBTs - this merges partial signatures from both
        existingPsbtObj.combine(newPsbtObj);

        // Count total signatures after combining
        let totalSigs = 0;
        for (const input of existingPsbtObj.data.inputs) {
          if (input.partialSig) totalSigs += input.partialSig.length;
        }

        log.info('Combined PSBT', { totalSignatures: totalSigs });
        combinedPsbt = existingPsbtObj.toBase64();
      } catch (combineError) {
        log.warn('Failed to combine PSBTs, using new PSBT', {
          error: combineError instanceof Error ? combineError.message : String(combineError),
        });
        // Fall back to just using the new PSBT
        combinedPsbt = signedPsbt;
      }
    }

    setUnsignedPsbt(combinedPsbt);
    setSignedDevices(prev => new Set([...prev, deviceId]));

    // Persist signature to draft if we're in draft mode
    if (draftId) {
      try {
        await draftsApi.updateDraft(walletId, draftId, {
          signedPsbtBase64: combinedPsbt,
          signedDeviceId: deviceId,
        });
        log.info('QR signature persisted to draft', { draftId, deviceId });
      } catch (persistErr) {
        log.warn('Failed to persist QR signature to draft', { error: persistErr });
      }
    }
  }, [draftId, walletId, unsignedPsbt, wallet.type, setUnsignedPsbt, setSignedDevices]);

  return { downloadPsbt, uploadSignedPsbt, processQrSignedPsbt };
}
