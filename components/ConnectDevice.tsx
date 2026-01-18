/**
 * ConnectDevice Component
 *
 * Re-export from the refactored module for backwards compatibility.
 * The component has been split into smaller, focused modules:
 *
 * @see ./ConnectDevice/ConnectDevice.tsx - Main orchestrator
 * @see ./ConnectDevice/types.ts - Shared types
 * @see ../hooks/useDeviceModels.ts - Device model state
 * @see ../hooks/useDeviceSave.ts - Save operations
 * @see ../hooks/useQrScanner.ts - QR scanning state
 * @see ../hooks/useDeviceConnection.ts - USB connection state
 * @see ../utils/deviceConnection.ts - Connection utilities
 * @see ../utils/urDeviceDecoder.ts - UR decoding utilities
 */

export { ConnectDevice } from './ConnectDevice/index';
