/**
 * Hardware Wallet Integration Service
 *
 * Provides browser-based hardware wallet integration for signing Bitcoin transactions.
 * Supports Coldcard, Ledger, Trezor, and other hardware wallets via PSBT.
 *
 * Note: This is a foundation layer. Full hardware wallet support requires:
 * - WebUSB/WebHID APIs for device communication
 * - Device-specific libraries (@ledgerhq/hw-app-btc, @trezor/connect-web)
 * - PSBT encoding/decoding
 * - Multi-sig coordination
 */

export type DeviceType = 'coldcard' | 'ledger' | 'trezor' | 'bitbox' | 'passport' | 'jade' | 'unknown';

export interface HardwareWalletDevice {
  id: string;
  type: DeviceType;
  name: string;
  model?: string;
  connected: boolean;
  fingerprint?: string;
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

/**
 * Check if browser supports hardware wallet integration
 */
export const isHardwareWalletSupported = (): boolean => {
  // Check for WebUSB support (Chrome, Edge)
  if ('usb' in navigator) {
    return true;
  }

  // Check for WebHID support (broader compatibility)
  if ('hid' in navigator) {
    return true;
  }

  return false;
};

/**
 * Get list of connected hardware wallet devices
 *
 * In production, this would:
 * 1. Query USB/HID devices
 * 2. Identify hardware wallets by vendor/product IDs
 * 3. Return list of connected devices
 */
export const getConnectedDevices = async (): Promise<HardwareWalletDevice[]> => {
  // Check browser support
  if (!isHardwareWalletSupported()) {
    console.warn('Hardware wallet support not available in this browser');
    return [];
  }

  try {
    // In production, query actual USB devices:
    // const devices = await navigator.usb.getDevices();
    // return devices.filter(d => isHardwareWallet(d)).map(mapToDevice);

    // For now, return empty array (demo mode)
    return [];
  } catch (error) {
    console.error('Failed to get connected devices:', error);
    return [];
  }
};

/**
 * Request permission to connect to a hardware wallet
 *
 * In production, this would:
 * 1. Show browser's device picker
 * 2. User selects their hardware wallet
 * 3. Return device info
 */
export const requestDevice = async (type?: DeviceType): Promise<HardwareWalletDevice | null> => {
  if (!isHardwareWalletSupported()) {
    throw new Error('Hardware wallet support not available in this browser');
  }

  try {
    // In production, request USB device:
    // const device = await navigator.usb.requestDevice({
    //   filters: getVendorFilters(type)
    // });
    // return mapToDevice(device);

    console.log('requestDevice called for type:', type);

    // For demo, return mock device
    return {
      id: 'demo-device',
      type: type || 'coldcard',
      name: type ? `${type.charAt(0).toUpperCase()}${type.slice(1)} (Demo)` : 'Hardware Wallet (Demo)',
      model: 'Mk4',
      connected: true,
      fingerprint: 'ABCD1234',
    };
  } catch (error) {
    console.error('Device request failed:', error);
    return null;
  }
};

/**
 * Sign a PSBT with a hardware wallet
 *
 * In production, this would:
 * 1. Send PSBT to device
 * 2. User verifies on device screen
 * 3. User approves on device
 * 4. Device returns signed PSBT
 * 5. Verify signatures
 */
export const signPSBT = async (
  device: HardwareWalletDevice,
  request: PSBTSignRequest
): Promise<PSBTSignResponse> => {
  if (!device.connected) {
    throw new Error('Device not connected');
  }

  try {
    // In production, send PSBT to device:
    // switch (device.type) {
    //   case 'ledger':
    //     return await signWithLedger(device, request);
    //   case 'trezor':
    //     return await signWithTrezor(device, request);
    //   case 'coldcard':
    //     return await signWithColdcard(device, request);
    //   default:
    //     throw new Error(`Unsupported device type: ${device.type}`);
    // }

    console.log('Signing PSBT with device:', device.name);
    console.log('PSBT:', request.psbt.substring(0, 50) + '...');
    console.log('Input paths:', request.inputPaths);

    // For demo, simulate signing delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Return mock signed PSBT
    return {
      psbt: request.psbt, // In production, this would be signed
      signatures: request.inputPaths.length,
    };
  } catch (error) {
    console.error('PSBT signing failed:', error);
    throw new Error(`Failed to sign transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Create a PSBT for signing
 *
 * This calls the backend API to create a properly formatted PSBT
 */
export const createPSBTForSigning = async (
  tx: TransactionForSigning
): Promise<string> => {
  // In production, call backend API:
  // const response = await fetch(`/api/v1/transactions/create-psbt`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(tx)
  // });
  // const data = await response.json();
  // return data.psbt;

  console.log('Creating PSBT for transaction:', tx);

  // For demo, return mock PSBT (base64 encoded)
  return 'cHNidP8BAFICAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA...';
};

/**
 * Broadcast a signed PSBT to the Bitcoin network
 *
 * This calls the backend API to finalize and broadcast the transaction
 */
export const broadcastSignedPSBT = async (
  psbt: string
): Promise<{ txid: string }> => {
  // In production, call backend API:
  // const response = await fetch(`/api/v1/bitcoin/broadcast-psbt`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ psbt })
  // });
  // const data = await response.json();
  // return data;

  console.log('Broadcasting signed PSBT');

  // For demo, return mock transaction ID
  return {
    txid: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  };
};

/**
 * Hardware Wallet Service
 *
 * Main service class for hardware wallet operations
 */
export class HardwareWalletService {
  private connectedDevice: HardwareWalletDevice | null = null;

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
   * Sign a transaction with the connected device
   */
  async signTransaction(tx: TransactionForSigning): Promise<string> {
    if (!this.isConnected() || !this.connectedDevice) {
      throw new Error('No device connected');
    }

    // Create PSBT
    const psbt = await createPSBTForSigning(tx);

    // Sign PSBT with device
    const signed = await signPSBT(this.connectedDevice, {
      psbt,
      inputPaths: ["m/84'/0'/0'/0/0"], // In production, derive from UTXOs
    });

    // Broadcast signed transaction
    const result = await broadcastSignedPSBT(signed.psbt);

    return result.txid;
  }
}

// Export singleton instance
export const hardwareWalletService = new HardwareWalletService();
