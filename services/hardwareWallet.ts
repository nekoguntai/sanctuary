/**
 * Hardware Wallet Integration Service
 *
 * Provides browser-based hardware wallet integration for signing Bitcoin transactions.
 * Uses native WebUSB API for direct communication with Ledger devices.
 * Requires HTTPS for WebUSB to work in the browser.
 */

import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import AppBtc from '@ledgerhq/hw-app-btc';
import { AppClient, DefaultWalletPolicy, PsbtV2 } from 'ledger-bitcoin';
import * as bitcoin from 'bitcoinjs-lib';
import apiClient from '../src/api/client';
import { createLogger } from '../utils/logger';

const log = createLogger('HardwareWallet');

export type DeviceType = 'coldcard' | 'ledger' | 'trezor' | 'bitbox' | 'passport' | 'jade' | 'unknown';

export interface HardwareWalletDevice {
  id: string;
  type: DeviceType;
  name: string;
  model?: string;
  connected: boolean;
  fingerprint?: string;
  needsPin?: boolean;
  needsPassphrase?: boolean;
}

export interface PSBTSignRequest {
  psbt: string; // Base64 encoded PSBT
  inputPaths: string[]; // Derivation paths for inputs to sign
  changeOutputs?: number[]; // Indices of change outputs
  accountPath?: string; // Account derivation path (e.g., "m/84'/0'/0'")
  scriptType?: 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr'; // Script type for wallet policy
}

export interface PSBTSignResponse {
  psbt: string; // Base64 encoded signed PSBT
  signatures: number; // Number of signatures added
}

export interface TransactionForSigning {
  walletId: string;
  recipient: string;
  amount: number; // satoshis
  feeRate: number; // sat/vB
  utxos?: string[]; // Optional: specific UTXOs to use
  changeAddress?: string;
}

export interface XpubResult {
  xpub: string;
  fingerprint: string;
  path: string;
}

// Ledger USB vendor ID
const LEDGER_VENDOR_ID = 0x2c97;

// Connected device state
interface LedgerConnection {
  transport: TransportWebUSB;
  app: AppBtc;
  appClient: AppClient; // ledger-bitcoin AppClient for PSBT signing
  device: USBDevice;
}

let activeConnection: LedgerConnection | null = null;

/**
 * Check if WebUSB is supported in this browser
 */
export const isWebUSBSupported = (): boolean => {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
};

/**
 * Check if we're in a secure context (HTTPS or localhost)
 */
export const isSecureContext = (): boolean => {
  return typeof window !== 'undefined' && window.isSecureContext;
};

/**
 * Check if hardware wallet integration is supported
 */
export const isHardwareWalletSupported = (): boolean => {
  return isWebUSBSupported() && isSecureContext();
};

/**
 * Get model name from Ledger product ID
 */
const getLedgerModel = (productId: number): string => {
  const models: Record<number, string> = {
    0x0001: 'Ledger Nano S',
    0x0004: 'Ledger Nano X',
    0x0005: 'Ledger Nano S Plus',
    0x0006: 'Ledger Stax',
    0x0007: 'Ledger Flex',
  };
  return models[productId] || 'Ledger Device';
};

/**
 * Get device ID from USB device
 */
const getDeviceId = (device: USBDevice): string => {
  return `ledger-${device.vendorId}-${device.productId}-${device.serialNumber || 'unknown'}`;
};

/**
 * Get list of previously authorized Ledger devices
 */
export const getConnectedDevices = async (): Promise<HardwareWalletDevice[]> => {
  if (!isWebUSBSupported()) {
    return [];
  }

  try {
    const devices = await navigator.usb.getDevices();
    const ledgerDevices = devices.filter(d => d.vendorId === LEDGER_VENDOR_ID);

    return ledgerDevices.map(device => ({
      id: getDeviceId(device),
      type: 'ledger' as DeviceType,
      name: getLedgerModel(device.productId),
      model: getLedgerModel(device.productId),
      connected: device.opened || (activeConnection?.device === device),
      fingerprint: undefined, // Will be set on connect
    }));
  } catch (error) {
    log.error('Failed to enumerate devices', { error });
    return [];
  }
};

/**
 * Request permission to connect to a Ledger device
 * Must be called in response to a user gesture (click)
 */
export const requestDevice = async (): Promise<HardwareWalletDevice | null> => {
  if (!isHardwareWalletSupported()) {
    throw new Error(
      'WebUSB is not supported. Please use Chrome/Edge on HTTPS.'
    );
  }

  try {
    // This will show the browser's device picker
    const device = await navigator.usb.requestDevice({
      filters: [{ vendorId: LEDGER_VENDOR_ID }],
    });

    if (!device) {
      return null;
    }

    return {
      id: getDeviceId(device),
      type: 'ledger',
      name: getLedgerModel(device.productId),
      model: getLedgerModel(device.productId),
      connected: false,
      fingerprint: undefined,
    };
  } catch (error) {
    if ((error as Error).name === 'NotFoundError') {
      // User cancelled the picker
      return null;
    }
    throw error;
  }
};

/**
 * Connect to a Ledger device and open the Bitcoin app
 */
export const connectDevice = async (deviceId?: string): Promise<HardwareWalletDevice> => {
  if (!isHardwareWalletSupported()) {
    throw new Error('WebUSB is not supported in this browser');
  }

  // Close existing connection
  if (activeConnection) {
    try {
      await activeConnection.transport.close();
    } catch {
      // Ignore close errors
    }
    activeConnection = null;
  }

  try {
    // Create transport (will use existing permission or request new one)
    const transport = await TransportWebUSB.create();
    // Type assertion needed due to library type definitions
    const device = (transport as any).device as USBDevice;

    // Create Bitcoin app instances
    const app = new AppBtc({ transport });
    // Create ledger-bitcoin AppClient for PSBT signing
    const appClient = new AppClient(transport as any);

    // Get master fingerprint from the AppClient
    let fingerprint: string | undefined;
    try {
      fingerprint = await appClient.getMasterFingerprint();
      log.info('Got master fingerprint from device', { fingerprint });
    } catch (error) {
      log.warn('Could not get fingerprint - Bitcoin app may not be open', { error });
    }

    activeConnection = { transport: transport as any, app, appClient, device };

    return {
      id: getDeviceId(device),
      type: 'ledger',
      name: getLedgerModel(device.productId),
      model: getLedgerModel(device.productId),
      connected: true,
      fingerprint,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('denied') || message.includes('NotAllowed')) {
      throw new Error('Access denied. Please allow USB access and try again.');
    }
    if (message.includes('0x6d00') || message.includes('0x6e00')) {
      throw new Error('Please open the Bitcoin app on your Ledger device.');
    }
    if (message.includes('locked') || message.includes('0x6982')) {
      throw new Error('Ledger is locked. Please unlock with your PIN.');
    }

    throw new Error(`Failed to connect: ${message}`);
  }
};

/**
 * Disconnect from the active device
 */
export const disconnectDevice = async (): Promise<void> => {
  if (activeConnection) {
    try {
      await activeConnection.transport.close();
    } catch (error) {
      log.warn('Error closing transport', { error });
    }
    activeConnection = null;
  }
};

// xpub version bytes - Ledger always returns standard xpub format
const XPUB_VERSION = 0x0488b21e;  // Standard xpub (mainnet)
const TPUB_VERSION = 0x043587cf;  // Standard tpub (testnet)

/**
 * Get extended public key from the connected device
 */
export const getXpub = async (path: string): Promise<XpubResult> => {
  if (!activeConnection) {
    throw new Error('No device connected');
  }

  try {
    // Check if testnet path (coin type 1)
    const isTestnet = path.includes("/1'/") || path.includes("/1h/");
    const xpubVersion = isTestnet ? TPUB_VERSION : XPUB_VERSION;

    // getWalletXpub returns just the xpub string
    const xpub = await activeConnection.app.getWalletXpub({
      path,
      xpubVersion,
    });

    // Get master fingerprint from the AppClient
    let fingerprint = '';
    try {
      fingerprint = await activeConnection.appClient.getMasterFingerprint();
    } catch (fpError) {
      log.warn('Could not get fingerprint', { error: fpError });
    }

    log.info('getXpub result', {
      path,
      xpubVersion: xpubVersion.toString(16),
      hasXpub: !!xpub,
      xpubPrefix: xpub?.substring(0, 10),
      fingerprint,
    });

    return {
      xpub,
      fingerprint,
      path,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('0x6985') || message.includes('denied')) {
      throw new Error('Request rejected on device');
    }
    if (message.includes('0x6d00') || message.includes('0x6e00')) {
      throw new Error('Bitcoin app not open on device');
    }

    throw new Error(`Failed to get xpub: ${message}`);
  }
};

/**
 * Verify an address on the device display
 */
export const verifyAddress = async (path: string, address: string): Promise<boolean> => {
  if (!activeConnection) {
    throw new Error('No device connected');
  }

  try {
    // Display address on device for verification
    await activeConnection.app.getWalletPublicKey(path, { verify: true });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('0x6985') || message.includes('denied')) {
      return false; // User rejected
    }

    throw new Error(`Failed to verify address: ${message}`);
  }
};

/**
 * Get descriptor template for wallet policy based on script type
 */
const getDescriptorTemplate = (scriptType: string): 'wpkh(@0/**)' | 'sh(wpkh(@0/**))' | 'pkh(@0/**)' | 'tr(@0/**)' => {
  switch (scriptType) {
    case 'p2wpkh':
      return 'wpkh(@0/**)';
    case 'p2sh-p2wpkh':
      return 'sh(wpkh(@0/**))';
    case 'p2pkh':
      return 'pkh(@0/**)';
    case 'p2tr':
      return 'tr(@0/**)';
    default:
      return 'wpkh(@0/**)'; // Default to native segwit
  }
};

/**
 * Infer script type from derivation path
 */
const inferScriptTypeFromPath = (path: string): 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr' => {
  if (path.startsWith("m/84'") || path.startsWith("84'")) {
    return 'p2wpkh'; // BIP84 - Native SegWit
  }
  if (path.startsWith("m/49'") || path.startsWith("49'")) {
    return 'p2sh-p2wpkh'; // BIP49 - Wrapped SegWit
  }
  if (path.startsWith("m/44'") || path.startsWith("44'")) {
    return 'p2pkh'; // BIP44 - Legacy
  }
  if (path.startsWith("m/86'") || path.startsWith("86'")) {
    return 'p2tr'; // BIP86 - Taproot
  }
  return 'p2wpkh'; // Default to native segwit
};

/**
 * Extract account path from a full derivation path
 * e.g., "m/84'/0'/0'/0/5" -> "m/84'/0'/0'"
 */
const extractAccountPath = (fullPath: string): string => {
  const parts = fullPath.replace(/h/g, "'").split('/');
  // Account path is typically the first 4 parts: m/purpose'/coin'/account'
  if (parts.length >= 4) {
    return parts.slice(0, 4).join('/');
  }
  return fullPath;
};

/**
 * Sign a PSBT with the connected device using DefaultWalletPolicy
 *
 * For standard single-sig wallets (BIP44/49/84/86), this uses DefaultWalletPolicy
 * which doesn't require wallet registration on the device.
 */
export const signPSBT = async (
  request: PSBTSignRequest
): Promise<PSBTSignResponse> => {
  if (!activeConnection) {
    throw new Error('No device connected');
  }

  try {
    const { appClient } = activeConnection;

    // Determine account path and script type
    let accountPath = request.accountPath;
    let scriptType = request.scriptType;

    // If not provided, try to infer from input paths
    if (!accountPath && request.inputPaths && request.inputPaths.length > 0) {
      accountPath = extractAccountPath(request.inputPaths[0]);
    }
    if (!accountPath) {
      accountPath = "m/84'/0'/0'"; // Default to BIP84 mainnet
    }

    if (!scriptType) {
      scriptType = inferScriptTypeFromPath(accountPath);
    }

    log.info('Preparing to sign PSBT', {
      psbtLength: request.psbt.length,
      inputPathsCount: request.inputPaths?.length || 0,
      accountPath,
      scriptType,
    });

    // Get master fingerprint (returns hex string directly)
    const masterFpHex = await appClient.getMasterFingerprint();

    // Get account xpub
    // Convert path format: m/84'/0'/0' -> array for getExtendedPubkey
    const xpub = await appClient.getExtendedPubkey(accountPath);

    log.info('Got wallet info for signing', {
      masterFingerprint: masterFpHex,
      xpubPrefix: xpub.substring(0, 15),
      accountPath,
    });

    // Create wallet policy key string
    // Format: [fingerprint/path]xpub
    const pathWithoutM = accountPath.replace(/^m\//, '');
    const keyInfo = `[${masterFpHex}/${pathWithoutM}]${xpub}`;

    // Create DefaultWalletPolicy for standard single-sig wallet
    const descriptorTemplate = getDescriptorTemplate(scriptType);
    const walletPolicy = new DefaultWalletPolicy(descriptorTemplate, keyInfo);

    log.info('Created wallet policy', {
      descriptorTemplate,
      keyInfoPrefix: keyInfo.substring(0, 30),
    });

    // Parse the PSBT using bitcoinjs-lib
    const psbt = bitcoin.Psbt.fromBase64(request.psbt);

    // Sign the PSBT using ledger-bitcoin
    // DefaultWalletPolicy doesn't require registration, so walletHMAC is null
    const signatures = await appClient.signPsbt(request.psbt, walletPolicy, null);

    log.info('Got signatures from device', {
      signatureCount: signatures.length,
    });

    // Apply each signature to the PSBT
    for (const [inputIndex, partialSig] of signatures) {
      log.info('Applying signature', {
        inputIndex,
        pubkeyHex: partialSig.pubkey.toString('hex').substring(0, 20),
        signatureLength: partialSig.signature.length,
      });

      // Update the input with the partial signature
      psbt.updateInput(inputIndex, {
        partialSig: [{
          pubkey: partialSig.pubkey,
          signature: partialSig.signature,
        }],
      });
    }

    // Finalize all inputs
    psbt.finalizeAllInputs();

    log.info('PSBT signed and finalized successfully', {
      signatureCount: signatures.length,
    });

    // Return the signed PSBT as base64
    return {
      psbt: psbt.toBase64(),
      signatures: signatures.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error('PSBT signing failed', { error: message });

    if (message.includes('0x6985') || message.includes('denied') || message.includes('rejected')) {
      throw new Error('Transaction rejected on device. Please approve the transaction on your Ledger.');
    }
    if (message.includes('0x6d00') || message.includes('0x6e00') || message.includes('CLA_NOT_SUPPORTED')) {
      throw new Error('Bitcoin app not open on device. Please open the Bitcoin app on your Ledger.');
    }
    if (message.includes('0x6982') || message.includes('locked')) {
      throw new Error('Device is locked. Please unlock your Ledger with your PIN.');
    }
    if (message.includes('No device')) {
      throw new Error('Device disconnected. Please reconnect your Ledger and try again.');
    }

    throw new Error(`Failed to sign transaction: ${message}`);
  }
};

/**
 * Create a PSBT for signing via the backend API
 */
export const createPSBTForSigning = async (
  tx: TransactionForSigning
): Promise<{ psbt: string; fee: number; inputPaths: string[] }> => {
  const response = await apiClient.post<{
    psbt: string;
    fee: number;
    inputPaths: string[];
  }>(`/wallets/${tx.walletId}/psbt/create`, {
    recipients: [{ address: tx.recipient, amount: tx.amount }],
    feeRate: tx.feeRate,
    utxoIds: tx.utxos,
    changeAddress: tx.changeAddress,
  });

  return response;
};

/**
 * Broadcast a signed PSBT to the Bitcoin network via the backend
 */
export const broadcastSignedPSBT = async (
  walletId: string,
  psbt: string
): Promise<{ txid: string }> => {
  const response = await apiClient.post<{ txid: string }>(
    `/wallets/${walletId}/psbt/broadcast`,
    { signedPsbt: psbt }
  );

  return response;
};

/**
 * Hardware Wallet Service Class
 */
export class HardwareWalletService {
  private connectedDevice: HardwareWalletDevice | null = null;

  /**
   * Check if WebUSB is supported
   */
  isSupported(): boolean {
    return isHardwareWalletSupported();
  }

  /**
   * Check if a device is connected
   */
  isConnected(): boolean {
    return this.connectedDevice !== null && this.connectedDevice.connected;
  }

  /**
   * Get the connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  /**
   * Get all authorized devices
   */
  async getDevices(): Promise<HardwareWalletDevice[]> {
    return getConnectedDevices();
  }

  /**
   * Request permission and connect to a device
   * @param type Optional device type filter (currently unused but reserved for future use)
   */
  async connect(_type?: DeviceType): Promise<HardwareWalletDevice> {
    // First request permission
    const device = await requestDevice();
    if (!device) {
      throw new Error('No device selected');
    }

    // Then connect
    this.connectedDevice = await connectDevice();
    return this.connectedDevice;
  }

  /**
   * Connect to an already authorized device
   */
  async connectAuthorized(): Promise<HardwareWalletDevice> {
    this.connectedDevice = await connectDevice();
    return this.connectedDevice;
  }

  /**
   * Disconnect from the device
   */
  async disconnect(): Promise<void> {
    await disconnectDevice();
    this.connectedDevice = null;
  }

  /**
   * Get xpub from device
   */
  async getXpub(path: string): Promise<XpubResult> {
    return getXpub(path);
  }

  /**
   * Verify address on device
   */
  async verifyAddress(path: string, address: string): Promise<boolean> {
    return verifyAddress(path, address);
  }

  /**
   * Sign a PSBT
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    return signPSBT(request);
  }

  /**
   * Full transaction signing flow
   */
  async signTransaction(tx: TransactionForSigning): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('No device connected');
    }

    // Create PSBT
    const { psbt, inputPaths } = await createPSBTForSigning(tx);

    // Sign
    const signed = await signPSBT({ psbt, inputPaths });

    // Broadcast
    const result = await broadcastSignedPSBT(tx.walletId, signed.psbt);

    return result.txid;
  }
}

// Export singleton
export const hardwareWalletService = new HardwareWalletService();
