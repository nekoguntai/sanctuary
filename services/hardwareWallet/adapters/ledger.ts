/**
 * Ledger Hardware Wallet Adapter
 *
 * Implements DeviceAdapter interface for Ledger devices using WebUSB.
 * Supports Nano S, Nano X, Nano S Plus, Stax, and Flex.
 */

import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import AppBtc from '@ledgerhq/hw-app-btc';
import { AppClient, DefaultWalletPolicy } from 'ledger-bitcoin';
import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../utils/logger';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  XpubResult,
} from '../types';

const log = createLogger('LedgerAdapter');

// Ledger USB vendor ID
const LEDGER_VENDOR_ID = 0x2c97;

// xpub version bytes
const XPUB_VERSION = 0x0488b21e; // Standard xpub (mainnet)
const TPUB_VERSION = 0x043587cf; // Standard tpub (testnet)

// Connection state
interface LedgerConnection {
  transport: TransportWebUSB;
  app: AppBtc;
  appClient: AppClient;
  device: USBDevice;
}

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
      return 'wpkh(@0/**)';
  }
};

/**
 * Infer script type from derivation path
 */
const inferScriptTypeFromPath = (path: string): 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr' => {
  if (path.startsWith("m/84'") || path.startsWith("84'")) {
    return 'p2wpkh';
  }
  if (path.startsWith("m/49'") || path.startsWith("49'")) {
    return 'p2sh-p2wpkh';
  }
  if (path.startsWith("m/44'") || path.startsWith("44'")) {
    return 'p2pkh';
  }
  if (path.startsWith("m/86'") || path.startsWith("86'")) {
    return 'p2tr';
  }
  return 'p2wpkh';
};

/**
 * Extract account path from a full derivation path
 */
const extractAccountPath = (fullPath: string): string => {
  const parts = fullPath.replace(/h/g, "'").split('/');
  if (parts.length >= 4) {
    return parts.slice(0, 4).join('/');
  }
  return fullPath;
};

/**
 * Ledger Device Adapter
 */
export class LedgerAdapter implements DeviceAdapter {
  readonly type: DeviceType = 'ledger';
  readonly requiresBridge = false;
  readonly displayName = 'Ledger';

  private connection: LedgerConnection | null = null;
  private connectedDevice: HardwareWalletDevice | null = null;

  /**
   * Check if WebUSB is supported
   */
  isSupported(): boolean {
    const hasWebUSB = typeof navigator !== 'undefined' && 'usb' in navigator;
    const isSecure = typeof window !== 'undefined' && window.isSecureContext;
    return hasWebUSB && isSecure;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectedDevice !== null && this.connectedDevice.connected;
  }

  /**
   * Get connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.connectedDevice;
  }

  /**
   * Get list of previously authorized Ledger devices
   */
  async getAuthorizedDevices(): Promise<HardwareWalletDevice[]> {
    if (!this.isSupported()) {
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
        connected: device.opened || (this.connection?.device === device),
        fingerprint: undefined,
      }));
    } catch (error) {
      log.error('Failed to enumerate devices', { error });
      return [];
    }
  }

  /**
   * Connect to a Ledger device
   */
  async connect(): Promise<HardwareWalletDevice> {
    if (!this.isSupported()) {
      throw new Error('WebUSB is not supported. Please use Chrome/Edge on HTTPS.');
    }

    // Close existing connection
    if (this.connection) {
      try {
        await this.connection.transport.close();
      } catch {
        // Ignore close errors
      }
      this.connection = null;
    }

    try {
      // Request device permission and create transport
      const transport = await TransportWebUSB.create();
      const device = (transport as any).device as USBDevice;

      // Create Bitcoin app instances
      const app = new AppBtc({ transport });
      const appClient = new AppClient(transport as any);

      // Get master fingerprint
      let fingerprint: string | undefined;
      try {
        fingerprint = await appClient.getMasterFingerprint();
        log.info('Got master fingerprint from device', { fingerprint });
      } catch (error) {
        log.warn('Could not get fingerprint - Bitcoin app may not be open', { error });
      }

      this.connection = { transport: transport as any, app, appClient, device };

      this.connectedDevice = {
        id: getDeviceId(device),
        type: 'ledger',
        name: getLedgerModel(device.productId),
        model: getLedgerModel(device.productId),
        connected: true,
        fingerprint,
      };

      return this.connectedDevice;
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
  }

  /**
   * Disconnect from device
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.transport.close();
      } catch (error) {
        log.warn('Error closing transport', { error });
      }
      this.connection = null;
    }
    this.connectedDevice = null;
  }

  /**
   * Get extended public key
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    try {
      const isTestnet = path.includes("/1'/") || path.includes("/1h/");
      const xpubVersion = isTestnet ? TPUB_VERSION : XPUB_VERSION;

      const xpub = await this.connection.app.getWalletXpub({
        path,
        xpubVersion,
      });

      let fingerprint = '';
      try {
        fingerprint = await this.connection.appClient.getMasterFingerprint();
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
  }

  /**
   * Verify address on device
   */
  async verifyAddress(path: string, _address: string): Promise<boolean> {
    if (!this.connection) {
      throw new Error('No device connected');
    }

    try {
      await this.connection.app.getWalletPublicKey(path, { verify: true });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (message.includes('0x6985') || message.includes('denied')) {
        return false;
      }

      throw new Error(`Failed to verify address: ${message}`);
    }
  }

  /**
   * Sign a PSBT
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    log.info('signPSBT called', {
      hasRequest: !!request,
      psbtLength: request?.psbt?.length || 0,
      inputPathsCount: request?.inputPaths?.length || 0,
      accountPath: request?.accountPath,
      scriptType: request?.scriptType,
    });

    if (!this.connection) {
      log.error('No active connection');
      throw new Error('No device connected');
    }

    try {
      const { appClient } = this.connection;

      // Parse PSBT to extract derivation paths
      const tempPsbt = bitcoin.Psbt.fromBase64(request.psbt);
      let detectedAccountPath: string | null = null;

      for (const input of tempPsbt.data.inputs) {
        if (input.bip32Derivation && input.bip32Derivation.length > 0) {
          const fullPath = input.bip32Derivation[0].path;
          if (fullPath) {
            detectedAccountPath = extractAccountPath(fullPath);
            log.info('Detected account path from PSBT:', { detectedAccountPath });
            break;
          }
        }
      }

      // Determine account path and script type
      let accountPath = request.accountPath || detectedAccountPath;
      let scriptType = request.scriptType;

      if (!accountPath && request.inputPaths && request.inputPaths.length > 0) {
        accountPath = extractAccountPath(request.inputPaths[0]);
      }
      if (!accountPath) {
        accountPath = "m/84'/0'/0'";
      }

      if (!scriptType) {
        scriptType = inferScriptTypeFromPath(accountPath);
      }

      log.info('Using account path and script type', { accountPath, scriptType });

      // Get master fingerprint
      const masterFpHex = await appClient.getMasterFingerprint();
      log.info('Got master fingerprint', { masterFpHex });

      // Get account xpub
      const xpub = await appClient.getExtendedPubkey(accountPath);
      log.info('Got xpub', { xpubPrefix: xpub.substring(0, 20) });

      // Create wallet policy key string
      const pathWithoutM = accountPath.replace(/^m\//, '');
      const keyInfo = `[${masterFpHex}/${pathWithoutM}]${xpub}`;

      // Create DefaultWalletPolicy
      const descriptorTemplate = getDescriptorTemplate(scriptType);
      const walletPolicy = new DefaultWalletPolicy(descriptorTemplate, keyInfo);

      log.info('Created wallet policy', { descriptorTemplate, keyInfo });

      // Parse and fix PSBT fingerprints
      const psbt = bitcoin.Psbt.fromBase64(request.psbt);
      const connectedFpBuffer = Buffer.from(masterFpHex, 'hex');

      let fingerprintMismatchFixed = false;
      let missingBip32Derivation = false;

      psbt.data.inputs.forEach((input, idx) => {
        if (!input.bip32Derivation || input.bip32Derivation.length === 0) {
          missingBip32Derivation = true;
          log.warn(`Input ${idx} is missing bip32Derivation`);
        }

        if (input.bip32Derivation && input.bip32Derivation.length > 0) {
          input.bip32Derivation.forEach((deriv) => {
            const fpHex = deriv.masterFingerprint.toString('hex');
            const matches = fpHex.toLowerCase() === masterFpHex.toLowerCase();

            if (!matches) {
              log.warn(`Updating fingerprint from ${fpHex} to ${masterFpHex} for input ${idx}`);
              deriv.masterFingerprint = connectedFpBuffer;
              fingerprintMismatchFixed = true;
            }
          });
        }
      });

      if (fingerprintMismatchFixed) {
        log.info('Fixed fingerprint mismatches in PSBT');
      }

      if (missingBip32Derivation) {
        log.error('PSBT is missing bip32Derivation data - Ledger requires this');
      }

      // Sign the PSBT
      const updatedPsbtBase64 = psbt.toBase64();
      log.info('Calling appClient.signPsbt...');

      const signatures = await appClient.signPsbt(updatedPsbtBase64, walletPolicy, null);

      log.info('Got signatures from device', { signatureCount: signatures.length });

      // Apply signatures to PSBT
      for (const [inputIndex, partialSig] of signatures) {
        psbt.updateInput(inputIndex, {
          partialSig: [{
            pubkey: partialSig.pubkey,
            signature: partialSig.signature,
          }],
        });
      }

      // Finalize
      psbt.finalizeAllInputs();

      log.info('PSBT signed and finalized successfully', { signatureCount: signatures.length });

      return {
        psbt: psbt.toBase64(),
        signatures: signatures.length,
        // Ledger returns signed PSBT, not raw tx
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
  }
}
