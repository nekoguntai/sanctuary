/**
 * QR Scanner Hook
 *
 * Manages state for QR code scanning with support for multiple formats:
 * - UR format (Keystone, Foundation Passport, SeedSigner)
 * - ur:bytes format (Foundation Passport JSON export)
 * - BBQr format (Coldcard Q multi-part)
 * - Plain JSON/text formats
 *
 * Key features:
 * - Multi-part QR code assembly (fountain codes)
 * - Progress tracking for animated QR codes
 * - Camera error handling
 * - File upload as alternative to camera
 */

import { useState, useRef, useCallback } from 'react';
import { URRegistryDecoder } from '@keystonehq/bc-ur-registry';
import { URDecoder as BytesURDecoder } from '@ngraveio/bc-ur';
import { BBQrDecoder, isBBQr, BBQrFileTypes, BBQrEncodings } from '../services/bbqr';
import { parseDeviceJson, DeviceAccount } from '../services/deviceParsers';
import {
  extractFromUrResult,
  extractFromUrBytesContent,
  getUrType,
} from '../utils/urDeviceDecoder';
import {
  normalizeDerivationPath,
  generateMissingFieldsWarning,
  QrExtractedFields,
} from '../utils/deviceConnection';
import { createLogger } from '../utils/logger';

const log = createLogger('useQrScanner');

/** Result of a successful QR scan */
export interface QrScanResult {
  /** Extended public key */
  xpub: string;
  /** Master fingerprint (may be empty) */
  fingerprint: string;
  /** Derivation path (may be empty) */
  derivationPath: string;
  /** Device label (may be empty) */
  label?: string;
  /** Multiple accounts if available */
  accounts?: DeviceAccount[];
  /** Which fields were extracted from QR */
  extractedFields: QrExtractedFields;
  /** Warning message for missing fields */
  warning: string | null;
}

export interface UseQrScannerState {
  /** QR input mode */
  qrMode: 'camera' | 'file';
  /** Set QR input mode */
  setQrMode: (mode: 'camera' | 'file') => void;
  /** Whether camera is active */
  cameraActive: boolean;
  /** Set camera active state */
  setCameraActive: (active: boolean) => void;
  /** Camera error message */
  cameraError: string | null;
  /** Progress for multi-part UR codes (0-100) */
  urProgress: number;
  /** Whether currently processing a scan */
  scanning: boolean;
  /** Result of successful scan */
  scanResult: QrScanResult | null;
  /** Error message from failed scan */
  error: string | null;
  /** Handle a scanned QR code */
  handleQrScan: (result: { rawValue: string }[]) => void;
  /** Handle camera error */
  handleCameraError: (error: unknown) => void;
  /** Handle file content (from file upload) */
  handleFileContent: (content: string) => void;
  /** Reset all scanner state */
  reset: () => void;
  /** Close camera and clear progress */
  stopCamera: () => void;
}

/**
 * Hook for managing QR code scanning
 *
 * @example
 * const {
 *   qrMode, setQrMode,
 *   cameraActive, setCameraActive,
 *   urProgress,
 *   scanResult,
 *   error,
 *   handleQrScan,
 *   reset,
 * } = useQrScanner();
 *
 * // In Scanner component
 * <Scanner onScan={handleQrScan} onError={handleCameraError} />
 */
export function useQrScanner(): UseQrScannerState {
  // UI state
  const [qrMode, setQrMode] = useState<'camera' | 'file'>('camera');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [urProgress, setUrProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<QrScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Decoder refs - managed internally, reset together
  const urDecoderRef = useRef<URRegistryDecoder | null>(null);
  const bytesDecoderRef = useRef<BytesURDecoder | null>(null);
  const bbqrDecoderRef = useRef<BBQrDecoder | null>(null);

  /**
   * Reset all state and decoder refs
   */
  const reset = useCallback(() => {
    setQrMode('camera');
    setCameraActive(false);
    setCameraError(null);
    setUrProgress(0);
    setScanning(false);
    setScanResult(null);
    setError(null);
    urDecoderRef.current = null;
    bytesDecoderRef.current = null;
    bbqrDecoderRef.current = null;
  }, []);

  /**
   * Stop camera without full reset
   */
  const stopCamera = useCallback(() => {
    setCameraActive(false);
    setUrProgress(0);
    urDecoderRef.current = null;
    bytesDecoderRef.current = null;
    bbqrDecoderRef.current = null;
  }, []);

  /**
   * Create scan result from extracted data
   */
  const createScanResult = useCallback((
    xpub: string,
    fingerprint: string,
    path: string,
    label?: string,
    accounts?: DeviceAccount[]
  ): QrScanResult => {
    const extractedFields: QrExtractedFields = {
      xpub: true,
      fingerprint: !!fingerprint,
      derivationPath: !!path,
      label: !!label,
    };

    const warning = generateMissingFieldsWarning({
      hasFingerprint: !!fingerprint,
      hasDerivationPath: !!path,
    });

    return {
      xpub,
      fingerprint: fingerprint ? fingerprint.toUpperCase() : '',
      derivationPath: path ? normalizeDerivationPath(path) : '',
      label,
      accounts,
      extractedFields,
      warning,
    };
  }, []);

  /**
   * Process UR bytes format (Foundation Passport)
   */
  const processUrBytes = useCallback((content: string): boolean => {
    // Initialize bytes decoder if needed
    if (!bytesDecoderRef.current) {
      log.debug('Creating new BytesURDecoder for ur:bytes');
      bytesDecoderRef.current = new BytesURDecoder();
    }

    // Feed the part to the decoder
    const partReceived = bytesDecoderRef.current.receivePart(content);
    log.debug('Part received', { partReceived });

    // Check progress
    const progress = bytesDecoderRef.current.estimatedPercentComplete();
    const progressPercent = Math.round(progress * 100);
    setUrProgress(progressPercent);

    const expectedCount = bytesDecoderRef.current.expectedPartCount();
    const receivedIndexes = bytesDecoderRef.current.receivedPartIndexes();
    const isComplete = bytesDecoderRef.current.isComplete() === true;

    log.info('UR bytes progress', { progress: progressPercent, received: receivedIndexes.length, expected: expectedCount });

    if (!isComplete) {
      return false; // Need more parts
    }

    // Decode complete
    log.info('UR bytes decode complete');
    setCameraActive(false);
    setScanning(true);
    setError(null);

    if (!bytesDecoderRef.current.isSuccess()) {
      const errResult = bytesDecoderRef.current.resultError();
      throw new Error(`UR bytes decode failed: ${errResult || 'unknown error'}`);
    }

    // Get decoded UR and extract bytes
    const decodedUR = bytesDecoderRef.current.resultUR();
    const rawBytes = decodedUR.decodeCBOR();
    const textDecoder = new TextDecoder('utf-8');
    const textContent = textDecoder.decode(rawBytes);

    // Parse as JSON
    const extracted = extractFromUrBytesContent(textContent);
    if (extracted && extracted.xpub) {
      setScanResult(createScanResult(
        extracted.xpub,
        extracted.fingerprint,
        extracted.path
      ));
      setScanning(false);
      setUrProgress(0);
      bytesDecoderRef.current = null;
      log.info('UR bytes QR code parsed successfully');
      return true;
    }

    throw new Error('Could not extract xpub from ur:bytes content');
  }, [createScanResult]);

  /**
   * Process standard UR format (crypto-hdkey, crypto-output, etc.)
   */
  const processUrRegistry = useCallback((content: string, urType: string): boolean => {
    // Initialize decoder if needed
    if (!urDecoderRef.current) {
      log.debug('Creating new URRegistryDecoder');
      urDecoderRef.current = new URRegistryDecoder();
    }

    // Feed the part
    urDecoderRef.current.receivePart(content);

    // Check progress
    const progress = urDecoderRef.current.estimatedPercentComplete();
    const progressPercent = Math.round(progress * 100);
    setUrProgress(progressPercent);
    log.info('UR progress', { progress: progressPercent, isComplete: urDecoderRef.current.isComplete() });

    if (!urDecoderRef.current.isComplete()) {
      return false; // Need more parts
    }

    // Decode complete
    log.info('UR decode complete');
    setCameraActive(false);
    setScanning(true);
    setError(null);

    if (!urDecoderRef.current.isSuccess()) {
      const errResult = urDecoderRef.current.resultError();
      throw new Error(`UR decode failed: ${errResult || 'unknown error'}`);
    }

    // Get decoded registry type
    const registryType = urDecoderRef.current.resultRegistryType();
    log.info('UR decoded', { type: registryType?.constructor?.name });

    const extracted = extractFromUrResult(registryType);
    if (extracted && extracted.xpub) {
      setScanResult(createScanResult(
        extracted.xpub,
        extracted.fingerprint,
        extracted.path
      ));
      setScanning(false);
      setUrProgress(0);
      urDecoderRef.current = null;
      log.info('UR QR code parsed successfully');
      return true;
    }

    throw new Error(`Could not extract xpub from UR type: ${registryType?.constructor?.name || urType}`);
  }, [createScanResult]);

  /**
   * Process BBQr format (Coldcard Q)
   */
  const processBBQr = useCallback((content: string): boolean => {
    // Initialize decoder if needed
    if (!bbqrDecoderRef.current) {
      log.debug('Creating new BBQrDecoder');
      bbqrDecoderRef.current = new BBQrDecoder();
    }

    // Feed the part
    const accepted = bbqrDecoderRef.current.receivePart(content);
    if (!accepted) {
      const err = bbqrDecoderRef.current.getError();
      throw new Error(`BBQr error: ${err}`);
    }

    // Update progress
    const progress = bbqrDecoderRef.current.getProgress();
    setUrProgress(progress);

    const received = bbqrDecoderRef.current.getReceivedCount();
    const total = bbqrDecoderRef.current.getTotalParts();
    const fileType = bbqrDecoderRef.current.getFileType();

    log.info('BBQr progress', {
      progress,
      received,
      total,
      fileType: fileType ? BBQrFileTypes[fileType] : 'unknown',
    });

    if (!bbqrDecoderRef.current.isComplete()) {
      return false; // Need more parts
    }

    // Decode complete
    log.info('BBQr decode complete');
    setCameraActive(false);
    setScanning(true);
    setError(null);

    const decoded = bbqrDecoderRef.current.decode();
    bbqrDecoderRef.current = null;
    setUrProgress(0);

    // For JSON file type, parse the content
    if (decoded.fileType === 'J' && decoded.text) {
      const parseResult = parseDeviceJson(decoded.text);
      if (parseResult && parseResult.xpub) {
        setScanResult(createScanResult(
          parseResult.xpub,
          parseResult.fingerprint || '',
          parseResult.derivationPath || '',
          parseResult.label,
          parseResult.accounts
        ));
        setScanning(false);
        log.info('BBQr QR code parsed successfully', { format: parseResult.format });
        return true;
      }
      throw new Error('Could not extract xpub from BBQr JSON content');
    }

    throw new Error(
      `BBQr file type "${BBQrFileTypes[decoded.fileType]}" is not supported for device import. ` +
      'Please use the JSON export format from your Coldcard.'
    );
  }, [createScanResult]);

  /**
   * Process plain JSON/text content
   */
  const processPlainContent = useCallback((content: string): boolean => {
    const parseResult = parseDeviceJson(content);
    if (parseResult && parseResult.xpub) {
      setScanResult(createScanResult(
        parseResult.xpub,
        parseResult.fingerprint || '',
        parseResult.derivationPath || '',
        parseResult.label,
        parseResult.accounts
      ));
      log.info('QR code parsed successfully', { format: parseResult.format });
      return true;
    }

    log.debug('No xpub found in non-UR content', { preview: content.substring(0, 200) });
    throw new Error(
      `Could not find xpub in QR code. Content starts with: "${content.substring(0, 30)}..."`
    );
  }, [createScanResult]);

  /**
   * Handle QR scan from camera
   */
  const handleQrScan = useCallback((result: { rawValue: string }[]) => {
    if (!result || result.length === 0) return;

    const content = result[0].rawValue;
    const contentLower = content.toLowerCase();

    log.info('QR code scanned', { length: content.length, prefix: content.substring(0, 50) });

    try {
      // Check if UR format
      if (contentLower.startsWith('ur:')) {
        const urType = getUrType(content) || 'unknown';
        log.debug('UR type detected', { urType });

        // Use BytesURDecoder for ur:bytes
        if (urType === 'bytes') {
          processUrBytes(content);
          return;
        }

        // Use URRegistryDecoder for other types
        processUrRegistry(content, urType);
        return;
      }

      // Check for BBQr format
      if (isBBQr(content)) {
        processBBQr(content);
        return;
      }

      // Plain content
      setCameraActive(false);
      setScanning(true);
      setError(null);

      processPlainContent(content);
      setScanning(false);

    } catch (err) {
      log.error('Failed to process QR code', { error: err });
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      setCameraActive(false);
      setScanning(false);
      setUrProgress(0);
      urDecoderRef.current = null;
      bytesDecoderRef.current = null;
      bbqrDecoderRef.current = null;
    }
  }, [processUrBytes, processUrRegistry, processBBQr, processPlainContent]);

  /**
   * Handle camera error
   */
  const handleCameraError = useCallback((error: unknown) => {
    log.error('Camera error', { error });
    setCameraActive(false);

    if (error instanceof Error) {
      if (error.name === 'NotAllowedError') {
        setCameraError('Camera access denied. Please allow camera permissions and try again.');
      } else if (error.name === 'NotFoundError') {
        setCameraError('No camera found on this device.');
      } else {
        setCameraError(`Camera error: ${error.message}`);
      }
    } else {
      setCameraError('Failed to access camera. Make sure you are using HTTPS.');
    }
  }, []);

  /**
   * Handle file content (alternative to camera)
   */
  const handleFileContent = useCallback((content: string) => {
    setScanning(true);
    setError(null);

    try {
      processPlainContent(content);
      setScanning(false);
    } catch (err) {
      log.error('Failed to process file content', { error: err });
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      setScanning(false);
    }
  }, [processPlainContent]);

  // Custom setter for qrMode that also clears camera error
  const setQrModeWithReset = useCallback((mode: 'camera' | 'file') => {
    setQrMode(mode);
    if (mode === 'camera') {
      setCameraError(null);
    } else {
      setCameraActive(false);
    }
  }, []);

  return {
    qrMode,
    setQrMode: setQrModeWithReset,
    cameraActive,
    setCameraActive,
    cameraError,
    urProgress,
    scanning,
    scanResult,
    error,
    handleQrScan,
    handleCameraError,
    handleFileContent,
    reset,
    stopCamera,
  };
}
