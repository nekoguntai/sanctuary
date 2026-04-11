/**
 * Device Account Conflict Detection
 *
 * Compatibility re-export for callers that imported the helper from the
 * device API module before the registration flow moved into services.
 */

export {
  compareAccounts,
  normalizeIncomingAccounts,
} from '../../services/deviceAccountConflicts';

export type {
  AccountComparisonResult,
  DeviceAccountInput,
} from '../../services/deviceAccountConflicts';
