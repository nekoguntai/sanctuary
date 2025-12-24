/**
 * useHardwareSigning Hook
 *
 * Manages hardware wallet signing state for transactions:
 * - PSBT state (unsigned/signed)
 * - Device signature tracking for multi-sig
 * - Signing progress and UI state
 *
 * Extracted from SendTransaction.tsx for reusability.
 */

import { useState, useCallback, RefObject, useRef } from 'react';

export interface UseHardwareSigningOptions {
  // Called when a PSBT is uploaded/signed
  onPsbtUploaded?: (psbtBase64: string) => void;
  // Called when signing completes for a device
  onDeviceSigned?: (deviceId: string) => void;
}

export interface UseHardwareSigningResult {
  // PSBT state
  unsignedPsbt: string | null;
  setUnsignedPsbt: (psbt: string | null) => void;
  showPsbtOptions: boolean;
  setShowPsbtOptions: (show: boolean) => void;
  psbtFileInputRef: RefObject<HTMLInputElement>;

  // Device signatures
  signedDevices: Set<string>;
  setSignedDevices: React.Dispatch<React.SetStateAction<Set<string>>>;
  markDeviceSigned: (deviceId: string) => void;
  markPsbtSigned: () => void;
  clearSignatures: () => void;
  hasEnoughSignatures: (requiredSignatures: number) => boolean;

  // Signing UI state
  signingDeviceId: string | null;
  setSigningDeviceId: (id: string | null) => void;
  expandedDeviceId: string | null;
  setExpandedDeviceId: (id: string | null) => void;
  psbtDeviceId: string | null;
  setPsbtDeviceId: (id: string | null) => void;

  // Derived state
  hasPsbtSignature: boolean;
  signatureCount: number;

  // Handlers
  handlePsbtUpload: (file: File) => Promise<void>;
  downloadPsbt: (psbtBase64: string, walletName?: string) => void;
}

export function useHardwareSigning(
  options: UseHardwareSigningOptions = {}
): UseHardwareSigningResult {
  const { onPsbtUploaded, onDeviceSigned } = options;

  // PSBT state
  const [unsignedPsbt, setUnsignedPsbt] = useState<string | null>(null);
  const [showPsbtOptions, setShowPsbtOptions] = useState(false);
  const psbtFileInputRef = useRef<HTMLInputElement>(null);

  // Device signatures - Set of device IDs that have signed
  const [signedDevices, setSignedDevices] = useState<Set<string>>(new Set());

  // Signing UI state
  const [signingDeviceId, setSigningDeviceId] = useState<string | null>(null);
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);
  const [psbtDeviceId, setPsbtDeviceId] = useState<string | null>(null);

  // Mark a device as having signed
  const markDeviceSigned = useCallback((deviceId: string) => {
    setSignedDevices(prev => new Set([...prev, deviceId]));
    onDeviceSigned?.(deviceId);
  }, [onDeviceSigned]);

  // Mark that a PSBT file has been signed (for air-gap signing)
  const markPsbtSigned = useCallback(() => {
    setSignedDevices(prev => new Set([...prev, 'psbt-signed']));
  }, []);

  // Clear all signatures
  const clearSignatures = useCallback(() => {
    setSignedDevices(new Set());
    setUnsignedPsbt(null);
    setShowPsbtOptions(false);
    setSigningDeviceId(null);
    setExpandedDeviceId(null);
    setPsbtDeviceId(null);
  }, []);

  // Check if we have enough signatures for the quorum
  const hasEnoughSignatures = useCallback((requiredSignatures: number) => {
    return signedDevices.size >= requiredSignatures;
  }, [signedDevices.size]);

  // Handle PSBT file upload
  const handlePsbtUpload = useCallback(async (file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const trimmedContent = content.trim();
        setUnsignedPsbt(trimmedContent);
        markPsbtSigned();
        onPsbtUploaded?.(trimmedContent);
        resolve();
      };
      reader.onerror = () => reject(new Error('Failed to read PSBT file'));
      reader.readAsText(file);
    });
  }, [markPsbtSigned, onPsbtUploaded]);

  // Download PSBT as file
  const downloadPsbt = useCallback((psbtBase64: string, walletName?: string) => {
    const blob = new Blob([psbtBase64], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${walletName || 'transaction'}_unsigned.psbt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Derived state
  const hasPsbtSignature = signedDevices.has('psbt-signed');
  const signatureCount = signedDevices.size;

  return {
    // PSBT state
    unsignedPsbt,
    setUnsignedPsbt,
    showPsbtOptions,
    setShowPsbtOptions,
    psbtFileInputRef,

    // Device signatures
    signedDevices,
    setSignedDevices,
    markDeviceSigned,
    markPsbtSigned,
    clearSignatures,
    hasEnoughSignatures,

    // Signing UI state
    signingDeviceId,
    setSigningDeviceId,
    expandedDeviceId,
    setExpandedDeviceId,
    psbtDeviceId,
    setPsbtDeviceId,

    // Derived state
    hasPsbtSignature,
    signatureCount,

    // Handlers
    handlePsbtUpload,
    downloadPsbt,
  };
}
