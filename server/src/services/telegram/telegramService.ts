/**
 * Telegram Notification Service
 *
 * Sends transaction notifications to users via their own Telegram bots.
 * Each user provides their own bot token and chat ID.
 */

import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';

const log = createLogger('TELEGRAM');

const TELEGRAM_API = 'https://api.telegram.org/bot';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  wallets: Record<string, WalletTelegramSettings>;
}

export interface WalletTelegramSettings {
  enabled: boolean;
  notifyReceived: boolean;
  notifySent: boolean;
  notifyConsolidation: boolean;
}

export interface TransactionData {
  txid: string;
  type: string;
  amount: bigint;
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(
      `${TELEGRAM_API}${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = (errorData as any)?.description || `HTTP ${response.status}`;
      log.error(`Telegram API error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    log.error(`Telegram send failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Test Telegram configuration by sending a test message
 */
export async function testTelegramConfig(
  botToken: string,
  chatId: string
): Promise<{ success: boolean; error?: string }> {
  const testMessage =
    '🔔 <b>Sanctuary Test Message</b>\n\n' +
    'Your Telegram notifications are configured correctly!\n\n' +
    'You will receive notifications for wallet transactions based on your settings.';

  return sendTelegramMessage(botToken, chatId, testMessage);
}

/**
 * Get all users who have access to a wallet (direct or via group)
 * Exported for use by other notification services (e.g., push notifications)
 */
export async function getWalletUsers(walletId: string) {
  return prisma.user.findMany({
    where: {
      OR: [
        { wallets: { some: { walletId } } },
        { groupMemberships: { some: { group: { wallets: { some: { id: walletId } } } } } },
      ],
    },
    select: { id: true, username: true, preferences: true },
  });
}

/**
 * Format a transaction message for Telegram
 */
function formatTransactionMessage(
  tx: TransactionData,
  wallet: { name: string },
  explorerUrl: string = 'https://mempool.space'
): string {
  const amountBtc = Number(tx.amount) / 100_000_000;
  const emoji = tx.type === 'received' ? '📥' : tx.type === 'sent' ? '📤' : '🔄';
  const typeLabel = tx.type.charAt(0).toUpperCase() + tx.type.slice(1);

  return (
    `${emoji} <b>${typeLabel}</b>\n` +
    `Wallet: ${escapeHtml(wallet.name)}\n` +
    `Amount: ${amountBtc.toFixed(8)} BTC\n\n` +
    `<a href="${explorerUrl}/tx/${tx.txid}">View Transaction</a>`
  );
}

/**
 * Escape HTML special characters for Telegram
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Notify all eligible users about new transactions
 */
export async function notifyNewTransactions(
  walletId: string,
  transactions: TransactionData[]
): Promise<void> {
  if (transactions.length === 0) return;

  try {
    // Get wallet info
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { id: true, name: true },
    });
    if (!wallet) return;

    // Get explorer URL from node config
    let explorerUrl = 'https://mempool.space';
    try {
      const nodeConfig = await prisma.nodeConfig.findFirst();
      if (nodeConfig?.explorerUrl) {
        explorerUrl = nodeConfig.explorerUrl;
      }
    } catch {
      // Use default
    }

    // Get all users with access to this wallet
    const users = await getWalletUsers(walletId);

    for (const user of users) {
      const prefs = user.preferences as Record<string, any> | null;
      const telegram = prefs?.telegram as TelegramConfig | undefined;

      // Skip if Telegram not configured or not enabled
      if (!telegram?.enabled || !telegram?.botToken || !telegram?.chatId) {
        continue;
      }

      // Get wallet-specific settings
      const walletSettings = telegram.wallets?.[walletId];
      if (!walletSettings?.enabled) {
        continue;
      }

      // Send notification for each transaction that matches user's preferences
      for (const tx of transactions) {
        const shouldNotify =
          (tx.type === 'received' && walletSettings.notifyReceived) ||
          (tx.type === 'sent' && walletSettings.notifySent) ||
          (tx.type === 'consolidation' && walletSettings.notifyConsolidation);

        if (shouldNotify) {
          const message = formatTransactionMessage(tx, wallet, explorerUrl);
          const result = await sendTelegramMessage(telegram.botToken, telegram.chatId, message);

          if (result.success) {
            log.debug(`Sent Telegram notification to ${user.username} for tx ${tx.txid.slice(0, 8)}...`);
          } else {
            log.warn(`Failed to send Telegram to ${user.username}: ${result.error}`);
          }
        }
      }
    }
  } catch (err) {
    log.error(`Error sending Telegram notifications: ${err}`);
  }
}

/**
 * Update a user's Telegram settings for a specific wallet
 */
export async function updateWalletTelegramSettings(
  userId: string,
  walletId: string,
  settings: WalletTelegramSettings
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  const prefs = (user.preferences as Record<string, any>) || {};
  const telegram = (prefs.telegram as TelegramConfig) || {
    botToken: '',
    chatId: '',
    enabled: false,
    wallets: {},
  };

  // Update wallet-specific settings
  telegram.wallets = telegram.wallets || {};
  telegram.wallets[walletId] = settings;

  // Save updated preferences - cast to any for Prisma JSON compatibility
  const updatedPrefs = {
    ...prefs,
    telegram: {
      botToken: telegram.botToken,
      chatId: telegram.chatId,
      enabled: telegram.enabled,
      wallets: telegram.wallets,
    },
  };

  await prisma.user.update({
    where: { id: userId },
    data: {
      preferences: updatedPrefs as any,
    },
  });
}

/**
 * Get a user's Telegram settings for a specific wallet
 */
export async function getWalletTelegramSettings(
  userId: string,
  walletId: string
): Promise<WalletTelegramSettings | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });

  if (!user) return null;

  const prefs = user.preferences as Record<string, any> | null;
  const telegram = prefs?.telegram as TelegramConfig | undefined;

  return telegram?.wallets?.[walletId] || null;
}
