/**
 * Hardware Wallet Integration
 *
 * Main entry point for hardware wallet functionality.
 * Provides a pre-configured service instance with all adapters registered.
 *
 * Usage:
 *   import { hardwareWalletService, isHardwareWalletSupported } from '../services/hardwareWallet';
 *
 *   // Connect to a device
 *   await hardwareWalletService.connect('ledger');
 *
 *   // Sign a PSBT
 *   const result = await hardwareWalletService.signPSBT({ psbt, inputPaths });
 *
 * To add a new device type:
 *   1. Create adapter in ./adapters/mydevice.ts implementing DeviceAdapter
 *   2. Export from ./adapters/index.ts
 *   3. Register below: service.registerAdapter(new MyDeviceAdapter())
 */

// Re-export types
export type {
  DeviceType,
  DeviceAdapter,
  HardwareWalletDevice,
  PSBTSignRequest,
  PSBTSignResponse,
  TransactionForSigning,
  XpubResult,
} from './types';

// Re-export adapters
export { LedgerAdapter, TrezorAdapter } from './adapters';

// Re-export service class
export { HardwareWalletService, createHardwareWalletService } from './service';

// Import for setup
import { HardwareWalletService } from './service';
import { LedgerAdapter } from './adapters/ledger';
import { TrezorAdapter } from './adapters/trezor';

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
 * For WebUSB devices (Ledger), requires HTTPS
 * For bridge devices (Trezor), always supported
 */
export const isHardwareWalletSupported = (): boolean => {
  return isWebUSBSupported() && isSecureContext();
};

/**
 * Get list of previously authorized devices
 * Backward compatibility function
 */
export const getConnectedDevices = async (): Promise<import('./types').HardwareWalletDevice[]> => {
  return hardwareWalletService.getDevices();
};

/**
 * Pre-configured service instance with all adapters registered
 *
 * Supported devices:
 * - Ledger (Nano S, Nano X, Nano S Plus, Stax, Flex) via WebUSB
 * - Trezor (Model One, Model T, Safe 3/5/7) via Trezor Suite bridge
 *
 * Adding new devices:
 * 1. Create an adapter class implementing DeviceAdapter interface
 * 2. Register it: hardwareWalletService.registerAdapter(new MyAdapter())
 */
const createDefaultService = (): HardwareWalletService => {
  const service = new HardwareWalletService();

  // Register built-in adapters
  service.registerAdapter(new LedgerAdapter());
  service.registerAdapter(new TrezorAdapter());

  // Future adapters can be added here:
  // service.registerAdapter(new ColdcardAdapter());
  // service.registerAdapter(new BitBoxAdapter());
  // service.registerAdapter(new JadeAdapter());

  return service;
};

/**
 * Singleton service instance
 */
export const hardwareWalletService = createDefaultService();
