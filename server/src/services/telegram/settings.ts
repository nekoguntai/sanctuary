/**
 * Telegram Settings
 *
 * Functions for managing per-wallet Telegram notification settings.
 */

import type { Prisma } from '../../generated/prisma/client';
import { userRepository } from '../../repositories';
import type { TelegramConfig, WalletTelegramSettings } from './types';

/**
 * Update a user's Telegram settings for a specific wallet
 */
export async function updateWalletTelegramSettings(
  userId: string,
  walletId: string,
  settings: WalletTelegramSettings
): Promise<void> {
  const user = await userRepository.findByIdWithSelect(userId, { preferences: true });

  if (!user) {
    throw new Error('User not found');
  }

  const prefs = (user.preferences as Record<string, unknown>) || {};
  const telegram = (prefs.telegram as TelegramConfig) || {
    botToken: '',
    chatId: '',
    enabled: false,
    wallets: {},
  };

  // Update wallet-specific settings
  telegram.wallets = telegram.wallets || {};
  telegram.wallets[walletId] = settings;

  // Save updated preferences
  const updatedPrefs = {
    ...prefs,
    telegram: {
      botToken: telegram.botToken,
      chatId: telegram.chatId,
      enabled: telegram.enabled,
      wallets: telegram.wallets,
    },
  };

  await userRepository.updatePreferences(userId, updatedPrefs as unknown as Prisma.InputJsonValue);
}

/**
 * Get a user's Telegram settings for a specific wallet
 */
export async function getWalletTelegramSettings(
  userId: string,
  walletId: string
): Promise<WalletTelegramSettings | null> {
  const user = await userRepository.findByIdWithSelect(userId, { preferences: true });

  if (!user) return null;

  const prefs = user.preferences as Record<string, unknown> | null;
  const telegram = prefs?.telegram as TelegramConfig | undefined;

  return telegram?.wallets?.[walletId] || null;
}
