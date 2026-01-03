/**
 * Export Format Registry
 *
 * Central registry for wallet export format handlers.
 * Supports multiple export formats for interoperability.
 *
 * Usage:
 *   import { exportFormatRegistry } from './export';
 *
 *   // Get available formats for a wallet
 *   const formats = exportFormatRegistry.getAvailableFormats(walletData);
 *
 *   // Export in Sparrow format
 *   const result = exportFormatRegistry.export('sparrow', walletData, {
 *     includeDevices: true,
 *     includeChangeDescriptor: true,
 *   });
 *
 * Adding new formats:
 *   1. Create handler in handlers/ directory implementing ExportFormatHandler
 *   2. Import and register below
 */

import { exportFormatRegistry } from './registry';

// Import handlers
import { sparrowHandler } from './handlers/sparrow';
import { descriptorHandler } from './handlers/descriptor';
import { bluewalletHandler } from './handlers/bluewallet';

// Register handlers
exportFormatRegistry.register(sparrowHandler);
exportFormatRegistry.register(descriptorHandler);
exportFormatRegistry.register(bluewalletHandler);

// Export the registry and types
export { exportFormatRegistry } from './registry';
export type {
  ExportFormatHandler,
  WalletExportData,
  DeviceExportData,
  ExportOptions,
  ExportResult,
} from './types';

// Export individual handlers for direct use if needed
export { sparrowHandler } from './handlers/sparrow';
export { descriptorHandler } from './handlers/descriptor';
export { bluewalletHandler } from './handlers/bluewallet';
