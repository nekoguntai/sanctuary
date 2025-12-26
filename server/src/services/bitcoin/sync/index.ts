/**
 * Sync Module
 *
 * Re-exports all sync-related functions for wallet synchronization.
 */

export { ensureGapLimit } from './addressDiscovery';

export {
  updateTransactionConfirmations,
  populateMissingTransactionFields,
  type ConfirmationUpdate,
  type PopulateFieldsResult,
} from './confirmations';
