// Ledger hardware wallet driver

import type { DeviceDriver } from './devices';
import type { HWDevice, XpubResult, SignPSBTResult } from '../types/messages';

// Ledger USB vendor ID
const LEDGER_VENDOR_ID = 0x2c97;

// Model IDs for different Ledger devices
const LEDGER_MODELS: Record<number, string> = {
  0x0001: 'Ledger Nano S',
  0x0004: 'Ledger Nano X',
  0x0005: 'Ledger Nano S Plus',
  0x0006: 'Ledger Stax',
  0x0007: 'Ledger Flex',
};

interface LedgerConnection {
  device: USBDevice;
  transport: any; // TransportWebUSB instance
  app: any; // AppBtc instance
}

// Active connections keyed by device ID
const connections: Map<string, LedgerConnection> = new Map();

// Generate a stable device ID from USB device
function getDeviceId(device: USBDevice): string {
  return `ledger-${device.vendorId}-${device.productId}-${device.serialNumber || 'unknown'}`;
}

// Get model name from product ID
function getModelName(productId: number): string {
  return LEDGER_MODELS[productId] || 'Ledger Device';
}

export const ledgerDriver: DeviceDriver = {
  type: 'ledger',

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  },

  async enumerate(): Promise<HWDevice[]> {
    if (!this.isSupported()) return [];

    try {
      // Get already-paired devices
      const devices = await navigator.usb.getDevices();
      const ledgerDevices = devices.filter(d => d.vendorId === LEDGER_VENDOR_ID);

      return ledgerDevices.map(device => ({
        id: getDeviceId(device),
        type: 'ledger' as const,
        model: getModelName(device.productId),
        fingerprint: null, // Will be populated on connect
        connected: device.opened,
      }));
    } catch (error) {
      console.error('Failed to enumerate Ledger devices:', error);
      return [];
    }
  },

  async connect(): Promise<HWDevice> {
    if (!this.isSupported()) {
      throw new Error('WebUSB not supported');
    }

    // Dynamic imports to handle the Ledger libraries
    const [{ default: TransportWebUSB }, { default: AppBtc }] = await Promise.all([
      import('@ledgerhq/hw-transport-webusb'),
      import('@ledgerhq/hw-app-btc'),
    ]);

    // Request device from user (shows browser popup)
    const transport = await TransportWebUSB.create();
    const device = transport.device as USBDevice;
    const deviceId = getDeviceId(device);

    // Create Bitcoin app instance
    const app = new AppBtc({ transport });

    // Get master fingerprint by deriving the master key
    let fingerprint: string | null = null;
    try {
      // Get the master public key to derive fingerprint
      const masterKey = await app.getWalletXpub({ path: "m/0'" });
      // The fingerprint is typically in the xpub response or we derive it
      // For now, we'll get it from a standard derivation
      const result = await app.getWalletXpub({ path: "m/84'/0'/0'" });
      // Extract fingerprint from the extended key response
      fingerprint = result.masterFingerprint?.toString(16).padStart(8, '0') || null;
    } catch (error) {
      console.warn('Could not get fingerprint from Ledger:', error);
    }

    // Store the connection
    connections.set(deviceId, { device, transport, app });

    return {
      id: deviceId,
      type: 'ledger',
      model: getModelName(device.productId),
      fingerprint,
      connected: true,
    };
  },

  async disconnect(deviceId: string): Promise<void> {
    const connection = connections.get(deviceId);
    if (connection) {
      try {
        await connection.transport.close();
      } catch (error) {
        console.warn('Error closing Ledger transport:', error);
      }
      connections.delete(deviceId);
    }
  },

  async getXpub(deviceId: string, path: string): Promise<XpubResult> {
    let connection = connections.get(deviceId);

    if (!connection) {
      // Try to reconnect
      const device = await this.connect();
      if (device.id !== deviceId) {
        throw new Error('Connected device does not match requested device ID');
      }
      connection = connections.get(deviceId);
    }

    if (!connection) {
      throw new Error('Failed to connect to Ledger device');
    }

    try {
      const result = await connection.app.getWalletXpub({ path });

      return {
        xpub: result.xpub,
        fingerprint: result.masterFingerprint?.toString(16).padStart(8, '0') || '',
        path,
      };
    } catch (error: any) {
      if (error.statusCode === 0x6985) {
        throw new Error('User rejected the request on the Ledger device');
      }
      if (error.statusCode === 0x6a82) {
        throw new Error('Bitcoin app not open on Ledger device');
      }
      throw new Error(`Ledger error: ${error.message || error}`);
    }
  },

  async signPSBT(deviceId: string, psbtBase64: string, inputPaths: string[]): Promise<SignPSBTResult> {
    const connection = connections.get(deviceId);
    if (!connection) {
      throw new Error('Ledger device not connected');
    }

    try {
      // Decode the PSBT from base64
      const psbtBuffer = Buffer.from(psbtBase64, 'base64');

      // The new Ledger Bitcoin app uses a different signing method
      // We need to use signPsbt which handles PSBT format directly
      const result = await connection.app.signPsbt(psbtBuffer, inputPaths);

      // The result contains the signed PSBT
      const signedPsbtBase64 = Buffer.from(result.psbt).toString('base64');

      return {
        signedPsbt: signedPsbtBase64,
        signatures: result.signatures?.length || inputPaths.length,
      };
    } catch (error: any) {
      if (error.statusCode === 0x6985) {
        throw new Error('User rejected the transaction on the Ledger device');
      }
      if (error.statusCode === 0x6a82) {
        throw new Error('Bitcoin app not open on Ledger device');
      }
      if (error.statusCode === 0x6f00) {
        throw new Error('Ledger device error - please reconnect the device');
      }
      throw new Error(`Ledger signing error: ${error.message || error}`);
    }
  },

  async verifyAddress(deviceId: string, path: string, address: string): Promise<boolean> {
    const connection = connections.get(deviceId);
    if (!connection) {
      throw new Error('Ledger device not connected');
    }

    try {
      // Display the address on the Ledger screen for verification
      const result = await connection.app.getWalletAddress(
        path,
        true, // display on device
        undefined, // account (optional)
        undefined, // change (optional)
        undefined, // address index (optional)
      );

      // Compare the returned address with the expected one
      return result.address === address;
    } catch (error: any) {
      if (error.statusCode === 0x6985) {
        // User rejected - address didn't match or user cancelled
        return false;
      }
      throw new Error(`Ledger address verification error: ${error.message || error}`);
    }
  },
};
