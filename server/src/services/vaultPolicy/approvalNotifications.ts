/**
 * Approval Notifications
 *
 * Dispatches notifications for approval workflow events.
 * Uses the existing notification channel registry pattern.
 */

import { notificationChannelRegistry } from '../notifications/channels';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

const log = createLogger('APPROVAL_NOTIFY');

/**
 * Notify approvers that a new approval is required.
 */
export async function notifyApprovalRequested(
  walletId: string,
  draftId: string,
  createdByUserId: string
): Promise<void> {
  log.debug('Sending approval requested notification', { walletId, draftId });

  // Use the draft notification channel as the closest match —
  // channels that support drafts will also receive approval requests.
  // The channel handlers check per-wallet notification settings.
  const handlers = notificationChannelRegistry.getDraftCapable();

  for (const handler of handlers) {
    try {
      const isEnabled = await handler.isEnabled();
      if (!isEnabled || !handler.notifyDraft) continue;

      // Re-use the draft notification with a special label indicating approval
      await handler.notifyDraft(walletId, {
        id: draftId,
        amount: BigInt(0), // Will be resolved by the channel from the draft
        recipient: '',
        label: '[Approval Required]',
        feeRate: 0,
      }, createdByUserId);
    } catch (err) {
      log.warn(`Failed to send approval notification via ${handler.id}`, {
        error: getErrorMessage(err),
      });
    }
  }
}

/**
 * Notify relevant users that an approval was resolved.
 */
export async function notifyApprovalResolved(
  walletId: string,
  draftId: string,
  resolution: 'approved' | 'rejected' | 'vetoed' | 'overridden',
  resolvedByUserId: string | null
): Promise<void> {
  log.debug('Sending approval resolved notification', { walletId, draftId, resolution });

  // For now, log the resolution. Full channel integration comes when
  // the notification channel interface is extended with approval-specific methods.
  log.info('Approval resolved', { walletId, draftId, resolution, resolvedByUserId });
}
