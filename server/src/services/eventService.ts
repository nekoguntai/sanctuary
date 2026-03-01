/**
 * Event Service - Re-export shim
 *
 * This file re-exports from the modularized event/ directory
 * to preserve existing import paths.
 *
 * @see ./event/ for the modularized implementation
 */

export { eventService, default } from './event';

export type {
  WalletSyncResult,
  TransactionBroadcastResult,
  TransactionReceivedData,
  TransactionConfirmationData,
  BalanceChangeData,
  WalletCreatedData,
  UserLoginData,
  DeviceRegisteredData,
} from './event';
