/**
 * Telegram Notification Channel Handler
 *
 * Wraps the existing Telegram service as a notification channel.
 */

import * as telegramService from '../../telegram/telegramService';
import type {
  NotificationChannelHandler,
  TransactionNotification,
  DraftNotification,
  NotificationResult,
} from './types';

export const telegramChannelHandler: NotificationChannelHandler = {
  id: 'telegram',
  name: 'Telegram',
  description: 'Send notifications via Telegram bot',
  capabilities: {
    supportsTransactions: true,
    supportsDrafts: true,
    supportsRichFormatting: true,
    supportsImages: false,
  },

  async isEnabled(): Promise<boolean> {
    // Telegram is always available - user config determines if notifications are sent
    return true;
  },

  async notifyTransactions(
    walletId: string,
    transactions: TransactionNotification[]
  ): Promise<NotificationResult> {
    try {
      // Convert to telegramService format
      const txData = transactions.map((tx) => ({
        txid: tx.txid,
        type: tx.type,
        amount: tx.amount,
      }));

      await telegramService.notifyNewTransactions(walletId, txData);

      return {
        success: true,
        channelId: 'telegram',
        usersNotified: 1, // Telegram service handles user lookup internally
      };
    } catch (err) {
      return {
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  },

  async notifyDraft(
    walletId: string,
    draft: DraftNotification,
    createdByUserId: string
  ): Promise<NotificationResult> {
    try {
      await telegramService.notifyNewDraft(walletId, draft, createdByUserId);

      return {
        success: true,
        channelId: 'telegram',
        usersNotified: 1,
      };
    } catch (err) {
      return {
        success: false,
        channelId: 'telegram',
        usersNotified: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  },
};
