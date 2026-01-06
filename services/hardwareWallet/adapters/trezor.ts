/**
 * Trezor Hardware Wallet Adapter
 *
 * Implements DeviceAdapter interface for Trezor devices via Trezor Connect.
 * Supports Model One, Model T, Safe 3, Safe 5, and Safe 7.
 * Requires Trezor Suite desktop app to be running.
 */

import TrezorConnect from '@trezor/connect-web';
import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';
import apiClient from '../../../src/api/client';
import { createLogger } from '../../../utils/logger';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  XpubResult,
} from '../types';

const log = createLogger('TrezorAdapter');

/**
 * Validate and format a satoshi amount for Trezor
 * Handles both number and BigInt types, validates range
 * @internal Exported for testing
 */
export function validateSatoshiAmount(amount: number | bigint | undefined, context: string): string {
  if (amount === undefined || amount === null) {
    throw new Error(`${context}: amount is missing`);
  }
  // Handle both number and BigInt types
  const amountNum = typeof amount === 'bigint' ? Number(amount) : amount;
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    throw new Error(`${context}: invalid amount ${amount}`);
  }
  return amount.toString();
}

// Standard BIP-32 xpub version bytes
const XPUB_VERSION = Buffer.from([0x04, 0x88, 0xb2, 0x1e]); // mainnet xpub
const TPUB_VERSION = Buffer.from([0x04, 0x35, 0x87, 0xcf]); // testnet tpub

// SLIP-132 extended public key version bytes (for detection)
// These are non-standard prefixes used by some wallets for script-type encoding
const SLIP132_VERSIONS: Record<string, { isTestnet: boolean }> = {
  // Mainnet P2WSH (native segwit multisig) - Zpub
  '02aa7ed3': { isTestnet: false },
  // Mainnet P2WPKH (native segwit) - zpub
  '04b24746': { isTestnet: false },
  // Mainnet P2SH-P2WPKH (nested segwit) - ypub
  '049d7cb2': { isTestnet: false },
  // Mainnet P2SH-P2WSH (nested segwit multisig) - Ypub
  '0295b43f': { isTestnet: false },
  // Testnet P2WSH - Vpub
  '02575483': { isTestnet: true },
  // Testnet P2WPKH - vpub
  '045f1cf6': { isTestnet: true },
  // Testnet P2SH-P2WPKH - upub
  '044a5262': { isTestnet: true },
  // Testnet P2SH-P2WSH - Upub
  '024289ef': { isTestnet: true },
};

/**
 * Convert SLIP-132 formatted extended public keys (Zpub, ypub, etc.) to standard xpub/tpub format.
 * Trezor only accepts standard BIP-32 xpub format, not SLIP-132 script-type specific formats.
 * @internal Exported for testing
 */
export function convertToStandardXpub(extendedPubKey: string): string {
  // If already standard xpub/tpub format, return as-is
  if (extendedPubKey.startsWith('xpub') || extendedPubKey.startsWith('tpub')) {
    return extendedPubKey;
  }

  try {
    // Decode base58check
    const data = bs58check.decode(extendedPubKey);

    // First 4 bytes are version
    const versionHex = data.slice(0, 4).toString('hex');
    const slip132Info = SLIP132_VERSIONS[versionHex];

    if (slip132Info) {
      // Replace version bytes with standard xpub/tpub version
      const newVersion = slip132Info.isTestnet ? TPUB_VERSION : XPUB_VERSION;
      const newData = Buffer.concat([newVersion, data.slice(4)]);
      const converted = bs58check.encode(newData);

      log.info('Converted SLIP-132 xpub to standard format', {
        original: extendedPubKey.substring(0, 10) + '...',
        converted: converted.substring(0, 10) + '...',
        versionHex,
        isTestnet: slip132Info.isTestnet,
      });

      return converted;
    }

    // Unknown version, return as-is (might be standard xpub with different prefix)
    log.debug('Unknown xpub version, returning as-is', { versionHex, prefix: extendedPubKey.substring(0, 4) });
    return extendedPubKey;
  } catch (error) {
    log.warn('Failed to convert xpub format, returning as-is', { error, prefix: extendedPubKey.substring(0, 4) });
    return extendedPubKey;
  }
}

// Connection state
interface TrezorConnection {
  initialized: boolean;
  connected: boolean;
  deviceId?: string;
  fingerprint?: string;
  model?: string;
  label?: string;
}

/**
 * Determine Trezor script type from BIP path
 * @internal Exported for testing
 */
export const getTrezorScriptType = (path: string): 'SPENDADDRESS' | 'SPENDP2SHWITNESS' | 'SPENDWITNESS' | 'SPENDTAPROOT' => {
  // Check for both apostrophe (') and h notation for hardened paths
  if (path.startsWith("m/44'") || path.startsWith("44'") ||
      path.startsWith("m/44h") || path.startsWith("44h")) {
    return 'SPENDADDRESS';
  }
  if (path.startsWith("m/49'") || path.startsWith("49'") ||
      path.startsWith("m/49h") || path.startsWith("49h")) {
    return 'SPENDP2SHWITNESS';
  }
  if (path.startsWith("m/84'") || path.startsWith("84'") ||
      path.startsWith("m/84h") || path.startsWith("84h")) {
    return 'SPENDWITNESS';
  }
  if (path.startsWith("m/86'") || path.startsWith("86'") ||
      path.startsWith("m/86h") || path.startsWith("86h")) {
    return 'SPENDTAPROOT';
  }
  // BIP-48 multisig paths
  if (path.startsWith("m/48'") || path.startsWith("48'") ||
      path.startsWith("m/48h") || path.startsWith("48h")) {
    // Check script type suffix: /1' or /1h = P2SH-P2WSH, /2' or /2h = P2WSH
    if (path.includes("/2'") || path.includes("/2h")) {
      return 'SPENDWITNESS'; // Native SegWit multisig (P2WSH)
    }
    return 'SPENDP2SHWITNESS'; // Nested SegWit multisig (P2SH-P2WSH)
  }
  return 'SPENDWITNESS';
};

/**
 * Check if a path is a BIP-48 multisig path.
 * BIP-48 paths (m/48'/...) are used for multisig wallets and are considered
 * "non-standard" by Trezor's safety checks.
 *
 * NOTE: TrezorConnect.unlockPath() does NOT work for BIP-48 paths - it was designed
 * for SLIP-26 (Cardano-style) derivation. BIP-48 multisig paths are validated through
 * the multisig structure provided in inputs/outputs, not through unlockPath.
 *
 * To sign with BIP-48 paths, users need to set Safety Checks to "Prompt" in Trezor Suite.
 * @internal Exported for testing
 */
export const isBip48MultisigPath = (path: string): boolean => {
  // Check for both apostrophe notation (') and h notation
  return path.startsWith("m/48'") || path.startsWith("48'") ||
         path.startsWith("m/48h") || path.startsWith("48h");
};

/**
 * Extract the account-level path prefix for unlocking
 * e.g., "m/48'/0'/0'/2'/0/5" -> "m/48'/0'/0'/2'"
 * @internal Exported for testing
 */
export const getAccountPathPrefix = (path: string): string => {
  const parts = path.replace(/^m\//, '').split('/');
  // For BIP-48, the account path is the first 4 segments: purpose'/coin'/account'/script'
  const accountParts = parts.slice(0, 4);
  return 'm/' + accountParts.join('/');
};

/**
 * Convert path string to Trezor address_n array
 */
const pathToAddressN = (path: string): number[] => {
  return path
    .replace(/^m\//, '')
    .split('/')
    .map(part => {
      const hardened = part.endsWith("'") || part.endsWith('h');
      const index = parseInt(part.replace(/['h]/g, ''), 10);
      return hardened ? index + 0x80000000 : index;
    });
};

/**
 * Trezor multisig pubkey structure
 */
interface TrezorMultisigPubkey {
  node: string;     // Hex-encoded pubkey
  address_n: number[]; // Child derivation path (change, index)
}

/**
 * Trezor multisig structure for inputs/outputs
 */
interface TrezorMultisig {
  pubkeys: TrezorMultisigPubkey[];
  signatures: string[];  // Empty strings for unsigned, hex for signed
  m: number;            // Required signatures (quorum)
}

/**
 * Build Trezor multisig structure from PSBT input data.
 * This is required for Trezor to properly validate and sign multisig transactions.
 *
 * @param witnessScript The witness script from the PSBT input
 * @param bip32Derivations Array of bip32 derivation info from the PSBT
 * @param xpubMap Optional map of fingerprint (lowercase hex) to xpub string for multisig
 * @internal Exported for testing
 */
export function buildTrezorMultisig(
  witnessScript: Buffer | undefined,
  bip32Derivations: Array<{ pubkey: Buffer; path: string; masterFingerprint: Buffer }>,
  xpubMap?: Record<string, string>
): TrezorMultisig | undefined {
  if (!witnessScript || witnessScript.length === 0) {
    return undefined;
  }

  // Log xpubMap for debugging - show fingerprint comparison to diagnose mismatch
  const psbtFingerprints = bip32Derivations.map(d => d.masterFingerprint.toString('hex').toLowerCase());
  const xpubFingerprints = xpubMap ? Object.keys(xpubMap) : [];
  const matchingFingerprints = psbtFingerprints.filter(fp => xpubFingerprints.includes(fp));
  const missingInXpubMap = psbtFingerprints.filter(fp => !xpubFingerprints.includes(fp));

  log.info('buildTrezorMultisig called', {
    hasXpubMap: !!xpubMap,
    xpubMapFingerprints: xpubFingerprints,
    psbtFingerprints: psbtFingerprints,
    matchingFingerprints: matchingFingerprints,
    missingInXpubMap: missingInXpubMap,
    allMatch: missingInXpubMap.length === 0,
  });

  try {
    // Parse m-of-n from witnessScript
    // Format: OP_M <pubkey1> <pubkey2> ... OP_N OP_CHECKMULTISIG
    // OP_1 through OP_16 are 0x51 through 0x60
    const firstByte = witnessScript[0];
    const lastBeforeOpMulti = witnessScript[witnessScript.length - 2];

    const m = firstByte - 0x50;
    const n = lastBeforeOpMulti - 0x50;

    // Validate m and n are reasonable
    if (m < 1 || m > 16 || n < 1 || n > 16 || m > n) {
      return undefined;
    }

    // Sort derivations by pubkey to match sortedmulti order
    const sortedDerivations = [...bip32Derivations].sort((a, b) =>
      Buffer.compare(a.pubkey, b.pubkey)
    );

    // Build pubkeys array
    const pubkeys: TrezorMultisigPubkey[] = sortedDerivations.map(deriv => {
      // Extract child path (last 2 components: change/index)
      const pathParts = deriv.path.replace(/^m\//, '').split('/');
      const childPath = pathParts.slice(-2).map(p => {
        const hardened = p.endsWith("'") || p.endsWith('h');
        const index = parseInt(p.replace(/['h]/g, ''), 10);
        return hardened ? index + 0x80000000 : index;
      });

      // Try to find xpub by fingerprint - Trezor requires xpub (base58) for multisig, not raw pubkey
      const fingerprint = deriv.masterFingerprint.toString('hex').toLowerCase();
      const rawXpub = xpubMap?.[fingerprint];

      if (rawXpub) {
        // Trezor only accepts standard xpub/tpub format, not SLIP-132 variants (Zpub, ypub, etc.)
        // Convert any non-standard format to standard xpub
        const xpub = convertToStandardXpub(rawXpub);
        log.debug('Using xpub for multisig node', { fingerprint, rawXpubPrefix: rawXpub.substring(0, 15), xpubPrefix: xpub.substring(0, 15) });
        return {
          node: xpub,
          address_n: childPath,
        };
      }

      // Fallback to raw pubkey (will fail for Trezor but kept for compatibility)
      log.warn('No xpub found for fingerprint, using raw pubkey (may fail)', { fingerprint });
      return {
        node: deriv.pubkey.toString('hex'),
        address_n: childPath,
      };
    });

    // Initialize empty signatures array
    const signatures = sortedDerivations.map(() => '');

    return { pubkeys, signatures, m };
  } catch (error) {
    log.warn('Failed to parse multisig structure from witnessScript', { error });
    return undefined;
  }
}

/**
 * Check if PSBT input is a multisig input
 */
function isMultisigInput(input: any): boolean {
  return !!(
    input.witnessScript ||
    input.redeemScript ||
    (input.bip32Derivation && input.bip32Derivation.length > 1)
  );
}

/**
 * Fetch reference transactions needed for Trezor signing
 */
const fetchRefTxs = async (psbt: bitcoin.Psbt): Promise<any[]> => {
  const refTxs: any[] = [];
  const seenTxids = new Set<string>();

  for (const input of psbt.data.inputs) {
    const txInput = psbt.txInputs[psbt.data.inputs.indexOf(input)];
    const txid = Buffer.from(txInput.hash).reverse().toString('hex');

    if (seenTxids.has(txid)) continue;
    seenTxids.add(txid);

    try {
      const response = await apiClient.get<{ hex: string }>(`/transactions/${txid}/raw`);
      const rawTx = bitcoin.Transaction.fromHex(response.hex);

      const refTx = {
        hash: txid,
        version: rawTx.version,
        lock_time: rawTx.locktime,
        inputs: rawTx.ins.map(input => ({
          prev_hash: Buffer.from(input.hash).reverse().toString('hex'),
          prev_index: input.index,
          script_sig: input.script.toString('hex'),
          sequence: input.sequence,
        })),
        bin_outputs: rawTx.outs.map(output => ({
          amount: output.value,
          script_pubkey: output.script.toString('hex'),
        })),
      };

      refTxs.push(refTx);
    } catch (error) {
      log.warn('Failed to fetch reference transaction', { txid, error });
    }
  }

  return refTxs;
};

/**
 * Trezor Device Adapter
 */
export class TrezorAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'trezor';
  readonly displayName = 'Trezor';

  private connection: TrezorConnection = {
    initialized: false,
    connected: false,
  };
  private connectedDevice: HardwareWalletDevice | null = null;

  /**
   * Check if Trezor is supported in current environment.
   * Requires HTTPS for secure context (WebUSB requirement).
   */
  isSupported(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection.connected;
  }

  /**
   * Get connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  /**
   * Initialize Trezor Connect
   */
  private async initialize(): Promise<void> {
    if (this.connection.initialized) {
      return;
    }

    try {
      await TrezorConnect.init({
        manifest: {
          email: 'support@sanctuary.bitcoin',
          appUrl: window.location.origin || 'https://sanctuary.bitcoin',
          appName: 'Sanctuary',
        },
        coreMode: 'auto',
        debug: true,
        lazyLoad: false,
      });

      this.connection.initialized = true;
      log.info('Trezor Connect initialized');
    } catch (error) {
      log.error('Failed to initialize Trezor Connect', { error });
      throw new Error('Failed to initialize Trezor. Please ensure Trezor Suite is running.');
    }
  }

  /**
   * Connect to a Trezor device
   */
  async connect(): Promise<HardwareWalletDevice> {
    if (!this.connection.initialized) {
      await this.initialize();
    }

    try {
      log.info('Requesting Trezor device features...');

      const result = await TrezorConnect.getFeatures();

      if (!result.success) {
        const errorPayload = result.payload as { error?: string; code?: string };
        log.error('Trezor getFeatures failed', { payload: errorPayload });
        throw new Error(errorPayload.error || 'Failed to connect to Trezor');
      }

      const features = result.payload;

      // Get master fingerprint
      let fingerprint: string | undefined;
      try {
        const fpResult = await TrezorConnect.getPublicKey({
          path: "m/0'",
          showOnTrezor: false,
        });
        if (fpResult.success) {
          const rawFp = fpResult.payload.fingerprint;
          // Handle unsigned 32-bit conversion (fingerprint can be > 2^31)
          const unsignedFp = rawFp !== undefined ? (rawFp >>> 0) : undefined;
          fingerprint = unsignedFp?.toString(16).padStart(8, '0');
          log.info('Trezor fingerprint obtained', {
            rawFingerprint: rawFp,
            unsignedFingerprint: unsignedFp,
            hexFingerprint: fingerprint,
            xpubPrefix: fpResult.payload.xpub?.substring(0, 20),
          });
        }
      } catch (fpError) {
        log.warn('Could not get fingerprint from Trezor', { error: fpError });
      }

      // Determine model name
      let modelName = 'Trezor';
      if (features.model === 'T') {
        modelName = 'Trezor Model T';
      } else if (features.model === '1') {
        modelName = 'Trezor Model One';
      } else if (features.internal_model === 'T2B1') {
        modelName = 'Trezor Safe 3';
      } else if (features.internal_model === 'T3T1') {
        modelName = 'Trezor Safe 5';
      } else if (features.internal_model === 'T3W1') {
        modelName = 'Trezor Safe 7';
      }

      this.connection = {
        initialized: true,
        connected: true,
        deviceId: features.device_id || undefined,
        fingerprint,
        model: modelName,
        label: features.label || undefined,
      };

      this.connectedDevice = {
        id: `trezor-${features.device_id || 'unknown'}`,
        type: 'trezor',
        name: features.label || modelName,
        model: modelName,
        connected: true,
        fingerprint,
        needsPin: features.pin_protection && !features.unlocked,
        needsPassphrase: features.passphrase_protection,
      };

      log.info('Trezor connected', {
        model: modelName,
        label: features.label,
        fingerprint,
      });

      return this.connectedDevice;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Failed to connect Trezor', { error: message });

      if (message.includes('Popup closed') || message.includes('cancelled')) {
        throw new Error('Connection cancelled by user');
      }
      if (message.includes('Device not found') || message.includes('no device')) {
        throw new Error('No Trezor device found. Please connect your device and ensure Trezor Suite is running.');
      }
      if (message.includes('Bridge not running')) {
        throw new Error('Trezor Suite bridge not running. Please open Trezor Suite desktop app.');
      }

      throw new Error(`Failed to connect Trezor: ${message}`);
    }
  }

  /**
   * Disconnect from Trezor
   */
  async disconnect(): Promise<void> {
    this.connection = {
      initialized: this.connection.initialized,
      connected: false,
    };
    this.connectedDevice = null;
    log.info('Trezor disconnected');
  }

  /**
   * Get extended public key
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.connection.connected) {
      throw new Error('Trezor not connected');
    }

    try {
      const isTestnet = path.includes("/1'/") || path.includes("/1h/");

      const result = await TrezorConnect.getPublicKey({
        path,
        showOnTrezor: false,
        coin: isTestnet ? 'Testnet' : 'Bitcoin',
      });

      if (!result.success) {
        const errorMsg = 'error' in result.payload ? result.payload.error : 'Failed to get public key';
        throw new Error(errorMsg);
      }

      const { xpub, fingerprint: parentFingerprint } = result.payload;

      // IMPORTANT: Trezor's getPublicKey returns the PARENT fingerprint of the requested path,
      // not the master fingerprint. For BIP-174 PSBTs and wallet descriptors, we need the
      // MASTER fingerprint. Use the connection fingerprint (obtained from m/0' during connect).
      const masterFp = this.connection.fingerprint;
      const parentFpHex = parentFingerprint?.toString(16).padStart(8, '0');

      log.info('Got Trezor xpub', {
        path,
        xpubPrefix: xpub.substring(0, 15),
        masterFingerprint: masterFp,
        parentFingerprint: parentFpHex,
      });

      return {
        xpub,
        fingerprint: masterFp || parentFpHex || '', // Prefer master fingerprint
        path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('cancelled') || message.includes('Cancelled')) {
        throw new Error('Request cancelled on device');
      }

      throw new Error(`Failed to get xpub from Trezor: ${message}`);
    }
  }

  /**
   * Sign a PSBT with Trezor
   * Note: Trezor returns a fully signed raw transaction, not a PSBT
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    if (!this.connection.connected) {
      throw new Error('Trezor not connected');
    }

    log.info('Trezor signPSBT called', {
      psbtLength: request.psbt.length,
      inputPathsCount: request.inputPaths?.length || 0,
    });

    try {
      const psbt = bitcoin.Psbt.fromBase64(request.psbt);

      // Determine script type
      let scriptType: 'SPENDADDRESS' | 'SPENDP2SHWITNESS' | 'SPENDWITNESS' | 'SPENDTAPROOT' = 'SPENDWITNESS';
      if (request.accountPath) {
        scriptType = getTrezorScriptType(request.accountPath);
      } else if (request.inputPaths && request.inputPaths.length > 0) {
        scriptType = getTrezorScriptType(request.inputPaths[0]);
      }

      // Determine coin based on path - check multiple sources for testnet indicator
      // BIP-44/48/84 use coin_type 1' for testnet, 0' for mainnet
      // Pattern: m/purpose'/coin_type'/... where coin_type is the second component
      let isTestnet = false;
      let networkSource = 'default';

      // First try request paths
      const pathToCheck = request.accountPath || request.inputPaths?.[0] || '';
      if (pathToCheck) {
        if (pathToCheck.includes("/1'/") || pathToCheck.includes("/1h/")) {
          isTestnet = true;
          networkSource = 'request.path';
        } else if (pathToCheck.includes("/0'/") || pathToCheck.includes("/0h/")) {
          networkSource = 'request.path';
        }
      }

      // Always check bip32Derivation from first input as fallback/confirmation
      const firstInputDeriv = psbt.data.inputs[0]?.bip32Derivation?.[0];
      if (firstInputDeriv?.path) {
        const derivPath = firstInputDeriv.path;
        // Check for testnet coin type (second hardened component = 1)
        // e.g., m/48'/1'/0'/2' or 48h/1h/0h/2h
        const testnetMatch = derivPath.match(/^m?\/?\d+[h']\/1[h']\//);
        const mainnetMatch = derivPath.match(/^m?\/?\d+[h']\/0[h']\//);

        if (testnetMatch) {
          isTestnet = true;
          networkSource = 'bip32Derivation';
        } else if (mainnetMatch && networkSource === 'default') {
          networkSource = 'bip32Derivation';
        }

        log.info('Network detection from PSBT', {
          derivPath,
          testnetMatch: !!testnetMatch,
          mainnetMatch: !!mainnetMatch,
          isTestnet
        });
      }

      const coin = isTestnet ? 'Testnet' : 'Bitcoin';
      log.info('Using coin type for signing', { coin, isTestnet, networkSource, pathToCheck: pathToCheck || '(empty)' });

      // Multisig PSBTs contain bip32Derivation entries for ALL cosigners in each input/output.
      // Trezor requires we use the derivation path that belongs to THIS device (matched by
      // master fingerprint), not an arbitrary cosigner's path, or it will reject with
      // "Forbidden key path" or "wrong derivation path" error.
      const deviceFingerprint = this.connection.fingerprint;
      const deviceFingerprintBuffer = deviceFingerprint
        ? Buffer.from(deviceFingerprint, 'hex')
        : null;

      // For multisig, verify this device is actually a cosigner
      const firstInput = psbt.data.inputs[0];
      if (firstInput?.bip32Derivation && firstInput.bip32Derivation.length > 1 && deviceFingerprintBuffer) {
        const isCosigner = firstInput.bip32Derivation.some(d =>
          d.masterFingerprint.equals(deviceFingerprintBuffer)
        );
        if (!isCosigner) {
          const cosignerFingerprints = firstInput.bip32Derivation.map(d =>
            d.masterFingerprint.toString('hex')
          );
          log.error('Device is not a cosigner for this multisig wallet', {
            deviceFingerprint,
            cosignerFingerprints,
          });
          throw new Error(
            `This Trezor (${deviceFingerprint}) is not a cosigner for this multisig wallet. ` +
            `Expected one of: ${cosignerFingerprints.join(', ')}. ` +
            `Please connect the correct device.`
          );
        }
      }

      // Build Trezor inputs
      const inputs = psbt.data.inputs.map((input, idx) => {
        let addressN: number[] = [];
        let derivationPath: string | undefined;

        if (input.bip32Derivation && input.bip32Derivation.length > 0) {
          // For multisig, find the bip32Derivation entry matching this device's fingerprint
          let matchingDerivation = input.bip32Derivation[0]; // Default to first

          if (deviceFingerprintBuffer && input.bip32Derivation.length > 1) {
            const matching = input.bip32Derivation.find(d =>
              d.masterFingerprint.equals(deviceFingerprintBuffer)
            );
            if (matching) {
              matchingDerivation = matching;
              log.info('Found matching bip32Derivation for device', {
                inputIdx: idx,
                fingerprint: deviceFingerprint,
                path: matching.path,
              });
            } else {
              log.warn('No matching bip32Derivation found for device fingerprint', {
                inputIdx: idx,
                deviceFingerprint,
                availableFingerprints: input.bip32Derivation.map(d =>
                  d.masterFingerprint.toString('hex')
                ),
              });
            }
          }

          derivationPath = matchingDerivation.path;
          addressN = pathToAddressN(derivationPath);
        } else if (request.inputPaths && request.inputPaths[idx]) {
          derivationPath = request.inputPaths[idx];
          addressN = pathToAddressN(derivationPath);
        }

        const txInput = psbt.txInputs[idx];
        const prevHash = Buffer.from(txInput.hash).reverse().toString('hex');

        const trezorInput: any = {
          address_n: addressN,
          prev_hash: prevHash,
          prev_index: txInput.index,
          sequence: txInput.sequence,
          script_type: scriptType,
        };

        if (input.witnessUtxo) {
          trezorInput.amount = validateSatoshiAmount(input.witnessUtxo.value, `Input ${idx}`);
        }

        // Add multisig structure for multisig inputs (required for Trezor to validate multisig paths)
        if (isMultisigInput(input) && input.bip32Derivation) {
          const multisig = buildTrezorMultisig(input.witnessScript, input.bip32Derivation, request.multisigXpubs);
          if (multisig) {
            trezorInput.multisig = multisig;
            log.info('Built multisig structure for input', {
              inputIdx: idx,
              m: multisig.m,
              pubkeyCount: multisig.pubkeys.length,
              hasXpubs: !!request.multisigXpubs,
            });
          }
        }

        return trezorInput;
      });

      // Build Trezor outputs
      const outputs = psbt.txOutputs.map((output, idx) => {
        const psbtOutput = psbt.data.outputs[idx];
        const isChange = request.changeOutputs?.includes(idx) ||
          (psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 0);

        if (isChange && psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 0) {
          // For multisig, find the bip32Derivation entry matching this device's fingerprint
          let matchingDerivation = psbtOutput.bip32Derivation[0]; // Default to first

          if (deviceFingerprintBuffer && psbtOutput.bip32Derivation.length > 1) {
            const matching = psbtOutput.bip32Derivation.find(d =>
              d.masterFingerprint.equals(deviceFingerprintBuffer)
            );
            if (matching) {
              matchingDerivation = matching;
            }
          }

          const outputScriptType = scriptType === 'SPENDADDRESS' ? 'PAYTOADDRESS' as const :
            scriptType === 'SPENDP2SHWITNESS' ? 'PAYTOP2SHWITNESS' as const :
            scriptType === 'SPENDTAPROOT' ? 'PAYTOTAPROOT' as const : 'PAYTOWITNESS' as const;

          const changeOutput: any = {
            address_n: pathToAddressN(matchingDerivation.path),
            amount: validateSatoshiAmount(output.value, `Output ${idx}`),
            script_type: outputScriptType,
          };

          // Add multisig structure for multisig change outputs
          if (psbtOutput.bip32Derivation && psbtOutput.bip32Derivation.length > 1 && psbtOutput.witnessScript) {
            const multisig = buildTrezorMultisig(psbtOutput.witnessScript, psbtOutput.bip32Derivation, request.multisigXpubs);
            if (multisig) {
              changeOutput.multisig = multisig;
              log.info('Built multisig structure for change output', {
                outputIdx: idx,
                m: multisig.m,
                pubkeyCount: multisig.pubkeys.length,
              });
            }
          }

          return changeOutput;
        } else {
          const address = bitcoin.address.fromOutputScript(
            output.script,
            isTestnet ? bitcoin.networks.testnet : bitcoin.networks.bitcoin
          );

          return {
            address,
            amount: validateSatoshiAmount(output.value, `Output ${idx}`),
            script_type: 'PAYTOADDRESS' as const,
          };
        }
      });

      // Fetch reference transactions
      const refTxs = await fetchRefTxs(psbt);

      // Get the derivation path from the first input (after fingerprint matching)
      let accountPath = request.accountPath || request.inputPaths?.[0];

      // Try to get account path from first input's bip32Derivation (more reliable for multisig)
      // Note: firstInput was already defined earlier for cosigner verification
      if (firstInput?.bip32Derivation && firstInput.bip32Derivation.length > 0) {
        let matchingDerivation = firstInput.bip32Derivation[0];
        if (deviceFingerprintBuffer && firstInput.bip32Derivation.length > 1) {
          const matching = firstInput.bip32Derivation.find(d =>
            d.masterFingerprint.equals(deviceFingerprintBuffer)
          );
          if (matching) {
            matchingDerivation = matching;
          }
        }
        accountPath = matchingDerivation.path;
      }

      // Log if this is a BIP-48 multisig path
      // NOTE: We don't call TrezorConnect.unlockPath() for BIP-48 because it was designed
      // for SLIP-26 (Cardano) paths, not BIP-48. For BIP-48 multisig, Trezor validates
      // through the multisig structure. Users need Safety Checks set to "Prompt" in Trezor Suite.
      if (accountPath && isBip48MultisigPath(accountPath)) {
        log.info('BIP-48 multisig path detected - validation via multisig structure', {
          accountPath,
          note: 'If signing fails, ensure Safety Checks is set to "Prompt" in Trezor Suite'
        });
      }

      log.info('Calling TrezorConnect.signTransaction', {
        inputCount: inputs.length,
        outputCount: outputs.length,
        refTxCount: refTxs.length,
        coin,
      });

      // Sign with Trezor
      const result = await TrezorConnect.signTransaction({
        inputs,
        outputs,
        refTxs: refTxs.length > 0 ? refTxs : undefined,
        coin,
        push: false,
      });

      if (!result.success) {
        const errorMsg = 'error' in result.payload ? result.payload.error : 'Signing failed';
        throw new Error(errorMsg);
      }

      log.info('Trezor signing successful', {
        signedTxLength: result.payload.serializedTx?.length,
      });

      // Trezor returns fully signed raw transaction
      const signedTxHex = result.payload.serializedTx;

      return {
        psbt: psbt.toBase64(), // Original PSBT for reference
        rawTx: signedTxHex, // Fully signed transaction ready to broadcast
        signatures: inputs.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error('Trezor signing failed', { error: message });

      if (message.includes('Cancelled') || message.includes('cancelled') || message.includes('rejected')) {
        throw new Error('Transaction rejected on Trezor. Please approve the transaction on your device.');
      }
      if (message.includes('PIN')) {
        throw new Error('Incorrect PIN. Please try again.');
      }
      if (message.includes('Passphrase')) {
        throw new Error('Passphrase entry cancelled.');
      }
      if (message.includes('Device disconnected') || message.includes('no device')) {
        throw new Error('Trezor disconnected. Please reconnect and try again.');
      }
      if (message.includes('Forbidden key path')) {
        throw new Error(
          'Trezor blocked this derivation path. In Trezor Suite, go to Settings > Device > Safety Checks and set to "Prompt" to allow multisig signing.'
        );
      }
      if (message.includes('wrong derivation path') || message.includes('Wrong derivation path')) {
        throw new Error(
          'The derivation path does not match your Trezor account. Please ensure: ' +
          '(1) You are using the same passphrase (or no passphrase) as when you registered the device, and ' +
          '(2) In Trezor Suite, go to Settings > Device > Safety Checks and set to "Prompt" to allow non-standard paths.'
        );
      }

      throw new Error(`Failed to sign with Trezor: ${message}`);
    }
  }
}
