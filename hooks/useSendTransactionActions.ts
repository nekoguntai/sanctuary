/**
 * useSendTransactionActions Hook - Re-export shim
 *
 * This file preserves backward compatibility for existing imports.
 * The implementation has been modularized into hooks/send/.
 *
 * @see hooks/send/useSendTransactionActions.ts - Orchestrator
 * @see hooks/send/useUsbSigning.ts - USB hardware wallet signing
 * @see hooks/send/useQrSigning.ts - QR/airgap signing
 * @see hooks/send/useDraftManagement.ts - Draft save/load
 * @see hooks/send/usePayjoin.ts - Payjoin negotiation
 * @see hooks/send/useBroadcast.ts - Transaction broadcasting
 */

export { useSendTransactionActions } from './send/useSendTransactionActions';
export type {
  TransactionData,
  UseSendTransactionActionsProps,
  UseSendTransactionActionsResult,
} from './send/types';
