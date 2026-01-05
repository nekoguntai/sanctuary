import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scanner } from '@yudiel/react-qr-scanner';
import { URRegistryDecoder, CryptoOutput, CryptoHDKey, CryptoAccount, RegistryTypes } from '@keystonehq/bc-ur-registry';
import { URDecoder as BytesURDecoder } from '@ngraveio/bc-ur';
import { createDevice, CreateDeviceRequest, getDeviceModels, HardwareDeviceModel, DeviceAccountInput } from '../src/api/devices';
import { parseDeviceJson, parseDeviceData, DeviceAccount } from '../services/deviceParsers';
import { Button } from './ui/Button';
import {
  ArrowLeft,
  Usb,
  FileJson,
  PenTool,
  Check,
  AlertCircle,
  Wifi,
  QrCode,
  HardDrive,
  Shield,
  Code,
  Lock,
  Loader2,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Camera,
  Upload,
  Info
} from 'lucide-react';
import { getDeviceIcon } from './ui/CustomIcons';
import { createLogger } from '../utils/logger';
import { isSecureContext, hardwareWalletService, DeviceType } from '../services/hardwareWallet';
import { useSidebar } from '../contexts/SidebarContext';

const log = createLogger('ConnectDevice');

/**
 * Determine the hardware wallet device type from model name/manufacturer
 */
const getDeviceTypeFromModel = (model: HardwareDeviceModel): DeviceType => {
  const name = model.name.toLowerCase();
  const manufacturer = model.manufacturer.toLowerCase();

  if (manufacturer === 'trezor' || name.includes('trezor')) {
    return 'trezor';
  }
  if (manufacturer === 'ledger' || name.includes('ledger')) {
    return 'ledger';
  }
  if (manufacturer === 'coldcard' || name.includes('coldcard')) {
    return 'coldcard';
  }
  if (manufacturer === 'bitbox' || name.includes('bitbox')) {
    return 'bitbox';
  }
  if (manufacturer === 'foundation' || name.includes('passport')) {
    return 'passport';
  }
  if (manufacturer === 'blockstream' || name.includes('jade')) {
    return 'jade';
  }
  return 'unknown';
};

type ConnectionMethod = 'usb' | 'sd_card' | 'qr_code' | 'manual';

/**
 * Normalize a derivation path to standard format
 * - Ensures 'm/' prefix
 * - Converts 'h' notation to apostrophes (84h -> 84')
 * - For standard BIP paths (44/49/84/86), ensures first 3 levels are hardened
 */
const normalizeDerivationPath = (path: string): string => {
  if (!path) return '';

  let normalized = path.trim();

  // Ensure starts with 'm/'
  if (normalized.startsWith('M/')) {
    normalized = 'm/' + normalized.slice(2);
  } else if (!normalized.startsWith('m/')) {
    normalized = 'm/' + normalized;
  }

  // Convert 'h' notation to apostrophes (e.g., 84h -> 84')
  normalized = normalized.replace(/(\d+)h/g, "$1'");

  // Split into components
  const parts = normalized.split('/');
  if (parts.length < 2) return normalized;

  // Check if this looks like a standard BIP path (44, 49, 84, 86)
  const purposePart = parts[1]?.replace("'", '');
  const standardPurposes = ['44', '49', '84', '86', '48'];

  if (standardPurposes.includes(purposePart)) {
    // For standard BIP paths, ensure first 3 levels after 'm' are hardened
    // m / purpose' / coin_type' / account'
    for (let i = 1; i <= 3 && i < parts.length; i++) {
      if (parts[i] && !parts[i].endsWith("'")) {
        parts[i] = parts[i] + "'";
      }
    }
    normalized = parts.join('/');
  }

  return normalized;
};

/**
 * Generate warning message for missing QR code fields
 * Returns null if no important fields are missing
 */
const generateMissingFieldsWarning = (fields: {
  hasFingerprint: boolean;
  hasDerivationPath: boolean;
}): string | null => {
  const missing: string[] = [];

  if (!fields.hasFingerprint) {
    missing.push('master fingerprint');
  }
  if (!fields.hasDerivationPath) {
    missing.push('derivation path');
  }

  if (missing.length === 0) return null;

  return `QR code did not contain: ${missing.join(', ')}. Please verify these fields are correct.`;
};

// Map connectivity types to icons and labels
// Note: Bluetooth and NFC are not currently supported for direct device communication
const connectivityConfig: Record<string, { icon: React.FC<{ className?: string }>, label: string, description: string }> = {
  usb: { icon: Usb, label: 'USB', description: 'Connect via USB cable' },
  sd_card: { icon: HardDrive, label: 'SD Card', description: 'Import from SD card file' },
  qr_code: { icon: QrCode, label: 'QR Code', description: 'Scan QR codes' },
};

export const ConnectDevice: React.FC = () => {
  const navigate = useNavigate();
  const { refreshSidebar } = useSidebar();

  // Device models from database
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [selectedModel, setSelectedModel] = useState<HardwareDeviceModel | null>(null);

  // Group models by manufacturer for better organization
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Connection method based on device capabilities
  const [method, setMethod] = useState<ConnectionMethod | null>(null);

  // Device Details
  const [label, setLabel] = useState('');
  const [xpub, setXpub] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [derivationPath, setDerivationPath] = useState("m/84'/0'/0'");
  // Multi-account support: parsed accounts from file/QR import
  const [parsedAccounts, setParsedAccounts] = useState<DeviceAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Set<number>>(new Set());

  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [qrExtractedFields, setQrExtractedFields] = useState<{
    xpub: boolean;
    fingerprint: boolean;
    derivationPath: boolean;
    label: boolean;
  } | null>(null);
  const [showQrDetails, setShowQrDetails] = useState(false);

  // QR scanning state
  const [qrMode, setQrMode] = useState<'camera' | 'file'>('camera');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [urProgress, setUrProgress] = useState<number>(0); // Progress for multi-part UR codes
  const urDecoderRef = useRef<URRegistryDecoder | null>(null);
  const bytesDecoderRef = useRef<BytesURDecoder | null>(null); // For ur:bytes format (Foundation Passport)

  // Fetch device models on mount
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const models = await getDeviceModels();
        setDeviceModels(models);

        // Extract unique manufacturers
        const uniqueManufacturers = [...new Set(models.map(m => m.manufacturer))].sort();
        setManufacturers(uniqueManufacturers);
      } catch (err) {
        log.error('Failed to fetch device models', { error: err });
        setError('Failed to load device models. Please try again.');
      } finally {
        setLoadingModels(false);
      }
    };
    fetchModels();
  }, []);

  // Reset method when model changes
  useEffect(() => {
    setMethod(null);
    setScanned(false);
    setXpub('');
    setFingerprint('');
    setParsedAccounts([]);
    setSelectedAccounts(new Set());
    setCameraActive(false);
    setCameraError(null);
    setQrMode('camera');
    setUrProgress(0);
    urDecoderRef.current = null;
    bytesDecoderRef.current = null;
    if (selectedModel) {
      setLabel(`My ${selectedModel.name}`);
    }
  }, [selectedModel]);

  // Get available connection methods for selected device
  const getAvailableMethods = (): ConnectionMethod[] => {
    if (!selectedModel) return [];
    const methods: ConnectionMethod[] = [];

    // Add methods based on device connectivity, plus always allow manual
    selectedModel.connectivity.forEach(conn => {
      if (conn in connectivityConfig) {
        // Filter out USB if not in secure context (HTTPS required for WebUSB)
        if (conn === 'usb' && !isSecureContext()) {
          return;
        }
        // Filter out QR code camera scanning if not in secure context (camera requires HTTPS)
        if (conn === 'qr_code' && !isSecureContext()) {
          return;
        }
        methods.push(conn as ConnectionMethod);
      }
    });

    // Always allow manual entry as fallback
    methods.push('manual');

    return methods;
  };

  const handleScan = async () => {
    if (!selectedModel) return;

    setScanning(true);
    setError(null);

    try {
      // Determine device type from selected model
      const deviceType = getDeviceTypeFromModel(selectedModel);

      log.info('Connecting to device', {
        model: selectedModel.name,
        deviceType,
      });

      // Connect to the hardware wallet
      const device = await hardwareWalletService.connect(deviceType);

      if (!device || !device.connected) {
        throw new Error('Failed to connect to device');
      }

      // Get xpub from the device
      const xpubResult = await hardwareWalletService.getXpub(derivationPath);

      setFingerprint(xpubResult.fingerprint);
      setXpub(xpubResult.xpub);
      setScanned(true);

      log.info('Device connected successfully', {
        fingerprint: xpubResult.fingerprint,
        path: xpubResult.path,
        deviceType,
      });
    } catch (err) {
      log.error('Failed to connect to device', { error: err });
      const message = err instanceof Error ? err.message : 'Failed to connect to device';
      setError(message);
      setScanned(false);
    } finally {
      setScanning(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setError(null);

    // Read and parse the file
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;

      // Use the device parser registry to parse the file content
      // This handles JSON formats (Coldcard, Keystone, Ledger, BitBox, etc.)
      // as well as plain text formats (descriptors, xpubs)
      const result = parseDeviceJson(content);

      if (result && (result.xpub || result.fingerprint || result.accounts?.length)) {
        if (result.xpub) setXpub(result.xpub);
        if (result.fingerprint) setFingerprint(result.fingerprint);
        if (result.derivationPath) setDerivationPath(normalizeDerivationPath(result.derivationPath));
        if (result.label && !label) setLabel(result.label);

        // Handle multi-account import
        if (result.accounts && result.accounts.length > 0) {
          setParsedAccounts(result.accounts);
          // Auto-select all accounts
          setSelectedAccounts(new Set(result.accounts.map((_, i) => i)));
          log.info('File parsed with multiple accounts', {
            format: result.format,
            accountCount: result.accounts.length,
            purposes: result.accounts.map(a => a.purpose),
          });
        } else {
          setParsedAccounts([]);
          setSelectedAccounts(new Set());
        }

        log.info('File parsed successfully', { format: result.format, hasXpub: !!result.xpub, hasFingerprint: !!result.fingerprint });
        setScanned(true);
        setScanning(false);
      } else {
        setError('Could not parse file. Please check the format.');
        setScanning(false);
      }
    };
    reader.onerror = () => {
      setError('Failed to read file.');
      setScanning(false);
    };
    reader.readAsText(file);
  };

  /**
   * Extract fingerprint from CryptoHDKey with fallbacks
   */
  const extractFingerprintFromHdKey = (hdKey: CryptoHDKey): string => {
    // Try 1: Get from origin's source fingerprint (master fingerprint)
    const origin = hdKey.getOrigin();
    if (origin) {
      const sourceFingerprint = origin.getSourceFingerprint();
      if (sourceFingerprint && sourceFingerprint.length > 0) {
        return sourceFingerprint.toString('hex');
      }
    }

    // Try 2: Get parent fingerprint (not ideal, but better than nothing)
    // This is the fingerprint of the key one level up in derivation
    try {
      const parentFp = hdKey.getParentFingerprint();
      if (parentFp && parentFp.length > 0) {
        log.debug('Using parent fingerprint as fallback');
        return parentFp.toString('hex');
      }
    } catch {
      // getParentFingerprint might not exist or fail
    }

    return '';
  };

  /**
   * Try to extract xpub data from UR registry result
   */
  const extractFromUrResult = (registryType: any): { xpub: string; fingerprint: string; path: string } | null => {
    try {
      // Handle CryptoHDKey
      if (registryType instanceof CryptoHDKey) {
        const hdKey = registryType as CryptoHDKey;
        const xpub = hdKey.getBip32Key();
        const fingerprint = extractFingerprintFromHdKey(hdKey);
        const origin = hdKey.getOrigin();
        const pathComponents = origin?.getComponents() || [];
        const path = pathComponents.length > 0
          ? 'm/' + pathComponents.map((c: any) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
          : '';
        log.debug('Extracted from CryptoHDKey', { hasXpub: !!xpub, fingerprint, path });
        return { xpub, fingerprint, path };
      }

      // Handle CryptoOutput (output descriptor)
      if (registryType instanceof CryptoOutput) {
        const output = registryType as CryptoOutput;
        const hdKey = output.getHDKey();
        if (hdKey) {
          const xpub = hdKey.getBip32Key();
          const fingerprint = extractFingerprintFromHdKey(hdKey);
          const origin = hdKey.getOrigin();
          const pathComponents = origin?.getComponents() || [];
          const path = pathComponents.length > 0
            ? 'm/' + pathComponents.map((c: any) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
            : '';
          log.debug('Extracted from CryptoOutput', { hasXpub: !!xpub, fingerprint, path });
          return { xpub, fingerprint, path };
        }
      }

      // Handle CryptoAccount (multi-account format)
      if (registryType instanceof CryptoAccount) {
        const account = registryType as CryptoAccount;
        const masterFingerprint = account.getMasterFingerprint()?.toString('hex') || '';
        const outputs = account.getOutputDescriptors();

        // Find a suitable output (prefer native segwit BIP84)
        for (const output of outputs) {
          const hdKey = output.getHDKey();
          if (hdKey) {
            const xpub = hdKey.getBip32Key();
            const origin = hdKey.getOrigin();
            const pathComponents = origin?.getComponents() || [];
            const path = pathComponents.length > 0
              ? 'm/' + pathComponents.map((c: any) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
              : '';
            // Return the first valid one (or one with 84' in path for native segwit)
            if (path.includes("84'")) {
              return { xpub, fingerprint: masterFingerprint, path };
            }
          }
        }

        // Fall back to first output if no BIP84 found
        if (outputs.length > 0) {
          const hdKey = outputs[0].getHDKey();
          if (hdKey) {
            const xpub = hdKey.getBip32Key();
            const origin = hdKey.getOrigin();
            const pathComponents = origin?.getComponents() || [];
            const path = pathComponents.length > 0
              ? 'm/' + pathComponents.map((c: any) => `${c.getIndex()}${c.isHardened() ? "'" : ''}`).join('/')
              : '';
            return { xpub, fingerprint: masterFingerprint, path };
          }
        }
      }

      // Handle ur:bytes format (Foundation Passport Sparrow export, etc.)
      // The bytes may contain text/JSON wallet descriptor data
      if (registryType && registryType.bytes instanceof Uint8Array) {
        log.debug('Detected ur:bytes format, attempting to decode...');
        const bytes = registryType.bytes;

        // Try to decode as UTF-8 text (could be JSON or text descriptor)
        try {
          const textDecoder = new TextDecoder('utf-8');
          const textContent = textDecoder.decode(bytes);
          log.debug('Decoded bytes as text', { preview: textContent.substring(0, 200) });

          // Use the device parser registry to parse the content
          const result = parseDeviceJson(textContent);
          if (result && result.xpub) {
            log.debug('Extracted from ur:bytes', {
              format: result.format,
              xpubPreview: result.xpub.substring(0, 20) + '...',
              fingerprint: result.fingerprint || '',
              path: result.derivationPath || ''
            });
            return {
              xpub: result.xpub,
              fingerprint: result.fingerprint || '',
              path: result.derivationPath || ''
            };
          }
        } catch (decodeErr) {
          log.error('Failed to decode ur:bytes as text', { error: decodeErr });
        }
      }

      return null;
    } catch (err) {
      log.error('Failed to extract from UR result', { error: err });
      return null;
    }
  };

  /**
   * Extract xpub data from ur:bytes text content (Foundation Passport format)
   * The ur:bytes typically contains JSON with wallet descriptor information
   */
  const extractFromUrBytesContent = (textContent: string): { xpub: string; fingerprint: string; path: string } | null => {
    // Use the device parser registry to parse the text content
    const result = parseDeviceJson(textContent);

    if (result && result.xpub) {
      log.debug('Extracted from ur:bytes text', {
        format: result.format,
        xpubPreview: result.xpub.substring(0, 20) + '...',
        fingerprint: result.fingerprint || '',
        path: result.derivationPath || ''
      });
      return {
        xpub: result.xpub,
        fingerprint: result.fingerprint || '',
        path: result.derivationPath || ''
      };
    }

    return null;
  };

  /**
   * Handle QR code scan result
   * Parses various QR formats: UR format, ColdCard JSON, Keystone, plain xpub, descriptors
   */
  const handleQrScan = (result: { rawValue: string }[]) => {
    if (!result || result.length === 0) return;

    const content = result[0].rawValue;
    const contentLower = content.toLowerCase();

    log.info('QR code scanned', { length: content.length, prefix: content.substring(0, 50) });

    // Check if this is UR format (Foundation Passport, Keystone, etc.)
    if (contentLower.startsWith('ur:')) {
      // Extract UR type for debugging
      const urTypeMatch = contentLower.match(/^ur:([a-z0-9-]+)/);
      const urType = urTypeMatch ? urTypeMatch[1] : 'unknown';
      log.debug('UR type detected', { urType });

      try {
        // Use BytesURDecoder for ur:bytes (Foundation Passport format)
        // URRegistryDecoder doesn't properly handle raw bytes fountain codes
        if (urType === 'bytes') {
          // Initialize bytes decoder if needed
          if (!bytesDecoderRef.current) {
            log.debug('Creating new BytesURDecoder for ur:bytes');
            bytesDecoderRef.current = new BytesURDecoder();
          }

          // Feed the part to the decoder
          log.debug('Feeding part to bytes decoder...');
          const partReceived = bytesDecoderRef.current.receivePart(content);
          log.debug('Part received', { partReceived });

          // Check progress for multi-part QR codes
          const progress = bytesDecoderRef.current.estimatedPercentComplete();
          const progressPercent = Math.round(progress * 100);
          setUrProgress(progressPercent);

          // Get detailed decoder state for debugging
          const expectedCount = bytesDecoderRef.current.expectedPartCount();
          const receivedIndexes = bytesDecoderRef.current.receivedPartIndexes();
          const isComplete = bytesDecoderRef.current.isComplete() === true;
          const isError = bytesDecoderRef.current.isError();

          log.debug('UR bytes decoder state', {
            progress: progressPercent,
            expectedCount,
            receivedCount: receivedIndexes.length,
            isComplete,
            isError
          });

          if (isError) {
            log.error('Decoder error', { error: bytesDecoderRef.current.resultError() });
          }

          log.info('UR bytes progress', { progress: progressPercent, received: receivedIndexes.length, expected: expectedCount });

          // Check if complete (explicit boolean check since isComplete() can return undefined)
          if (!isComplete) {
            if (receivedIndexes.length > 0 && receivedIndexes.length < expectedCount) {
              log.debug('Waiting for more parts', { received: receivedIndexes.length, expected: expectedCount });
            }
            return;
          }

          // Decode is complete
          log.info('UR bytes decode complete');
          setCameraActive(false);
          setScanning(true);
          setError(null);

          if (!bytesDecoderRef.current.isSuccess()) {
            const errResult = bytesDecoderRef.current.resultError();
            log.error('UR bytes decode failed', { error: errResult });
            throw new Error(`UR bytes decode failed: ${errResult || 'unknown error'}`);
          }

          // Get the decoded UR and extract bytes
          const decodedUR = bytesDecoderRef.current.resultUR();
          log.debug('Decoded UR type', { type: decodedUR.type });

          // Decode CBOR to get raw bytes
          const rawBytes = decodedUR.decodeCBOR();
          log.debug('Raw bytes decoded', { length: rawBytes.length });

          // Try to decode as UTF-8 text (Foundation Passport exports JSON)
          const textDecoder = new TextDecoder('utf-8');
          const textContent = textDecoder.decode(rawBytes);
          log.debug('Decoded text from bytes', { preview: textContent.substring(0, 200) });

          // Parse as JSON and extract wallet data
          const extracted = extractFromUrBytesContent(textContent);
          log.debug('Extracted from ur:bytes', { hasXpub: !!extracted?.xpub, hasFingerprint: !!extracted?.fingerprint });

          if (extracted && extracted.xpub) {
            setXpub(extracted.xpub);
            if (extracted.fingerprint) setFingerprint(extracted.fingerprint.toUpperCase());
            if (extracted.path) setDerivationPath(normalizeDerivationPath(extracted.path));

            // Track which fields came from QR
            const extractedFields = {
              xpub: true,
              fingerprint: !!extracted.fingerprint,
              derivationPath: !!extracted.path,
              label: false,
            };
            setQrExtractedFields(extractedFields);

            // Generate warning for missing fields
            const warningMsg = generateMissingFieldsWarning({
              hasFingerprint: !!extracted.fingerprint,
              hasDerivationPath: !!extracted.path,
            });
            setWarning(warningMsg);

            setScanned(true);
            setScanning(false);
            setUrProgress(0);
            bytesDecoderRef.current = null;

            log.info('UR bytes QR code parsed successfully', extractedFields);
            return;
          }

          throw new Error('Could not extract xpub from ur:bytes content');
        }

        // For other UR types (crypto-hdkey, crypto-output, etc.), use URRegistryDecoder
        if (!urDecoderRef.current) {
          log.debug('Creating new URRegistryDecoder');
          urDecoderRef.current = new URRegistryDecoder();
        }

        // Feed the part to the decoder
        log.debug('Feeding part to decoder');
        urDecoderRef.current.receivePart(content);

        // Check progress for multi-part QR codes
        const progress = urDecoderRef.current.estimatedPercentComplete();
        const progressPercent = Math.round(progress * 100);
        setUrProgress(progressPercent);
        log.info('UR progress', { progress: progressPercent, isComplete: urDecoderRef.current.isComplete() });

        // Check if complete
        if (!urDecoderRef.current.isComplete()) {
          // Not complete yet - keep scanning for more parts
          log.debug('Waiting for more UR parts');
          return;
        }

        // Decode is complete
        log.info('UR decode complete');
        setCameraActive(false);
        setScanning(true);
        setError(null);

        if (!urDecoderRef.current.isSuccess()) {
          const errResult = urDecoderRef.current.resultError();
          log.error('UR decode failed', { error: errResult });
          throw new Error(`UR decode failed: ${errResult || 'unknown error'}`);
        }

        // Get the decoded registry type
        const registryType = urDecoderRef.current.resultRegistryType();
        log.info('UR decoded', { type: registryType?.constructor?.name });

        const extracted = extractFromUrResult(registryType);
        log.debug('Extracted from UR', { hasXpub: !!extracted?.xpub, hasFingerprint: !!extracted?.fingerprint });

        if (extracted && extracted.xpub) {
          setXpub(extracted.xpub);
          if (extracted.fingerprint) {
            setFingerprint(extracted.fingerprint.toUpperCase());
          }
          if (extracted.path) setDerivationPath(normalizeDerivationPath(extracted.path));

          // Track which fields came from QR
          const extractedFields = {
            xpub: true,
            fingerprint: !!extracted.fingerprint,
            derivationPath: !!extracted.path,
            label: false,
          };
          setQrExtractedFields(extractedFields);

          // Generate warning for missing fields
          const warningMsg = generateMissingFieldsWarning({
            hasFingerprint: !!extracted.fingerprint,
            hasDerivationPath: !!extracted.path,
          });
          setWarning(warningMsg);

          setScanned(true);
          setScanning(false);
          setUrProgress(0);
          urDecoderRef.current = null;

          log.info('UR QR code parsed successfully', {
            hasXpub: true,
            hasFingerprint: !!extracted.fingerprint,
            hasPath: !!extracted.path,
            fingerprint: extracted.fingerprint || '(not provided)',
          });
          return;
        }

        // Could not extract xpub from UR
        log.error('Could not extract xpub from registry type', {
          type: registryType?.constructor?.name,
          urType,
          registryTypeKeys: registryType ? Object.keys(registryType) : [],
        });
        throw new Error(`Could not extract xpub from UR type: ${registryType?.constructor?.name || urType}. The QR code format may not be supported.`);

      } catch (err) {
        log.error('Failed to decode UR QR code', { error: err, urType, contentPreview: content.substring(0, 100) });
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(`UR error (${urType}): ${errMsg}. Check console (F12) for details.`);
        setCameraActive(false);
        setScanning(false);
        setUrProgress(0);
        urDecoderRef.current = null;
        bytesDecoderRef.current = null;
        return;
      }
    }

    // Not UR format - use device parser registry
    setCameraActive(false);
    setScanning(true);
    setError(null);

    // Use the device parser registry to parse the QR content
    const parseResult = parseDeviceJson(content);

    if (parseResult && parseResult.xpub) {
      // Apply found values
      if (parseResult.fingerprint) setFingerprint(parseResult.fingerprint.toUpperCase());
      setXpub(parseResult.xpub);
      if (parseResult.derivationPath) setDerivationPath(normalizeDerivationPath(parseResult.derivationPath));
      if (parseResult.label && !label) setLabel(parseResult.label);

      // Handle multi-account import
      if (parseResult.accounts && parseResult.accounts.length > 0) {
        setParsedAccounts(parseResult.accounts);
        // Auto-select all accounts
        setSelectedAccounts(new Set(parseResult.accounts.map((_, i) => i)));
        log.info('QR parsed with multiple accounts', {
          format: parseResult.format,
          accountCount: parseResult.accounts.length,
          purposes: parseResult.accounts.map(a => a.purpose),
        });
      } else {
        setParsedAccounts([]);
        setSelectedAccounts(new Set());
      }

      // Track which fields came from QR
      const extractedFields = {
        xpub: true,
        fingerprint: !!parseResult.fingerprint,
        derivationPath: !!parseResult.derivationPath,
        label: !!parseResult.label,
      };
      setQrExtractedFields(extractedFields);

      // Generate warning for missing fields
      const warningMsg = generateMissingFieldsWarning({
        hasFingerprint: !!parseResult.fingerprint,
        hasDerivationPath: !!parseResult.derivationPath,
      });
      setWarning(warningMsg);

      setScanned(true);
      setScanning(false);

      log.info('QR code parsed successfully', { format: parseResult.format, ...extractedFields });
    } else {
      log.debug('No xpub found in non-UR content', { preview: content.substring(0, 200) });
      setError(`Could not find xpub in QR code. Content starts with: "${content.substring(0, 30)}...". Check browser console (F12) for details.`);
      setScanning(false);
    }
  };

  const handleCameraError = (error: unknown) => {
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
  };

  const handleSave = async () => {
    if (!selectedModel) return;

    setSaving(true);
    setError(null);

    try {
      // Build accounts array from selected parsed accounts
      const accounts: DeviceAccountInput[] = [];
      if (parsedAccounts.length > 0 && selectedAccounts.size > 0) {
        parsedAccounts.forEach((account, index) => {
          if (selectedAccounts.has(index)) {
            accounts.push({
              purpose: account.purpose,
              scriptType: account.scriptType,
              derivationPath: account.derivationPath,
              xpub: account.xpub,
            });
          }
        });
      }

      const deviceData: CreateDeviceRequest = {
        type: selectedModel.name,
        label: label || `${selectedModel.name} ${fingerprint}`,
        fingerprint: fingerprint || '00000000',
        // Use accounts array if available, otherwise fall back to single xpub
        ...(accounts.length > 0
          ? { accounts }
          : { xpub, derivationPath }
        ),
        modelSlug: selectedModel.slug
      };

      log.info('Saving device', {
        label: deviceData.label,
        fingerprint: deviceData.fingerprint,
        accountCount: accounts.length,
        hasLegacyXpub: !accounts.length && !!xpub,
      });

      await createDevice(deviceData);
      // Refresh sidebar to show new device
      refreshSidebar();
      navigate('/devices');
    } catch (err) {
      log.error('Failed to save device', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to save device. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Render device capability badges
  const renderCapabilities = (model: HardwareDeviceModel) => {
    const badges = [];

    if (model.airGapped) {
      badges.push(
        <span key="airgap" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          <Wifi className="w-3 h-3 mr-1 line-through" /> Air-Gapped
        </span>
      );
    }
    if (model.secureElement) {
      badges.push(
        <span key="secure" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          <Shield className="w-3 h-3 mr-1" /> Secure Element
        </span>
      );
    }
    if (model.openSource) {
      badges.push(
        <span key="opensource" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
          <Code className="w-3 h-3 mr-1" /> Open Source
        </span>
      );
    }
    if (model.supportsBitcoinOnly) {
      badges.push(
        <span key="btconly" className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          Bitcoin Only
        </span>
      );
    }

    return badges;
  };

  // Filter models by manufacturer and search query
  // Note: useMemo MUST be called before any conditional returns (React hooks rules)
  const filteredModels = useMemo(() => {
    let models = deviceModels;

    // Filter by manufacturer
    if (selectedManufacturer) {
      models = models.filter(m => m.manufacturer === selectedManufacturer);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      models = models.filter(m =>
        m.name.toLowerCase().includes(query) ||
        m.manufacturer.toLowerCase().includes(query)
      );
    }

    return models;
  }, [deviceModels, selectedManufacturer, searchQuery]);

  const availableMethods = getAvailableMethods();

  if (loadingModels) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-sanctuary-500" />
        <span className="ml-3 text-sanctuary-500">Loading device models...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-12">
      <button
        onClick={() => navigate('/devices')}
        className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Devices
      </button>

      <div>
        <h1 className="text-3xl font-light text-sanctuary-900 dark:text-sanctuary-50">Connect Hardware Device</h1>
        <p className="text-sanctuary-500">Add a new signing device to your sanctuary.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Step 1: Select Device Model */}
        <div className="lg:col-span-2 space-y-4">
          <div className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-sanctuary-500 uppercase">1. Select Your Device</h3>
              <span className="text-xs text-sanctuary-400">{filteredModels.length} devices</span>
            </div>

            {/* Search Bar */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search devices..."
                className="w-full pl-10 pr-10 py-2.5 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500 placeholder-sanctuary-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 rounded-full transition-colors"
                >
                  <X className="w-3 h-3 text-sanctuary-400" />
                </button>
              )}
            </div>

            {/* Manufacturer Filter */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setSelectedManufacturer(null)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  !selectedManufacturer
                    ? 'bg-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900'
                    : 'surface-secondary text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                }`}
              >
                All
              </button>
              {manufacturers.map(mfr => (
                <button
                  key={mfr}
                  onClick={() => setSelectedManufacturer(mfr)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    selectedManufacturer === mfr
                      ? 'bg-sanctuary-800 text-white dark:bg-sanctuary-200 dark:text-sanctuary-900'
                      : 'surface-secondary text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                  }`}
                >
                  {mfr}
                </button>
              ))}
            </div>

            {/* Device Grid - Increased height */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto pr-2 -mr-2">
              {filteredModels.length === 0 ? (
                <div className="col-span-full text-center py-8 text-sanctuary-400">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No devices match your search</p>
                  <button
                    onClick={() => { setSearchQuery(''); setSelectedManufacturer(null); }}
                    className="text-sm text-sanctuary-600 dark:text-sanctuary-300 hover:underline mt-2"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                filteredModels.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setSelectedModel(model)}
                    className={`p-3 rounded-xl border text-left text-sm transition-all flex flex-col items-center justify-center space-y-2 py-4 relative ${
                      selectedModel?.id === model.id
                        ? 'border-sanctuary-800 bg-sanctuary-50 dark:border-sanctuary-200 dark:bg-sanctuary-800 ring-1 ring-sanctuary-500'
                        : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400 dark:hover:border-sanctuary-500'
                    }`}
                  >
                    {!model.integrationTested && (
                      <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        Untested
                      </span>
                    )}
                    {getDeviceIcon(model.name, "w-8 h-8 opacity-80")}
                    <div className="font-medium text-center text-sanctuary-900 dark:text-sanctuary-100 text-xs">{model.name}</div>
                    <div className="text-[10px] text-sanctuary-500">{model.manufacturer}</div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Step 2: Connection Method (only show if device selected) */}
          {selectedModel && (
            <div className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 animate-fade-in">
              <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-4">2. Connection Method</h3>

              {/* Untested Device Warning */}
              {!selectedModel.integrationTested && (
                <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl">
                  <div className="flex items-start">
                    <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-2 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        Untested Device
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        This device has not been fully tested with Sanctuary. Basic functionality (xpub import via SD card, QR, or manual entry) should work, but you may encounter issues. Use at your own risk.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Device Capabilities Preview */}
              <div className="mb-4 p-3 surface-muted rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-3">
                    {getDeviceIcon(selectedModel.name, "w-6 h-6")}
                    <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">{selectedModel.name}</span>
                  </div>
                  <div className="flex space-x-1">
                    {selectedModel.connectivity.map(conn => {
                      const config = connectivityConfig[conn];
                      if (!config) return null;
                      const Icon = config.icon;
                      return (
                        <span key={conn} className="p-1.5 bg-sanctuary-200 dark:bg-sanctuary-800 rounded" title={config.label}>
                          <Icon className="w-3.5 h-3.5 text-sanctuary-600 dark:text-sanctuary-400" />
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {renderCapabilities(selectedModel)}
                </div>
              </div>

              {/* Connection Method Selection */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {availableMethods.map((m) => {
                  const config = m === 'manual'
                    ? { icon: PenTool, label: 'Manual Entry', description: 'Enter xpub manually' }
                    : connectivityConfig[m];
                  if (!config) return null;
                  const Icon = config.icon;

                  return (
                    <button
                      key={m}
                      onClick={() => { setMethod(m); setScanned(false); setError(null); setWarning(null); setQrExtractedFields(null); }}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        method === m
                          ? 'border-sanctuary-800 bg-sanctuary-50 dark:border-sanctuary-200 dark:bg-sanctuary-800 ring-1 ring-sanctuary-500'
                          : 'border-sanctuary-200 dark:border-sanctuary-700 hover:border-sanctuary-400'
                      }`}
                    >
                      <Icon className="w-5 h-5 mb-2 text-sanctuary-600 dark:text-sanctuary-400" />
                      <div className="font-medium text-sm text-sanctuary-900 dark:text-sanctuary-100">{config.label}</div>
                      <div className="text-xs text-sanctuary-500">{config.description}</div>
                    </button>
                  );
                })}
              </div>

              {/* Connection Action Area */}
              {method && (
                <div className="mt-4">
                  {method === 'usb' && (
                    <div className="text-center py-6 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                      {!scanning && !scanned && !error && (
                        <>
                          <div className="mx-auto text-sanctuary-400 mb-3 flex justify-center">
                            {getDeviceIcon(selectedModel.name, "w-12 h-12")}
                          </div>
                          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-2">
                            Connect your {selectedModel.name} via USB and unlock it.
                          </p>
                          {getDeviceTypeFromModel(selectedModel) === 'trezor' ? (
                            <p className="text-xs text-sanctuary-400 mb-4">
                              Requires <span className="font-medium">Trezor Suite</span> desktop app to be running.
                            </p>
                          ) : (
                            <p className="text-xs text-sanctuary-400 mb-4">
                              Make sure the Bitcoin app is open on your device.
                            </p>
                          )}
                          <Button onClick={handleScan}>
                            Connect Device
                          </Button>
                        </>
                      )}
                      {!scanning && !scanned && error && (
                        <>
                          <div className="mx-auto text-rose-400 mb-3 flex justify-center">
                            <AlertCircle className="w-12 h-12" />
                          </div>
                          <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
                            {error}
                          </p>
                          <Button onClick={handleScan}>
                            Try Again
                          </Button>
                        </>
                      )}
                      {scanning && (
                        <div className="flex flex-col items-center">
                          <Loader2 className="w-8 h-8 animate-spin text-sanctuary-600 dark:text-sanctuary-400 mb-3" />
                          <p className="text-sm text-sanctuary-500">Connecting to device...</p>
                          <p className="text-xs text-sanctuary-400 mt-1">Please confirm on your device if prompted.</p>
                        </div>
                      )}
                      {scanned && !error && (
                        <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
                          <Check className="w-10 h-10 mb-2" />
                          <p className="font-medium">Device Connected</p>
                          <p className="text-xs text-sanctuary-500 mt-1">Fingerprint: {fingerprint}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {method === 'sd_card' && (
                    <div className="text-center py-6 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                      {!scanning && !scanned && (
                        <>
                          <FileJson className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
                          <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
                            Upload the export file from your {selectedModel.name} SD card.
                          </p>
                          <label className="cursor-pointer">
                            <span className="inline-flex items-center justify-center rounded-lg px-4 py-2 bg-sanctuary-800 text-sanctuary-50 text-sm font-medium hover:bg-sanctuary-700 transition-colors">
                              Select File
                            </span>
                            <input
                              type="file"
                              className="hidden"
                              accept=".json,.txt"
                              onChange={handleFileUpload}
                            />
                          </label>
                        </>
                      )}
                      {scanning && (
                        <div className="flex flex-col items-center">
                          <Loader2 className="w-8 h-8 animate-spin text-sanctuary-600 dark:text-sanctuary-400 mb-3" />
                          <p className="text-sm text-sanctuary-500">Parsing file...</p>
                        </div>
                      )}
                      {scanned && (
                        <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
                          <Check className="w-10 h-10 mb-2" />
                          <p className="font-medium">File Imported Successfully</p>
                        </div>
                      )}
                    </div>
                  )}

                  {method === 'qr_code' && (
                    <div className="space-y-3">
                      {/* QR Mode Toggle */}
                      <div className="flex justify-center gap-2">
                        <button
                          onClick={() => { setQrMode('camera'); setCameraError(null); }}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                            qrMode === 'camera'
                              ? 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900'
                              : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                          }`}
                        >
                          <Camera className="w-4 h-4" />
                          Scan with Camera
                        </button>
                        <button
                          onClick={() => { setQrMode('file'); setCameraActive(false); }}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                            qrMode === 'file'
                              ? 'bg-sanctuary-800 text-sanctuary-50 dark:bg-sanctuary-200 dark:text-sanctuary-900'
                              : 'bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400 hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700'
                          }`}
                        >
                          <Upload className="w-4 h-4" />
                          Upload File
                        </button>
                      </div>

                      {/* Camera Scanner */}
                      {qrMode === 'camera' && !scanned && (
                        <div className="surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700 overflow-hidden">
                          {!cameraActive && !cameraError && (
                            <div className="text-center py-8">
                              <Camera className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
                              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
                                Point your camera at the QR code on your {selectedModel.name}.
                              </p>
                              {!isSecureContext() && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 px-4">
                                  Camera access requires HTTPS. Please use https://localhost:8443
                                </p>
                              )}
                              <Button onClick={() => { setCameraActive(true); setCameraError(null); }}>
                                Start Camera
                              </Button>
                            </div>
                          )}
                          {cameraActive && (
                            <div className="relative">
                              <div className="aspect-square max-w-sm mx-auto">
                                <Scanner
                                  onScan={handleQrScan}
                                  onError={handleCameraError}
                                  constraints={{ facingMode: 'environment' }}
                                  scanDelay={100}
                                  styles={{
                                    container: { width: '100%', height: '100%' },
                                    video: { width: '100%', height: '100%', objectFit: 'cover' },
                                  }}
                                />
                              </div>
                              <button
                                onClick={() => { setCameraActive(false); setUrProgress(0); urDecoderRef.current = null; bytesDecoderRef.current = null; }}
                                className="absolute top-2 right-2 p-2 bg-black/50 rounded-full text-white hover:bg-black/70 transition-colors z-10"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              {/* Progress overlay for animated QR codes */}
                              {urProgress > 0 && urProgress < 100 && (
                                <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm p-3 z-10">
                                  <div className="flex items-center justify-between text-white mb-2">
                                    <span className="flex items-center text-sm font-medium">
                                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                      Scanning animated QR...
                                    </span>
                                    <span className="text-lg font-bold">{urProgress}%</span>
                                  </div>
                                  <div className="w-full bg-white/20 rounded-full h-2">
                                    <div
                                      className="bg-green-400 h-2 rounded-full transition-all duration-300"
                                      style={{ width: `${urProgress}%` }}
                                    />
                                  </div>
                                  <p className="text-xs text-center text-white/70 mt-2">
                                    Keep camera pointed at animated QR code
                                  </p>
                                </div>
                              )}
                              {urProgress === 0 && (
                                <p className="text-xs text-center text-sanctuary-500 py-2">
                                  Position the QR code within the frame
                                </p>
                              )}
                            </div>
                          )}
                          {cameraError && (
                            <div className="text-center py-8">
                              <AlertCircle className="w-12 h-12 mx-auto text-rose-400 mb-3" />
                              <p className="text-sm text-rose-600 dark:text-rose-400 mb-4 px-4">
                                {cameraError}
                              </p>
                              <Button onClick={() => { setCameraActive(true); setCameraError(null); }}>
                                Try Again
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* File Upload (alternative) */}
                      {qrMode === 'file' && !scanned && (
                        <div className="text-center py-6 surface-muted rounded-xl border border-dashed border-sanctuary-300 dark:border-sanctuary-700">
                          {!scanning && (
                            <>
                              <FileJson className="w-12 h-12 mx-auto text-sanctuary-400 mb-3" />
                              <p className="text-sm text-sanctuary-600 dark:text-sanctuary-300 mb-4 px-4">
                                Upload a file containing your QR code data (JSON or text export).
                              </p>
                              <label className="cursor-pointer">
                                <span className="inline-flex items-center justify-center rounded-lg px-4 py-2 bg-sanctuary-800 text-sanctuary-50 text-sm font-medium hover:bg-sanctuary-700 transition-colors">
                                  Select File
                                </span>
                                <input
                                  type="file"
                                  className="hidden"
                                  accept=".json,.txt"
                                  onChange={handleFileUpload}
                                />
                              </label>
                            </>
                          )}
                          {scanning && (
                            <div className="flex flex-col items-center">
                              <Loader2 className="w-8 h-8 animate-spin text-sanctuary-600 dark:text-sanctuary-400 mb-3" />
                              <p className="text-sm text-sanctuary-500">Parsing file...</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Success state */}
                      {scanned && (
                        <div className="text-center py-6 surface-muted rounded-xl border border-sanctuary-300 dark:border-sanctuary-700">
                          <div className="flex flex-col items-center text-emerald-600 dark:text-emerald-400">
                            <Check className="w-10 h-10 mb-2" />
                            <p className="font-medium">QR Code Scanned Successfully</p>
                            <p className="text-xs text-sanctuary-500 mt-1">Fingerprint: {fingerprint || 'Not provided'}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {method === 'manual' && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl flex items-start">
                      <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-3 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800 dark:text-amber-200">
                        Manually entering xpubs is for advanced users. Ensure you copy the correct Extended Public Key
                        corresponding to the derivation path. The fingerprint should match your device's master fingerprint.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 3: Device Details & Save (Right Column) */}
        <div className="space-y-4">
          <div className="surface-elevated p-6 rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 sticky top-4">
            <h3 className="text-sm font-medium text-sanctuary-500 uppercase mb-4">3. Device Details</h3>

            {!selectedModel ? (
              <div className="text-center py-8 text-sanctuary-400">
                <Lock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Select a device to continue</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-sanctuary-500 mb-1">Device Label</label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={`My ${selectedModel.name}`}
                    className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-sanctuary-500 mb-1">Master Fingerprint</label>
                  <input
                    type="text"
                    value={fingerprint}
                    onChange={(e) => setFingerprint(e.target.value)}
                    placeholder="00000000"
                    readOnly={method !== 'manual' && scanned}
                    className={`w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500 ${method !== 'manual' && scanned ? 'opacity-70' : ''}`}
                  />
                </div>

                {/* Multi-account display when accounts are parsed from file/QR */}
                {parsedAccounts.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-xs font-medium text-sanctuary-500">Accounts to Import</label>
                      <span className="text-[10px] text-sanctuary-400">
                        {selectedAccounts.size} of {parsedAccounts.length} selected
                      </span>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {parsedAccounts.map((account, index) => {
                        const isSelected = selectedAccounts.has(index);
                        const purposeLabel = account.purpose === 'multisig' ? 'Multisig' : 'Single-sig';
                        const scriptLabel = {
                          native_segwit: 'Native SegWit',
                          nested_segwit: 'Nested SegWit',
                          taproot: 'Taproot',
                          legacy: 'Legacy',
                        }[account.scriptType];

                        return (
                          <label
                            key={index}
                            className={`block p-3 rounded-lg border cursor-pointer transition-all ${
                              isSelected
                                ? 'border-sanctuary-500 bg-sanctuary-100 dark:bg-sanctuary-800'
                                : 'border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-900 hover:border-sanctuary-300 dark:hover:border-sanctuary-600'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  const newSelected = new Set(selectedAccounts);
                                  if (isSelected) {
                                    newSelected.delete(index);
                                  } else {
                                    newSelected.add(index);
                                  }
                                  setSelectedAccounts(newSelected);
                                }}
                                className="mt-1 rounded border-sanctuary-300 text-sanctuary-600 focus:ring-sanctuary-500"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    account.purpose === 'multisig'
                                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                  }`}>
                                    {purposeLabel}
                                  </span>
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sanctuary-100 text-sanctuary-600 dark:bg-sanctuary-800 dark:text-sanctuary-400">
                                    {scriptLabel}
                                  </span>
                                </div>
                                <div className="text-xs font-mono text-sanctuary-600 dark:text-sanctuary-300 truncate">
                                  {account.derivationPath}
                                </div>
                                <div className="text-[10px] font-mono text-sanctuary-400 truncate mt-0.5" title={account.xpub}>
                                  {account.xpub.substring(0, 20)}...{account.xpub.substring(account.xpub.length - 8)}
                                </div>
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-sanctuary-400 mt-2">
                      All accounts will be registered with this device for use in wallets.
                    </p>
                  </div>
                ) : (
                  /* Single account mode (manual entry or legacy imports) */
                  <>
                    <div>
                      <label className="block text-xs font-medium text-sanctuary-500 mb-1">Derivation Path</label>
                      <input
                        type="text"
                        value={derivationPath}
                        onChange={(e) => setDerivationPath(e.target.value)}
                        className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500"
                      />
                      <p className="text-[10px] text-sanctuary-400 mt-1">BIP84 Native SegWit default</p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-sanctuary-500 mb-1">Extended Public Key</label>
                      <textarea
                        value={xpub}
                        onChange={(e) => setXpub(e.target.value)}
                        placeholder="xpub... / ypub... / zpub..."
                        readOnly={method !== 'manual' && scanned}
                        rows={3}
                        className={`w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sanctuary-500 resize-none ${method !== 'manual' && scanned ? 'opacity-70' : ''}`}
                      />
                    </div>
                  </>
                )}

                <div className="pt-4 border-t border-sanctuary-100 dark:border-sanctuary-800">
                  <Button
                    onClick={handleSave}
                    className="w-full"
                    disabled={!fingerprint || (parsedAccounts.length > 0 ? selectedAccounts.size === 0 : !xpub) || saving || !method}
                  >
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        Save Device
                        <ChevronRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>

                  {error && (
                    <p className="text-center text-xs text-rose-600 dark:text-rose-400 mt-2">
                      {error}
                    </p>
                  )}

                  {/* Collapsible QR import details - shown whenever we have QR extracted data */}
                  {qrExtractedFields && scanned && (
                    <div className="mt-3">
                      {/* Always-visible warning when fields are missing */}
                      {warning && (
                        <div className="mb-2 p-2 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-warning-700 dark:text-warning-300">
                              {warning}
                            </p>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => setShowQrDetails(!showQrDetails)}
                        className="flex items-center gap-1 text-xs text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
                      >
                        <Info className="w-3 h-3" />
                        <span>QR Import Details</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${showQrDetails ? 'rotate-180' : ''}`} />
                      </button>
                      {showQrDetails && (
                        <div className="mt-2 p-3 rounded-lg bg-sanctuary-50 dark:bg-sanctuary-800/50 border border-sanctuary-200 dark:border-sanctuary-700 text-xs">
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-sanctuary-600 dark:text-sanctuary-400">Extended Public Key</span>
                              {qrExtractedFields.xpub ? (
                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                  <Check className="w-3 h-3" /> From QR
                                </span>
                              ) : (
                                <span className="text-sanctuary-400">Manual</span>
                              )}
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sanctuary-600 dark:text-sanctuary-400">Master Fingerprint</span>
                              {qrExtractedFields.fingerprint ? (
                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                  <Check className="w-3 h-3" /> From QR
                                </span>
                              ) : (
                                <span className="text-warning-600 dark:text-warning-400">Not in QR</span>
                              )}
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sanctuary-600 dark:text-sanctuary-400">Derivation Path</span>
                              {qrExtractedFields.derivationPath ? (
                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                  <Check className="w-3 h-3" /> From QR
                                </span>
                              ) : (
                                <span className="text-warning-600 dark:text-warning-400">Using default</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(!fingerprint || (parsedAccounts.length > 0 ? selectedAccounts.size === 0 : !xpub)) && !error && method && (
                    <p className="text-center text-xs text-sanctuary-400 mt-2">
                      {parsedAccounts.length > 0 && selectedAccounts.size === 0
                        ? 'Select at least one account to import.'
                        : method === 'manual'
                          ? 'Enter fingerprint and xpub to save.'
                          : 'Complete the connection step to enable saving.'
                      }
                    </p>
                  )}

                  {!method && (
                    <p className="text-center text-xs text-sanctuary-400 mt-2">
                      Select a connection method to continue.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
