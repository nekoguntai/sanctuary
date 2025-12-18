/**
 * Unified Notification Service
 *
 * Central dispatcher for all notification channels (Telegram, Push).
 * Call this service from blockchain.ts when new transactions are detected.
 */

import * as telegramService from '../telegram/telegramService';
import * as pushService from '../push/pushService';
import { createLogger } from '../../utils/logger';

const log = createLogger('NOTIFY');

export interface TransactionData {
  txid: string;
  type: string;
  amount: bigint;
}

export interface DraftData {
  id: string;
  amount: bigint;
  recipient: string;
  label?: string | null;
  feeRate: number;
}

/**
 * Notify all eligible users about new transactions
 *
 * Dispatches notifications to all configured channels:
 * - Telegram (if user has configured bot token and chat ID)
 * - Push (if user has registered mobile devices)
 *
 * Each channel checks its own per-wallet settings independently.
 *
 * @param walletId - The wallet that received/sent transactions
 * @param transactions - Array of new transactions to notify about
 */
export async function notifyNewTransactions(
  walletId: string,
  transactions: TransactionData[]
): Promise<void> {
  if (transactions.length === 0) return;

  log.debug(`Sending notifications for ${transactions.length} transactions in wallet ${walletId}`);

  // Dispatch to all notification channels in parallel
  const results = await Promise.allSettled([
    telegramService.notifyNewTransactions(walletId, transactions),
    pushService.notifyNewTransactions(walletId, transactions),
  ]);

  // Log any failures (but don't throw - notifications are best-effort)
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      const channelName = i === 0 ? 'Telegram' : 'Push';
      log.error(`${channelName} notification failed: ${result.reason}`);
    }
  }
}

/**
 * Notify all eligible users about a new draft transaction
 *
 * Useful for multi-user wallets where one person creates the draft
 * and another needs to sign it with their hardware wallet.
 *
 * @param walletId - The wallet the draft was created for
 * @param draft - The draft transaction data
 * @param createdByUserId - The user who created the draft (won't be notified)
 */
export async function notifyNewDraft(
  walletId: string,
  draft: DraftData,
  createdByUserId: string
): Promise<void> {
  log.debug(`Sending draft notification for wallet ${walletId}`);

  // Currently only Telegram supports draft notifications
  // Push can be added later if needed
  try {
    await telegramService.notifyNewDraft(walletId, draft, createdByUserId);
  } catch (err) {
    log.error(`Draft notification failed: ${err}`);
  }
}
