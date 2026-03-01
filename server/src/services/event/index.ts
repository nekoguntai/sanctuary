/**
 * Event Service Module
 *
 * Barrel file re-exporting the unified event service and all types.
 */

// Main service singleton
export { eventService, default } from './eventService';

// Types
export type {
  WalletSyncResult,
  TransactionBroadcastResult,
  TransactionReceivedData,
  TransactionConfirmationData,
  BalanceChangeData,
  WalletCreatedData,
  UserLoginData,
  DeviceRegisteredData,
} from './types';
