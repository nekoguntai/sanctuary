import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockTelegramService, mockPushService } = vi.hoisted(() => ({
  mockTelegramService: {
    notifyNewTransactions: vi.fn(),
    notifyNewDraft: vi.fn(),
  },
  mockPushService: {
    isPushConfigured: vi.fn(),
    notifyNewTransactions: vi.fn(),
  },
}));

vi.mock('../../../../../src/services/telegram/telegramService', () => mockTelegramService);
vi.mock('../../../../../src/services/push/pushService', () => mockPushService);

import { telegramChannelHandler } from '../../../../../src/services/notifications/channels/telegram';
import { pushChannelHandler } from '../../../../../src/services/notifications/channels/push';

describe('notification channel handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('telegramChannelHandler', () => {
    it('is always enabled', async () => {
      await expect(telegramChannelHandler.isEnabled()).resolves.toBe(true);
    });

    it('forwards transaction notifications and returns success result', async () => {
      mockTelegramService.notifyNewTransactions.mockResolvedValueOnce(undefined);

      const result = await telegramChannelHandler.notifyTransactions('wallet-1', [
        { txid: 'a'.repeat(64), type: 'received', amount: 10_000n },
      ]);

      expect(mockTelegramService.notifyNewTransactions).toHaveBeenCalledWith('wallet-1', [
        { txid: 'a'.repeat(64), type: 'received', amount: 10_000n },
      ]);
      expect(result).toEqual({
        success: true,
        channelId: 'telegram',
        usersNotified: 1,
      });
    });

    it('returns failed result when transaction notifications throw', async () => {
      mockTelegramService.notifyNewTransactions.mockRejectedValueOnce(new Error('telegram tx failure'));

      const result = await telegramChannelHandler.notifyTransactions('wallet-1', [
        { txid: 'b'.repeat(64), type: 'sent', amount: 8_000n },
      ]);

      expect(result.success).toBe(false);
      expect(result.channelId).toBe('telegram');
      expect(result.usersNotified).toBe(0);
      expect(result.errors?.[0]).toContain('telegram tx failure');
    });

    it('forwards draft notifications and returns success result', async () => {
      mockTelegramService.notifyNewDraft.mockResolvedValueOnce(undefined);

      const result = await telegramChannelHandler.notifyDraft!(
        'wallet-1',
        {
          id: 'draft-1',
          amount: 12_000n,
          recipient: 'tb1qexample',
          feeRate: 2,
        },
        'user-1'
      );

      expect(mockTelegramService.notifyNewDraft).toHaveBeenCalledWith(
        'wallet-1',
        {
          id: 'draft-1',
          amount: 12_000n,
          recipient: 'tb1qexample',
          feeRate: 2,
        },
        'user-1'
      );
      expect(result).toEqual({
        success: true,
        channelId: 'telegram',
        usersNotified: 1,
      });
    });

    it('returns failed result when draft notifications throw', async () => {
      mockTelegramService.notifyNewDraft.mockRejectedValueOnce(new Error('telegram draft failure'));

      const result = await telegramChannelHandler.notifyDraft!(
        'wallet-1',
        {
          id: 'draft-2',
          amount: 9_000n,
          recipient: 'tb1qexample',
          feeRate: 1,
        },
        'user-2'
      );

      expect(result.success).toBe(false);
      expect(result.channelId).toBe('telegram');
      expect(result.usersNotified).toBe(0);
      expect(result.errors?.[0]).toContain('telegram draft failure');
    });
  });

  describe('pushChannelHandler', () => {
    it('uses push service configuration status in isEnabled', async () => {
      mockPushService.isPushConfigured.mockReturnValueOnce(true);
      await expect(pushChannelHandler.isEnabled()).resolves.toBe(true);

      mockPushService.isPushConfigured.mockReturnValueOnce(false);
      await expect(pushChannelHandler.isEnabled()).resolves.toBe(false);
    });

    it('forwards transaction notifications and returns success result', async () => {
      mockPushService.notifyNewTransactions.mockResolvedValueOnce(undefined);

      const result = await pushChannelHandler.notifyTransactions('wallet-2', [
        { txid: 'c'.repeat(64), type: 'received', amount: 6_000n },
      ]);

      expect(mockPushService.notifyNewTransactions).toHaveBeenCalledWith('wallet-2', [
        { txid: 'c'.repeat(64), type: 'received', amount: 6_000n },
      ]);
      expect(result).toEqual({
        success: true,
        channelId: 'push',
        usersNotified: 1,
      });
    });

    it('returns failed result when push notifications throw', async () => {
      mockPushService.notifyNewTransactions.mockRejectedValueOnce(new Error('push failure'));

      const result = await pushChannelHandler.notifyTransactions('wallet-2', [
        { txid: 'd'.repeat(64), type: 'sent', amount: 4_000n },
      ]);

      expect(result.success).toBe(false);
      expect(result.channelId).toBe('push');
      expect(result.usersNotified).toBe(0);
      expect(result.errors?.[0]).toContain('push failure');
    });
  });
});
