/**
 * Push Service Tests
 *
 * Tests for push notification service including:
 * - Configuration checks
 * - Sending notifications to iOS and Android devices
 * - Transaction notification logic
 * - Invalid token handling
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

// Mock Prisma
jest.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock providers
const mockSendToAPNs = jest.fn();
const mockSendToFCM = jest.fn();
const mockIsAPNsConfigured = jest.fn();
const mockIsFCMConfigured = jest.fn();

jest.mock('../../../../src/services/push/apnsProvider', () => ({
  sendToAPNs: (...args: any[]) => mockSendToAPNs(...args),
  isAPNsConfigured: () => mockIsAPNsConfigured(),
}));

jest.mock('../../../../src/services/push/fcmProvider', () => ({
  sendToFCM: (...args: any[]) => mockSendToFCM(...args),
  isFCMConfigured: () => mockIsFCMConfigured(),
}));

// Mock logger
jest.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Import after mocks
import {
  isPushConfigured,
  sendPushNotification,
  notifyNewTransactions,
} from '../../../../src/services/push/pushService';

describe('Push Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
    mockIsAPNsConfigured.mockReturnValue(false);
    mockIsFCMConfigured.mockReturnValue(false);
  });

  describe('isPushConfigured', () => {
    it('should return true when APNs is configured', () => {
      mockIsAPNsConfigured.mockReturnValue(true);
      mockIsFCMConfigured.mockReturnValue(false);

      expect(isPushConfigured()).toBe(true);
    });

    it('should return true when FCM is configured', () => {
      mockIsAPNsConfigured.mockReturnValue(false);
      mockIsFCMConfigured.mockReturnValue(true);

      expect(isPushConfigured()).toBe(true);
    });

    it('should return true when both are configured', () => {
      mockIsAPNsConfigured.mockReturnValue(true);
      mockIsFCMConfigured.mockReturnValue(true);

      expect(isPushConfigured()).toBe(true);
    });

    it('should return false when neither is configured', () => {
      mockIsAPNsConfigured.mockReturnValue(false);
      mockIsFCMConfigured.mockReturnValue(false);

      expect(isPushConfigured()).toBe(false);
    });
  });

  describe('sendPushNotification', () => {
    const userId = 'user-123';
    const message = {
      title: 'Test Notification',
      body: 'This is a test message',
      data: { txid: 'abc123' },
    };

    it('should send notification to iOS device via APNs', async () => {
      const iosDevice = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'apns-token-123',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([iosDevice]);
      mockSendToAPNs.mockResolvedValue(true);

      await sendPushNotification(userId, message);

      expect(mockSendToAPNs).toHaveBeenCalledWith('apns-token-123', message);
      expect(mockPrismaClient.pushDevice.update).toHaveBeenCalledWith({
        where: { id: 'device-1' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it('should send notification to Android device via FCM', async () => {
      const androidDevice = {
        id: 'device-2',
        userId,
        platform: 'android',
        token: 'fcm-token-456',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([androidDevice]);
      mockSendToFCM.mockResolvedValue(true);

      await sendPushNotification(userId, message);

      expect(mockSendToFCM).toHaveBeenCalledWith('fcm-token-456', message);
      expect(mockPrismaClient.pushDevice.update).toHaveBeenCalledWith({
        where: { id: 'device-2' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it('should send to multiple devices', async () => {
      const devices = [
        { id: 'device-1', userId, platform: 'ios', token: 'apns-token', lastUsedAt: new Date() },
        { id: 'device-2', userId, platform: 'android', token: 'fcm-token', lastUsedAt: new Date() },
      ];

      mockPrismaClient.pushDevice.findMany.mockResolvedValue(devices);
      mockSendToAPNs.mockResolvedValue(true);
      mockSendToFCM.mockResolvedValue(true);

      await sendPushNotification(userId, message);

      expect(mockSendToAPNs).toHaveBeenCalledTimes(1);
      expect(mockSendToFCM).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.pushDevice.update).toHaveBeenCalledTimes(2);
    });

    it('should skip when user has no devices', async () => {
      mockPrismaClient.pushDevice.findMany.mockResolvedValue([]);

      await sendPushNotification(userId, message);

      expect(mockSendToAPNs).not.toHaveBeenCalled();
      expect(mockSendToFCM).not.toHaveBeenCalled();
    });

    it('should not update lastUsedAt when send fails', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'apns-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockSendToAPNs.mockResolvedValue(false);

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.update).not.toHaveBeenCalled();
    });

    it('should remove device with invalid token (APNs 410)', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'expired-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockSendToAPNs.mockRejectedValue(new Error('410 Gone'));

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalledWith({
        where: { id: 'device-1' },
      });
    });

    it('should remove device with BadDeviceToken error', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'bad-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockSendToAPNs.mockRejectedValue(new Error('BadDeviceToken'));

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalledWith({
        where: { id: 'device-1' },
      });
    });

    it('should remove device with FCM registration-token-not-registered error', async () => {
      const device = {
        id: 'device-2',
        userId,
        platform: 'android',
        token: 'unregistered-token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockSendToFCM.mockRejectedValue(new Error('messaging/registration-token-not-registered'));

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalledWith({
        where: { id: 'device-2' },
      });
    });

    it('should not remove device on other errors', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'ios',
        token: 'token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockSendToAPNs.mockRejectedValue(new Error('Network timeout'));

      await sendPushNotification(userId, message);

      expect(mockPrismaClient.pushDevice.delete).not.toHaveBeenCalled();
    });

    it('should skip unknown platforms', async () => {
      const device = {
        id: 'device-1',
        userId,
        platform: 'windows',
        token: 'token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);

      await sendPushNotification(userId, message);

      expect(mockSendToAPNs).not.toHaveBeenCalled();
      expect(mockSendToFCM).not.toHaveBeenCalled();
    });
  });

  describe('notifyNewTransactions', () => {
    const walletId = 'wallet-123';

    beforeEach(() => {
      // Configure at least one provider
      mockIsAPNsConfigured.mockReturnValue(true);
    });

    it('should skip when no transactions', async () => {
      await notifyNewTransactions(walletId, []);

      expect(mockPrismaClient.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('should skip when push not configured', async () => {
      mockIsAPNsConfigured.mockReturnValue(false);
      mockIsFCMConfigured.mockReturnValue(false);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      expect(mockPrismaClient.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('should notify users with enabled notifications for received transaction', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: true,
                  notifySent: false,
                  notifyConsolidation: false,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([
        { id: 'd1', userId: 'user-1', platform: 'ios', token: 'token1', lastUsedAt: new Date() },
      ]);
      mockSendToAPNs.mockResolvedValue(true);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(10000000) }, // 0.1 BTC
      ]);

      expect(mockSendToAPNs).toHaveBeenCalledWith(
        'token1',
        expect.objectContaining({
          title: expect.stringContaining('Received'),
          body: expect.stringContaining('My Wallet'),
        })
      );
    });

    it('should not notify when wallet settings disabled', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: false, // Disabled
                  notifyReceived: true,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      expect(mockPrismaClient.pushDevice.findMany).not.toHaveBeenCalled();
    });

    it('should not notify when transaction type not enabled', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: false, // Not interested in received
                  notifySent: true,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      // Should not attempt to send notification
      expect(mockSendToAPNs).not.toHaveBeenCalled();
    });

    it('should skip users with no push devices', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: true,
                },
              },
            },
          },
          _count: { pushDevices: 0 }, // No devices
        },
      ]);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      expect(mockPrismaClient.pushDevice.findMany).not.toHaveBeenCalled();
    });

    it('should notify for sent transactions', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: false,
                  notifySent: true,
                  notifyConsolidation: false,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([
        { id: 'd1', userId: 'user-1', platform: 'android', token: 'fcm-token', lastUsedAt: new Date() },
      ]);
      mockSendToFCM.mockResolvedValue(true);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'sent', amount: BigInt(-5000000) },
      ]);

      expect(mockSendToFCM).toHaveBeenCalledWith(
        'fcm-token',
        expect.objectContaining({
          title: expect.stringContaining('Sent'),
        })
      );
    });

    it('should notify for consolidation transactions', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'My Wallet',
      });

      mockPrismaClient.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          preferences: {
            telegram: {
              wallets: {
                [walletId]: {
                  enabled: true,
                  notifyReceived: false,
                  notifySent: false,
                  notifyConsolidation: true,
                },
              },
            },
          },
          _count: { pushDevices: 1 },
        },
      ]);

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([
        { id: 'd1', userId: 'user-1', platform: 'ios', token: 'token', lastUsedAt: new Date() },
      ]);
      mockSendToAPNs.mockResolvedValue(true);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'consolidation', amount: BigInt(-1000) },
      ]);

      expect(mockSendToAPNs).toHaveBeenCalled();
    });

    it('should handle wallet not found', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      await notifyNewTransactions(walletId, [
        { txid: 'tx1', type: 'received', amount: BigInt(100000) },
      ]);

      expect(mockPrismaClient.user.findMany).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockPrismaClient.wallet.findUnique.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(
        notifyNewTransactions(walletId, [
          { txid: 'tx1', type: 'received', amount: BigInt(100000) },
        ])
      ).resolves.not.toThrow();
    });
  });

  describe('Invalid Token Detection', () => {
    const testCases = [
      { error: '410 Gone', shouldRemove: true, description: 'APNs 410 status' },
      { error: 'BadDeviceToken', shouldRemove: true, description: 'APNs BadDeviceToken' },
      { error: 'Unregistered', shouldRemove: true, description: 'APNs Unregistered' },
      { error: 'messaging/registration-token-not-registered', shouldRemove: true, description: 'FCM not registered' },
      { error: 'messaging/invalid-registration-token', shouldRemove: true, description: 'FCM invalid token' },
      { error: 'InvalidRegistration', shouldRemove: true, description: 'FCM legacy error' },
      { error: 'Network timeout', shouldRemove: false, description: 'network error' },
      { error: 'Server error', shouldRemove: false, description: 'server error' },
    ];

    it.each(testCases)('should $shouldRemove remove device on $description', async ({ error, shouldRemove }) => {
      const device = {
        id: 'device-1',
        userId: 'user-1',
        platform: 'ios',
        token: 'token',
        lastUsedAt: new Date(),
      };

      mockPrismaClient.pushDevice.findMany.mockResolvedValue([device]);
      mockSendToAPNs.mockRejectedValue(new Error(error));

      await sendPushNotification('user-1', { title: 'Test', body: 'Test' });

      if (shouldRemove) {
        expect(mockPrismaClient.pushDevice.delete).toHaveBeenCalled();
      } else {
        expect(mockPrismaClient.pushDevice.delete).not.toHaveBeenCalled();
      }
    });
  });
});
