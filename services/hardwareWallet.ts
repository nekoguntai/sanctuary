/**
 * Hardware Wallet Integration Service
 *
 * Provides browser-based hardware wallet integration for signing Bitcoin transactions.
 * Supports Ledger and Trezor hardware wallets via the Sanctuary browser extension.
 *
 * Architecture:
 * - Browser extension handles USB communication via WebUSB/WebHID
 * - Content script injects `window.sanctuaryHWBridge` API into the page
 * - This service provides a clean interface for React components
 */

import apiClient from '../src/api/client';

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

// Bridge API interface (injected by extension)
interface SanctuaryHWBridge {
  isAvailable: true;
  version: string;
  getDevices(): Promise<HardwareWalletDevice[]>;
  getXpub(path: string, deviceId?: string): Promise<XpubResult>;
  signPSBT(psbt: string, inputPaths: string[], deviceId?: string): Promise<{ signedPsbt: string; signatures: number }>;
  verifyAddress(path: string, address: string, deviceId?: string): Promise<boolean>;
  connectDevice(deviceType: 'ledger' | 'trezor'): Promise<HardwareWalletDevice>;
  onDeviceChange(callback: (devices: HardwareWalletDevice[]) => void): () => void;
}

declare global {
  interface Window {
    sanctuaryHWBridge?: SanctuaryHWBridge;
  }
}

/**
 * Check if the Sanctuary HW Bridge extension is available
 */
export const isExtensionAvailable = (): boolean => {
  return typeof window !== 'undefined' && window.sanctuaryHWBridge?.isAvailable === true;
};

/**
 * Wait for the extension to become available
 * @param timeout Maximum time to wait in milliseconds
 */
export const waitForExtension = (timeout = 3000): Promise<boolean> => {
  return new Promise((resolve) => {
    // Already available
    if (isExtensionAvailable()) {
      resolve(true);
      return;
    }

    // Wait for the ready event
    const handler = () => {
      window.removeEventListener('sanctuaryHWBridgeReady', handler);
      clearTimeout(timeoutId);
      resolve(true);
    };

    window.addEventListener('sanctuaryHWBridgeReady', handler);

    // Timeout fallback
    const timeoutId = setTimeout(() => {
      window.removeEventListener('sanctuaryHWBridgeReady', handler);
      resolve(isExtensionAvailable());
    }, timeout);
  });
};

/**
 * Check if browser supports hardware wallet integration (via extension or native)
 */
export const isHardwareWalletSupported = (): boolean => {
  // Extension is available - full support
  if (isExtensionAvailable()) {
    return true;
  }

  // Check for WebUSB support (Chrome, Edge) - partial support
  if ('usb' in navigator) {
    return true;
  }

  // Check for WebHID support (broader compatibility) - partial support
  if ('hid' in navigator) {
    return true;
  }

  return false;
};

/**
 * Get list of connected hardware wallet devices
 */
export const getConnectedDevices = async (): Promise<HardwareWalletDevice[]> => {
  // Use extension bridge if available
  if (isExtensionAvailable()) {
    try {
      const devices = await window.sanctuaryHWBridge!.getDevices();
      return devices.map(d => ({
        ...d,
        name: d.model || `${d.type.charAt(0).toUpperCase()}${d.type.slice(1)}`,
      }));
    } catch (error) {
      console.error('Failed to get devices from extension:', error);
      return [];
    }
  }

  // No extension - return empty
  console.warn('Hardware wallet extension not available');
  return [];
};

/**
 * Request permission to connect to a hardware wallet
 */
export const requestDevice = async (type?: DeviceType): Promise<HardwareWalletDevice | null> => {
  if (!isExtensionAvailable()) {
    throw new Error(
      'Hardware wallet extension not installed. Please install the Sanctuary HW Bridge extension.'
    );
  }

  // Only Ledger and Trezor are supported via the extension
  const supportedTypes = ['ledger', 'trezor'] as const;
  const deviceType = type && supportedTypes.includes(type as any)
    ? (type as 'ledger' | 'trezor')
    : 'ledger'; // Default to Ledger

  try {
    const device = await window.sanctuaryHWBridge!.connectDevice(deviceType);
    return {
      ...device,
      name: device.model || `${device.type.charAt(0).toUpperCase()}${device.type.slice(1)}`,
    };
  } catch (error) {
    console.error('Device connection failed:', error);
    throw error;
  }
};

/**
 * Get extended public key from a connected device
 */
export const getXpub = async (
  path: string,
  deviceId?: string
): Promise<XpubResult> => {
  if (!isExtensionAvailable()) {
    throw new Error('Hardware wallet extension not available');
  }

  return window.sanctuaryHWBridge!.getXpub(path, deviceId);
};

/**
 * Verify an address on the hardware wallet display
 */
export const verifyAddress = async (
  path: string,
  address: string,
  deviceId?: string
): Promise<boolean> => {
  if (!isExtensionAvailable()) {
    throw new Error('Hardware wallet extension not available');
  }

  return window.sanctuaryHWBridge!.verifyAddress(path, address, deviceId);
};

/**
 * Sign a PSBT with a hardware wallet
 */
export const signPSBT = async (
  device: HardwareWalletDevice,
  request: PSBTSignRequest
): Promise<PSBTSignResponse> => {
  if (!device.connected) {
    throw new Error('Device not connected');
  }

  if (!isExtensionAvailable()) {
    throw new Error('Hardware wallet extension not available');
  }

  try {
    const result = await window.sanctuaryHWBridge!.signPSBT(
      request.psbt,
      request.inputPaths,
      device.id
    );

    return {
      psbt: result.signedPsbt,
      signatures: result.signatures,
    };
  } catch (error) {
    console.error('PSBT signing failed:', error);
    throw new Error(
      `Failed to sign transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
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
 * Subscribe to device connection changes
 */
export const onDeviceChange = (
  callback: (devices: HardwareWalletDevice[]) => void
): (() => void) => {
  if (!isExtensionAvailable()) {
    console.warn('Hardware wallet extension not available for device change events');
    return () => {};
  }

  return window.sanctuaryHWBridge!.onDeviceChange(callback);
};

/**
 * Hardware Wallet Service
 *
 * Main service class for hardware wallet operations
 */
export class HardwareWalletService {
  private connectedDevice: HardwareWalletDevice | null = null;
  private unsubscribeDeviceChange: (() => void) | null = null;

  constructor() {
    // Auto-subscribe to device changes when extension is available
    this.initDeviceChangeListener();
  }

  private async initDeviceChangeListener(): Promise<void> {
    // Wait for extension to be ready
    const available = await waitForExtension(5000);
    if (available) {
      this.unsubscribeDeviceChange = onDeviceChange((devices) => {
        // Update connected device status
        if (this.connectedDevice) {
          const device = devices.find(d => d.id === this.connectedDevice!.id);
          if (device) {
            this.connectedDevice = {
              ...this.connectedDevice,
              connected: device.connected,
            };
          } else {
            // Device disconnected
            this.connectedDevice = null;
          }
        }
      });
    }
  }

  /**
   * Check if the extension is available
   */
  isExtensionAvailable(): boolean {
    return isExtensionAvailable();
  }

  /**
   * Check if a device is currently connected
   */
  isConnected(): boolean {
    return this.connectedDevice !== null && this.connectedDevice.connected;
  }

  /**
   * Get the currently connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  /**
   * Get all connected devices
   */
  async getDevices(): Promise<HardwareWalletDevice[]> {
    return getConnectedDevices();
  }

  /**
   * Connect to a hardware wallet device
   */
  async connect(type?: DeviceType): Promise<HardwareWalletDevice> {
    const device = await requestDevice(type);
    if (!device) {
      throw new Error('No device selected');
    }

    this.connectedDevice = device;
    return device;
  }

  /**
   * Disconnect from the current device
   */
  disconnect(): void {
    this.connectedDevice = null;
  }

  /**
   * Get extended public key from the connected device
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.isConnected() || !this.connectedDevice) {
      throw new Error('No device connected');
    }

    return getXpub(path, this.connectedDevice.id);
  }

  /**
   * Verify an address on the device display
   */
  async verifyAddress(path: string, address: string): Promise<boolean> {
    if (!this.isConnected() || !this.connectedDevice) {
      throw new Error('No device connected');
    }

    return verifyAddress(path, address, this.connectedDevice.id);
  }

  /**
   * Sign a PSBT with the connected device
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    if (!this.isConnected() || !this.connectedDevice) {
      throw new Error('No device connected');
    }

    return signPSBT(this.connectedDevice, request);
  }

  /**
   * Create, sign, and broadcast a transaction
   */
  async signTransaction(tx: TransactionForSigning): Promise<string> {
    if (!this.isConnected() || !this.connectedDevice) {
      throw new Error('No device connected');
    }

    // Create PSBT via backend
    const { psbt, inputPaths } = await createPSBTForSigning(tx);

    // Sign PSBT with device
    const signed = await signPSBT(this.connectedDevice, {
      psbt,
      inputPaths,
    });

    // Broadcast signed transaction
    const result = await broadcastSignedPSBT(tx.walletId, signed.psbt);

    return result.txid;
  }

  /**
   * Cleanup subscriptions
   */
  destroy(): void {
    if (this.unsubscribeDeviceChange) {
      this.unsubscribeDeviceChange();
      this.unsubscribeDeviceChange = null;
    }
    this.connectedDevice = null;
  }
}

// Export singleton instance
export const hardwareWalletService = new HardwareWalletService();
