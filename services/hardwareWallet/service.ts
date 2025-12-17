/**
 * Hardware Wallet Service
 *
 * Main service class that manages hardware wallet connections using a registry pattern.
 * Supports multiple device types through pluggable adapters.
 *
 * To add support for a new device:
 * 1. Create an adapter implementing DeviceAdapter interface
 * 2. Register it with service.registerAdapter(new MyDeviceAdapter())
 */

import { createLogger } from '../../utils/logger';
import apiClient from '../../src/api/client';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  TransactionForSigning,
  XpubResult,
} from './types';

const log = createLogger('HardwareWalletService');

/**
 * Hardware Wallet Service
 *
 * Manages device adapters and routes operations to the correct implementation.
 */
export class HardwareWalletService {
  private adapters: Map<DeviceType, DeviceAdapter> = new Map();
  private activeAdapter: DeviceAdapter | null = null;

  /**
   * Register a device adapter
   * @param adapter The adapter to register
   */
  registerAdapter(adapter: DeviceAdapter): void {
    this.adapters.set(adapter.type, adapter);
    log.info(`Registered adapter: ${adapter.displayName}`, { type: adapter.type });
  }

  /**
   * Get all registered adapters
   */
  getRegisteredAdapters(): DeviceAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get adapter for a specific device type
   */
  getAdapter(type: DeviceType): DeviceAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Check if a device type is supported
   * @param type Optional device type - if not specified, checks if any adapter is available
   */
  isSupported(type?: DeviceType): boolean {
    if (type) {
      const adapter = this.adapters.get(type);
      return adapter ? adapter.isSupported() : false;
    }
    // Check if any adapter is supported
    return Array.from(this.adapters.values()).some(a => a.isSupported());
  }

  /**
   * Check if a device is currently connected
   */
  isConnected(): boolean {
    return this.activeAdapter?.isConnected() ?? false;
  }

  /**
   * Get the currently connected device
   */
  getDevice(): HardwareWalletDevice | null {
    return this.activeAdapter?.getDevice() ?? null;
  }

  /**
   * Get all authorized devices (from all adapters that support it)
   */
  async getDevices(): Promise<HardwareWalletDevice[]> {
    const allDevices: HardwareWalletDevice[] = [];

    for (const adapter of this.adapters.values()) {
      if (adapter.getAuthorizedDevices) {
        try {
          const devices = await adapter.getAuthorizedDevices();
          allDevices.push(...devices);
        } catch (error) {
          log.warn(`Failed to get devices from ${adapter.displayName}`, { error });
        }
      }
    }

    return allDevices;
  }

  /**
   * Connect to a device
   * @param type Device type to connect to
   */
  async connect(type?: DeviceType): Promise<HardwareWalletDevice> {
    // If no type specified and only one adapter, use it
    if (!type) {
      if (this.adapters.size === 1) {
        type = this.adapters.keys().next().value;
      } else {
        throw new Error('Device type must be specified when multiple adapters are registered');
      }
    }

    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`No adapter registered for device type: ${type}`);
    }

    if (!adapter.isSupported()) {
      throw new Error(`${adapter.displayName} is not supported in this environment`);
    }

    // Disconnect any active adapter
    if (this.activeAdapter && this.activeAdapter !== adapter) {
      try {
        await this.activeAdapter.disconnect();
      } catch (error) {
        log.warn('Error disconnecting previous adapter', { error });
      }
    }

    // Connect with the new adapter
    const device = await adapter.connect();
    this.activeAdapter = adapter;

    log.info(`Connected to ${adapter.displayName}`, {
      deviceId: device.id,
      model: device.model,
    });

    return device;
  }

  /**
   * Disconnect from the current device
   */
  async disconnect(): Promise<void> {
    if (this.activeAdapter) {
      await this.activeAdapter.disconnect();
      log.info(`Disconnected from ${this.activeAdapter.displayName}`);
      this.activeAdapter = null;
    }
  }

  /**
   * Get extended public key from the connected device
   * @param path BIP32 derivation path
   */
  async getXpub(path: string): Promise<XpubResult> {
    if (!this.activeAdapter) {
      throw new Error('No device connected');
    }
    return this.activeAdapter.getXpub(path);
  }

  /**
   * Sign a PSBT with the connected device
   * @param request PSBT signing request
   */
  async signPSBT(request: PSBTSignRequest): Promise<PSBTSignResponse> {
    if (!this.activeAdapter) {
      throw new Error('No device connected');
    }
    return this.activeAdapter.signPSBT(request);
  }

  /**
   * Verify an address on the device display
   * @param path Derivation path
   * @param address Address to verify
   */
  async verifyAddress(path: string, address: string): Promise<boolean> {
    if (!this.activeAdapter) {
      throw new Error('No device connected');
    }
    if (!this.activeAdapter.verifyAddress) {
      throw new Error(`${this.activeAdapter.displayName} does not support address verification`);
    }
    return this.activeAdapter.verifyAddress(path, address);
  }

  /**
   * Full transaction signing flow
   * Creates PSBT, signs with device, and broadcasts
   */
  async signTransaction(tx: TransactionForSigning): Promise<string> {
    if (!this.isConnected()) {
      throw new Error('No device connected');
    }

    // Create PSBT via backend
    const { psbt, inputPaths } = await createPSBTForSigning(tx);

    // Sign with connected device
    const signed = await this.signPSBT({ psbt, inputPaths });

    // Broadcast - use rawTx if available (Trezor), otherwise use signed PSBT
    const result = await broadcastSignedTransaction(tx.walletId, signed.psbt, signed.rawTx);

    return result.txid;
  }
}

/**
 * Create a PSBT for signing via the backend API
 */
async function createPSBTForSigning(
  tx: TransactionForSigning
): Promise<{ psbt: string; fee: number; inputPaths: string[] }> {
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
}

/**
 * Broadcast a signed transaction to the Bitcoin network
 */
async function broadcastSignedTransaction(
  walletId: string,
  psbt: string,
  rawTx?: string
): Promise<{ txid: string }> {
  const response = await apiClient.post<{ txid: string }>(
    `/wallets/${walletId}/psbt/broadcast`,
    {
      signedPsbt: psbt,
      rawTxHex: rawTx, // For Trezor
    }
  );

  return response;
}

/**
 * Create and configure the default service instance
 */
export function createHardwareWalletService(): HardwareWalletService {
  const service = new HardwareWalletService();

  // Adapters are registered lazily in index.ts to avoid circular imports
  // and to allow tree-shaking of unused adapters

  return service;
}
