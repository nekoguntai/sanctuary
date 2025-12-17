/**
 * Hardware Wallet Integration Service
 *
 * Provides browser-based hardware wallet integration for signing Bitcoin transactions.
 * Uses native WebUSB API for direct communication with Ledger devices.
 * Requires HTTPS for WebUSB to work in the browser.
 */

import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import AppBtc from '@ledgerhq/hw-app-btc';
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

    // Create Bitcoin app instance
    const app = new AppBtc({ transport });

    // Get master fingerprint
    let fingerprint: string | undefined;
    try {
      // Type assertion needed - library returns object with xpub and fingerprint
      // Use zpub version (0x04b24746) for BIP84 native segwit path
      const result = await (app as any).getWalletXpub({
        path: "m/84'/0'/0'",
        xpubVersion: 0x04b24746,  // zpub for native segwit
      }) as { xpub: string; masterFingerprint?: number };
      fingerprint = result.masterFingerprint?.toString(16).padStart(8, '0');
    } catch (error) {
      log.warn('Could not get fingerprint - Bitcoin app may not be open', { error });
    }

    activeConnection = { transport: transport as any, app, device };

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

    // Type assertion needed - library returns object with xpub and fingerprint
    const result = await (activeConnection.app as any).getWalletXpub({
      path,
      xpubVersion,
    }) as { xpub: string; masterFingerprint?: number };

    return {
      xpub: result.xpub,
      fingerprint: result.masterFingerprint?.toString(16).padStart(8, '0') || '',
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
 * Sign a PSBT with the connected device
 */
export const signPSBT = async (
  request: PSBTSignRequest
): Promise<PSBTSignResponse> => {
  if (!activeConnection) {
    throw new Error('No device connected');
  }

  try {
    // Decode PSBT from base64
    const psbtBuffer = Buffer.from(request.psbt, 'base64');

    // Sign with Ledger
    // Note: The actual signing API depends on the hw-app-btc version
    // Type assertion needed due to library type definitions not including signPsbt
    const result = await (activeConnection.app as any).signPsbt(psbtBuffer, request.inputPaths);

    // Re-encode signed PSBT
    const signedPsbt = Buffer.from(result.psbt).toString('base64');

    return {
      psbt: signedPsbt,
      signatures: result.signatures?.length || request.inputPaths.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('0x6985') || message.includes('denied')) {
      throw new Error('Transaction rejected on device');
    }
    if (message.includes('0x6d00') || message.includes('0x6e00')) {
      throw new Error('Bitcoin app not open on device');
    }

    throw new Error(`Failed to sign: ${message}`);
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
