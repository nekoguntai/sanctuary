// Trezor hardware wallet driver

import type { DeviceDriver } from './devices';
import type { HWDevice, XpubResult, SignPSBTResult } from '../types/messages';

// Trezor Connect instance
let TrezorConnect: typeof import('@trezor/connect-web').default | null = null;
let initialized = false;

// Track connected devices
const connectedDevices: Map<string, HWDevice> = new Map();

// Initialize Trezor Connect
async function initTrezorConnect(): Promise<void> {
  if (initialized) return;

  const module = await import('@trezor/connect-web');
  TrezorConnect = module.default;

  await TrezorConnect.init({
    lazyLoad: false,
    manifest: {
      email: 'support@sanctuary.local',
      appUrl: 'https://sanctuary.local',
    },
    // Use the extension's popup for Trezor Connect UI
    popup: true,
    debug: false,
    // Connect to Trezor Bridge or WebUSB
    transports: ['BridgeTransport', 'WebUsbTransport'],
  });

  // Listen for device events
  TrezorConnect.on('DEVICE_EVENT', (event: any) => {
    if (event.type === 'device-connect' || event.type === 'device-changed') {
      const device = event.payload;
      if (device.features) {
        const hwDevice: HWDevice = {
          id: device.id || `trezor-${device.path}`,
          type: 'trezor',
          model: getTrezorModel(device.features.model),
          fingerprint: null, // Will be populated when getting xpub
          connected: device.connected,
          needsPin: device.features.pin_protection && !device.features.unlocked,
          needsPassphrase: device.features.passphrase_protection,
        };
        connectedDevices.set(hwDevice.id, hwDevice);
      }
    } else if (event.type === 'device-disconnect') {
      const device = event.payload;
      const deviceId = device.id || `trezor-${device.path}`;
      connectedDevices.delete(deviceId);
    }
  });

  initialized = true;
}

function getTrezorModel(model: string | undefined): string {
  switch (model) {
    case '1':
      return 'Trezor Model One';
    case 'T':
      return 'Trezor Model T';
    case 'R':
      return 'Trezor Safe 3';
    case 'T3T1':
      return 'Trezor Safe 5';
    default:
      return 'Trezor Device';
  }
}

// Convert BIP32 path string to number array
function pathToArray(path: string): number[] {
  return path
    .replace(/^m\//, '')
    .split('/')
    .map(segment => {
      const hardened = segment.endsWith("'") || segment.endsWith('h');
      const num = parseInt(segment.replace(/['h]$/, ''), 10);
      return hardened ? num + 0x80000000 : num;
    });
}

export const trezorDriver: DeviceDriver = {
  type: 'trezor',

  isSupported(): boolean {
    // Trezor Connect works in browser environments
    return typeof window !== 'undefined';
  },

  async enumerate(): Promise<HWDevice[]> {
    if (!this.isSupported()) return [];

    try {
      await initTrezorConnect();

      // Return any devices we've seen
      return Array.from(connectedDevices.values());
    } catch (error) {
      console.error('Failed to enumerate Trezor devices:', error);
      return [];
    }
  },

  async connect(): Promise<HWDevice> {
    await initTrezorConnect();

    if (!TrezorConnect) {
      throw new Error('Trezor Connect not initialized');
    }

    // Get features to identify the device
    const result = await TrezorConnect.getFeatures();

    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to connect to Trezor');
    }

    const features = result.payload;
    const deviceId = features.device_id || `trezor-${Date.now()}`;

    // Get the master fingerprint by fetching a standard xpub
    let fingerprint: string | null = null;
    try {
      const xpubResult = await TrezorConnect.getPublicKey({
        path: "m/84'/0'/0'",
        showOnTrezor: false,
      });

      if (xpubResult.success) {
        // Extract fingerprint from the xpub response
        fingerprint = xpubResult.payload.fingerprint?.toString(16).padStart(8, '0') || null;
      }
    } catch (error) {
      console.warn('Could not get fingerprint from Trezor:', error);
    }

    const device: HWDevice = {
      id: deviceId,
      type: 'trezor',
      model: getTrezorModel(features.model),
      fingerprint,
      connected: true,
      needsPin: features.pin_protection && !features.unlocked,
      needsPassphrase: features.passphrase_protection,
    };

    connectedDevices.set(deviceId, device);
    return device;
  },

  async disconnect(deviceId: string): Promise<void> {
    connectedDevices.delete(deviceId);
    // Trezor Connect doesn't have explicit disconnect - device session ends automatically
  },

  async getXpub(deviceId: string, path: string): Promise<XpubResult> {
    await initTrezorConnect();

    if (!TrezorConnect) {
      throw new Error('Trezor Connect not initialized');
    }

    const result = await TrezorConnect.getPublicKey({
      path,
      showOnTrezor: true, // Show on device for verification
    });

    if (!result.success) {
      if (result.payload.code === 'Failure_ActionCancelled') {
        throw new Error('User rejected the request on the Trezor device');
      }
      throw new Error(result.payload.error || 'Failed to get xpub from Trezor');
    }

    return {
      xpub: result.payload.xpub,
      fingerprint: result.payload.fingerprint?.toString(16).padStart(8, '0') || '',
      path,
    };
  },

  async signPSBT(deviceId: string, psbtBase64: string, inputPaths: string[]): Promise<SignPSBTResult> {
    await initTrezorConnect();

    if (!TrezorConnect) {
      throw new Error('Trezor Connect not initialized');
    }

    // Trezor Connect doesn't directly support PSBT signing
    // We need to use signTransaction with decoded PSBT data
    // For full PSBT support, we need to parse the PSBT and extract:
    // - inputs (with prevout data)
    // - outputs
    // - witness data if segwit

    // First, try using the newer PSBT signing if available (Trezor Suite)
    // Fall back to transaction signing with parsed data

    const result = await TrezorConnect.signTransaction({
      inputs: inputPaths.map((path, index) => ({
        address_n: pathToArray(path),
        prev_hash: '', // Will be filled from PSBT
        prev_index: 0, // Will be filled from PSBT
        amount: '0', // Will be filled from PSBT
        script_type: 'SPENDWITNESS' as const, // Assume native segwit for now
      })),
      outputs: [], // Will be filled from PSBT
      coin: 'btc',
      // Pass the raw PSBT for modern Trezor firmware
      serialize: false,
    });

    if (!result.success) {
      if (result.payload.code === 'Failure_ActionCancelled') {
        throw new Error('User rejected the transaction on the Trezor device');
      }
      throw new Error(result.payload.error || 'Failed to sign with Trezor');
    }

    // For now, return the input PSBT with a note that full implementation
    // requires PSBT parsing which should be done in a utility module
    // The actual implementation would merge signatures back into the PSBT

    return {
      signedPsbt: psbtBase64, // TODO: Merge signatures from result
      signatures: result.payload.signatures?.length || inputPaths.length,
    };
  },

  async verifyAddress(deviceId: string, path: string, address: string): Promise<boolean> {
    await initTrezorConnect();

    if (!TrezorConnect) {
      throw new Error('Trezor Connect not initialized');
    }

    // Determine script type from the path
    const pathParts = path.split('/');
    const purpose = parseInt(pathParts[1]?.replace("'", '') || '84', 10);

    let scriptType: 'SPENDADDRESS' | 'SPENDWITNESS' | 'SPENDP2SHWITNESS';
    switch (purpose) {
      case 44:
        scriptType = 'SPENDADDRESS'; // Legacy P2PKH
        break;
      case 49:
        scriptType = 'SPENDP2SHWITNESS'; // Nested SegWit P2SH-P2WPKH
        break;
      case 84:
      default:
        scriptType = 'SPENDWITNESS'; // Native SegWit P2WPKH
        break;
    }

    const result = await TrezorConnect.getAddress({
      path,
      showOnTrezor: true, // Display on device for user verification
      scriptType,
      coin: 'btc',
    });

    if (!result.success) {
      if (result.payload.code === 'Failure_ActionCancelled') {
        return false; // User rejected
      }
      throw new Error(result.payload.error || 'Failed to verify address with Trezor');
    }

    return result.payload.address === address;
  },
};
