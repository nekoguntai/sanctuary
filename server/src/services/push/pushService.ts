/**
 * Push Notification Service
 *
 * Sends transaction notifications to users via their registered mobile devices.
 * Supports both iOS (APNs) and Android (FCM) platforms.
 * Uses the same per-wallet notification settings as Telegram.
 */

import prisma from '../../models/prisma';
import { sendToAPNs, isAPNsConfigured } from './apnsProvider';
import { sendToFCM, isFCMConfigured } from './fcmProvider';
import { getWalletUsers, type WalletTelegramSettings } from '../telegram/telegramService';
import { createLogger } from '../../utils/logger';

const log = createLogger('PUSH');

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface TransactionData {
  txid: string;
  type: string;
  amount: bigint;
}

/**
 * Check if any push provider is configured
 */
export function isPushConfigured(): boolean {
  return isAPNsConfigured() || isFCMConfigured();
}

/**
 * Send a push notification to all devices registered to a user
 *
 * @param userId - The user ID to send notifications to
 * @param message - The notification content
 */
export async function sendPushNotification(
  userId: string,
  message: PushMessage
): Promise<void> {
  const devices = await prisma.pushDevice.findMany({
    where: { userId },
  });

  if (devices.length === 0) {
    return;
  }

  for (const device of devices) {
    try {
      let sent = false;

      if (device.platform === 'ios') {
        sent = await sendToAPNs(device.token, message);
      } else if (device.platform === 'android') {
        sent = await sendToFCM(device.token, message);
      } else {
        log.warn(`Unknown platform "${device.platform}" for device ${device.id}`);
        continue;
      }

      if (sent) {
        // Update last used timestamp
        await prisma.pushDevice.update({
          where: { id: device.id },
          data: { lastUsedAt: new Date() },
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Push to ${device.platform} device failed: ${errorMsg}`);

      // Remove invalid tokens (APNs/FCM return specific errors for expired/invalid tokens)
      if (isInvalidTokenError(err)) {
        await prisma.pushDevice.delete({ where: { id: device.id } });
        log.info(`Removed invalid ${device.platform} token for user ${userId}`);
      }
    }
  }
}

/**
 * Notify all eligible users about new transactions via push notifications
 *
 * Uses the same wallet notification settings as Telegram:
 * - user.preferences.telegram.wallets[walletId].enabled
 * - user.preferences.telegram.wallets[walletId].notifyReceived
 * - user.preferences.telegram.wallets[walletId].notifySent
 * - user.preferences.telegram.wallets[walletId].notifyConsolidation
 *
 * @param walletId - The wallet that received/sent transactions
 * @param transactions - Array of new transactions to notify about
 */
export async function notifyNewTransactions(
  walletId: string,
  transactions: TransactionData[]
): Promise<void> {
  if (transactions.length === 0) return;

  // Skip if no push providers are configured
  if (!isPushConfigured()) {
    return;
  }

  try {
    // Get wallet info
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { id: true, name: true },
    });
    if (!wallet) return;

    // Get all users with access to this wallet
    const users = await getWalletUsers(walletId);

    for (const user of users) {
      // Check if user has push devices registered
      const deviceCount = await prisma.pushDevice.count({
        where: { userId: user.id },
      });
      if (deviceCount === 0) continue;

      // Use same wallet settings as Telegram
      const prefs = user.preferences as Record<string, unknown> | null;
      const telegram = prefs?.telegram as {
        wallets?: Record<string, WalletTelegramSettings>;
      } | undefined;
      const walletSettings = telegram?.wallets?.[walletId];

      // Skip if notifications not enabled for this wallet
      if (!walletSettings?.enabled) continue;

      // Send notification for each transaction that matches user's preferences
      for (const tx of transactions) {
        const shouldNotify =
          (tx.type === 'received' && walletSettings.notifyReceived) ||
          (tx.type === 'sent' && walletSettings.notifySent) ||
          (tx.type === 'consolidation' && walletSettings.notifyConsolidation);

        if (shouldNotify) {
          const amountBtc = (Number(tx.amount) / 100_000_000).toFixed(8);
          const emoji = tx.type === 'received' ? '📥' : tx.type === 'sent' ? '📤' : '🔄';
          const typeLabel = tx.type.charAt(0).toUpperCase() + tx.type.slice(1);

          await sendPushNotification(user.id, {
            title: `${emoji} ${typeLabel}`,
            body: `${wallet.name}: ${amountBtc} BTC`,
            data: {
              walletId: wallet.id,
              txid: tx.txid,
              type: tx.type,
            },
          });
        }
      }
    }
  } catch (err) {
    log.error(`Error sending push notifications: ${err}`);
  }
}

/**
 * Check if an error indicates the device token is invalid/expired
 * These tokens should be removed from the database
 */
function isInvalidTokenError(err: unknown): boolean {
  const msg = String(err);

  // APNs error codes for invalid tokens
  // - 410 Gone: device token is no longer active
  // - BadDeviceToken: token is invalid
  // - Unregistered: token is not registered
  if (
    msg.includes('410') ||
    msg.includes('BadDeviceToken') ||
    msg.includes('Unregistered')
  ) {
    return true;
  }

  // FCM error codes for invalid tokens
  // - messaging/registration-token-not-registered: token is not registered
  // - messaging/invalid-registration-token: token is malformed
  // - InvalidRegistration: legacy error code
  if (
    msg.includes('registration-token-not-registered') ||
    msg.includes('invalid-registration-token') ||
    msg.includes('InvalidRegistration')
  ) {
    return true;
  }

  return false;
}
