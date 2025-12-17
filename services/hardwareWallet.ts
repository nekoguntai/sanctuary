/**
 * Hardware Wallet Integration Service
 *
 * This file re-exports from the modular hardware wallet implementation
 * for backward compatibility with existing imports.
 *
 * The actual implementation is now in:
 * - ./hardwareWallet/types.ts - Type definitions and DeviceAdapter interface
 * - ./hardwareWallet/adapters/ - Device-specific implementations
 * - ./hardwareWallet/service.ts - Main service class with registry pattern
 * - ./hardwareWallet/index.ts - Main exports
 *
 * New device support can be added by creating an adapter implementing
 * the DeviceAdapter interface and registering it with the service.
 */

// Re-export everything from the modular implementation
export {
  // Types
  type DeviceType,
  type DeviceAdapter,
  type HardwareWalletDevice,
  type PSBTSignRequest,
  type PSBTSignResponse,
  type TransactionForSigning,
  type XpubResult,

  // Adapters
  LedgerAdapter,
  TrezorAdapter,

  // Service
  HardwareWalletService,
  createHardwareWalletService,

  // Utility functions
  isWebUSBSupported,
  isSecureContext,
  isHardwareWalletSupported,
  getConnectedDevices,

  // Singleton instance
  hardwareWalletService,
} from './hardwareWallet/index';
