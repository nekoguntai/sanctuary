import { vi } from 'vitest';
/**
 * Transfer Service Tests
 *
 * Tests for ownership transfer service functions including:
 * - Initiating transfers
 * - Accepting/declining transfers
 * - Confirming/cancelling transfers
 * - Transfer validation and expiration
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock wallet service
const mockCheckWalletOwnerAccess = vi.fn();
vi.mock('../../../src/services/wallet', () => ({
  checkWalletOwnerAccess: (...args: any[]) => mockCheckWalletOwnerAccess(...args),
}));

// Mock device access service
const mockCheckDeviceOwnerAccess = vi.fn();
vi.mock('../../../src/services/deviceAccess', () => ({
  checkDeviceOwnerAccess: (...args: any[]) => mockCheckDeviceOwnerAccess(...args),
}));

// Import after mocks
import {
  initiateTransfer,
  acceptTransfer,
  declineTransfer,
  cancelTransfer,
  confirmTransfer,
  getUserTransfers,
  getTransfer,
  hasActiveTransfer,
  getPendingIncomingCount,
  getAwaitingConfirmationCount,
  expireOldTransfers,
} from '../../../src/services/transferService';

describe('Transfer Service', () => {
  const ownerId = 'owner-123';
  const recipientId = 'recipient-456';
  const walletId = 'wallet-789';
  const deviceId = 'device-abc';
  const transferId = 'transfer-xyz';

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    // Default: owner checks pass
    mockCheckWalletOwnerAccess.mockResolvedValue(true);
    mockCheckDeviceOwnerAccess.mockResolvedValue(true);
  });

  describe('initiateTransfer', () => {
    it('should create a wallet transfer when user is owner', async () => {
      // Owner check: first call (owner) returns true, second call (recipient) returns false
      mockCheckWalletOwnerAccess
        .mockResolvedValueOnce(true)   // Owner is owner
        .mockResolvedValueOnce(false); // Recipient is not owner

      // Mock wallet exists
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      // Mock recipient exists
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });

      // Mock no active transfer
      mockPrismaClient.ownershipTransfer.findFirst.mockResolvedValue(null);

      // Mock transfer creation
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.create.mockResolvedValue(mockTransfer);

      const result = await initiateTransfer(ownerId, {
        resourceType: 'wallet',
        resourceId: walletId,
        toUserId: recipientId,
      });

      expect(result.id).toBe(transferId);
      expect(result.status).toBe('pending');
      expect(mockPrismaClient.ownershipTransfer.create).toHaveBeenCalled();
    });

    it('should reject transfer when user is not owner', async () => {
      // Mock target user exists
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });

      // Mock non-owner check
      mockCheckWalletOwnerAccess.mockResolvedValue(false);

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        })
      ).rejects.toThrow(/not the owner/i);
    });

    it('should reject self-transfer', async () => {
      // Mock owner check
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        id: 'wu-1',
        walletId,
        userId: ownerId,
        role: 'owner',
      });

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: ownerId, // Same as owner
        })
      ).rejects.toThrow(/yourself/i);
    });

    it('should reject when active transfer exists', async () => {
      // Owner check: first call (owner) returns true, second call (recipient) returns false
      mockCheckWalletOwnerAccess
        .mockResolvedValueOnce(true)   // Owner is owner
        .mockResolvedValueOnce(false); // Recipient is not owner

      // Mock wallet exists
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      // Mock recipient exists
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });

      // Mock active transfer exists (count > 0)
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(1);

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        })
      ).rejects.toThrow(/pending transfer/i);
    });

    it('should reject when target user does not exist', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        })
      ).rejects.toThrow(/not found/i);
    });

    it('should reject when target user already owns the resource', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);
      mockCheckWalletOwnerAccess.mockReset();
      mockCheckWalletOwnerAccess
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        })
      ).rejects.toThrow(/already an owner/i);
    });

    it('should create a device transfer when user is owner', async () => {
      // Owner check: first call (owner) returns true, second call (recipient) returns false
      mockCheckDeviceOwnerAccess
        .mockResolvedValueOnce(true)   // Owner is owner
        .mockResolvedValueOnce(false); // Recipient is not owner

      // Mock device exists
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: deviceId,
        label: 'Test Device',
      });

      // Mock recipient exists
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });

      // Mock no active transfer
      mockPrismaClient.ownershipTransfer.findFirst.mockResolvedValue(null);

      // Mock transfer creation
      const mockTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: deviceId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.create.mockResolvedValue(mockTransfer);

      const result = await initiateTransfer(ownerId, {
        resourceType: 'device',
        resourceId: deviceId,
        toUserId: recipientId,
      });

      expect(result.resourceType).toBe('device');
      expect(result.status).toBe('pending');
    });
  });

  describe('acceptTransfer', () => {
    it('should reject when transfer does not exist', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should accept pending transfer as recipient', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // Mock atomic updateMany to succeed
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      // Mock findUnique for returning the updated transfer
      const updatedTransfer = {
        ...mockTransfer,
        status: 'accepted',
        acceptedAt: new Date(),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(updatedTransfer);

      const result = await acceptTransfer(recipientId, transferId);

      expect(result.status).toBe('accepted');
      expect(mockPrismaClient.ownershipTransfer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: transferId,
            toUserId: recipientId,
            status: 'pending',
          }),
          data: expect.objectContaining({ status: 'accepted' }),
        })
      );
    });

    it('should reject accept from non-recipient', async () => {
      // findUnique for initial validation
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      // Throws before updateMany because toUserId check happens first
      await expect(
        acceptTransfer('wrong-user', transferId)
      ).rejects.toThrow(/only the recipient/i);
    });

    it('should reject accept of non-pending transfer', async () => {
      // updateMany returns 0 because status isn't 'pending'
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      // findUnique shows status is 'accepted'
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'accepted', // Already accepted
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/already been accepted/i);
    });

    it('should reject accept of expired transfer', async () => {
      // findUnique for initial validation returns expired transfer
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000), // Expired
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      // Mock updateMany for the expiration update
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      // The code detects expiration before attempting atomic update
      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/expired/i);
    });

    it('should reject when updated transfer cannot be fetched after accept', async () => {
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should report unknown status when atomic accept update loses race and transfer disappears', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          toUserId: recipientId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/current status: unknown/i);
    });
  });

  describe('declineTransfer', () => {
    it('should reject decline when transfer does not exist', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(
        declineTransfer(recipientId, transferId, 'nope')
      ).rejects.toThrow(/not found/i);
    });

    it('should reject decline from non-recipient', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await expect(
        declineTransfer('wrong-user', transferId, 'nope')
      ).rejects.toThrow(/only the recipient/i);
    });

    it('should decline pending transfer as recipient', async () => {
      // Mock atomic updateMany to succeed
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      // Mock findUnique for returning the updated transfer
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'declined',
        declineReason: 'Not interested',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      const result = await declineTransfer(recipientId, transferId, 'Not interested');

      expect(result.status).toBe('declined');
    });

    it('should reject decline when updated transfer cannot be fetched', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          toUserId: recipientId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        declineTransfer(recipientId, transferId, 'no')
      ).rejects.toThrow(/not found/i);
    });

    it('should report unknown status when atomic decline update loses race and transfer disappears', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          toUserId: recipientId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        declineTransfer(recipientId, transferId, 'no')
      ).rejects.toThrow(/current status: unknown/i);
    });
  });

  describe('cancelTransfer', () => {
    it('should reject cancel when transfer does not exist', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(
        cancelTransfer(ownerId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should cancel pending transfer as owner', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // First findUnique for ownership check
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)
        // Second findUnique for returning result
        .mockResolvedValueOnce({
          ...mockTransfer,
          status: 'cancelled',
          cancelledAt: new Date(),
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });

      // Mock atomic updateMany to succeed
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      const result = await cancelTransfer(ownerId, transferId);

      expect(result.status).toBe('cancelled');
    });

    it('should cancel accepted transfer as owner', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'accepted',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // First findUnique for ownership check
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)
        // Second findUnique for returning result
        .mockResolvedValueOnce({
          ...mockTransfer,
          status: 'cancelled',
          cancelledAt: new Date(),
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });

      // Mock atomic updateMany to succeed
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      const result = await cancelTransfer(ownerId, transferId);

      expect(result.status).toBe('cancelled');
    });

    it('should reject cancel from non-owner', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      await expect(
        cancelTransfer('wrong-user', transferId)
      ).rejects.toThrow(/initiator/i);
    });

    it('should reject cancel when updated transfer cannot be fetched', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          fromUserId: ownerId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        cancelTransfer(ownerId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should report unknown status when atomic cancel update loses race and transfer disappears', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          fromUserId: ownerId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        cancelTransfer(ownerId, transferId)
      ).rejects.toThrow(/current status: unknown/i);
    });
  });

  describe('confirmTransfer', () => {
    it('should confirm accepted wallet transfer and change ownership', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      const confirmedTransfer = {
        ...mockTransfer,
        status: 'confirmed',
        confirmedAt: new Date(),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      // First findUnique (outside transaction) and final findUnique
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)      // Initial validation
        .mockResolvedValueOnce(confirmedTransfer); // Final result fetch

      // Mock the transaction callback execution
      // The callback receives a transaction client that has the same shape as prisma
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        // Create a tx mock with findUnique returning accepted status for validation
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(mockTransfer), // In-tx validation
            update: vi.fn().mockResolvedValue(confirmedTransfer),
          },
          walletUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'wu-owner', userId: ownerId, walletId, role: 'owner' })
              .mockResolvedValueOnce(null), // Recipient doesn't have access yet
            create: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          },
        };
        return callback(txMock);
      });

      // Reset and set ownership check mock - owner still owns during confirm
      mockCheckWalletOwnerAccess.mockReset();
      mockCheckWalletOwnerAccess.mockResolvedValue(true);

      const result = await confirmTransfer(ownerId, transferId);

      expect(result.status).toBe('confirmed');
    });

    it('should reject confirm of non-accepted transfer', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'pending', // Not accepted yet
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/cannot be confirmed/i);
    });

    it('should reject confirm from non-owner', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'accepted',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      await expect(
        confirmTransfer('wrong-user', transferId)
      ).rejects.toThrow(/initiator/i);
    });

    it('should reject confirm when transfer does not exist', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should reject confirm when transfer was already confirmed in transaction', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue({
              id: transferId,
              status: 'confirmed',
            }),
            update: vi.fn(),
          },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/already been completed/i);
    });

    it('should expire transfer during confirm when it is stale in transaction', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      const updateSpy = vi.fn().mockResolvedValue({});
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue({
              id: transferId,
              status: 'accepted',
              resourceType: 'wallet',
              resourceId: walletId,
              fromUserId: ownerId,
              toUserId: recipientId,
              keepExistingUsers: true,
              expiresAt: new Date(Date.now() - 1000),
            }),
            update: updateSpy,
          },
          walletUser: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/expired/i);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: transferId },
        data: { status: 'expired' },
      });
    });

    it('should reject wallet confirm when current owner record is missing in transaction', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue({
              id: transferId,
              resourceType: 'wallet',
              resourceId: walletId,
              fromUserId: ownerId,
              toUserId: recipientId,
              status: 'accepted',
              keepExistingUsers: true,
              expiresAt: new Date(Date.now() + 1000 * 60 * 60),
            }),
            update: vi.fn(),
          },
          walletUser: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/owner no longer owns this wallet/i);
    });

    it('should confirm wallet transfer by upgrading existing recipient and removing old owner', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(baseTransfer)
        .mockResolvedValueOnce({
          ...baseTransfer,
          status: 'confirmed',
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, name: 'Wallet X' });

      const walletUpdateSpy = vi.fn().mockResolvedValue({});
      const walletDeleteSpy = vi.fn().mockResolvedValue({});
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          walletUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'wu-owner', userId: ownerId, role: 'owner' })
              .mockResolvedValueOnce({ id: 'wu-recipient', userId: recipientId, role: 'viewer' }),
            create: vi.fn(),
            update: walletUpdateSpy,
            delete: walletDeleteSpy,
          },
        };
        return callback(txMock as any);
      });

      const result = await confirmTransfer(ownerId, transferId);
      expect(result.status).toBe('confirmed');
      expect(walletUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'wu-recipient' },
        data: { role: 'owner' },
      });
      expect(walletDeleteSpy).toHaveBeenCalledWith({
        where: { id: 'wu-owner' },
      });
    });

    it('should confirm device transfer by updating legacy owner field and downgrading old owner', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: deviceId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(baseTransfer)
        .mockResolvedValueOnce({
          ...baseTransfer,
          status: 'confirmed',
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });
      mockPrismaClient.device.findUnique.mockResolvedValue({ id: deviceId, label: 'Ledger' });

      const deviceUpdateSpy = vi.fn().mockResolvedValue({});
      const deviceUserUpdateSpy = vi.fn().mockResolvedValue({});
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          device: {
            update: deviceUpdateSpy,
          },
          deviceUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'du-owner', userId: ownerId, role: 'owner' })
              .mockResolvedValueOnce({ id: 'du-recipient', userId: recipientId, role: 'viewer' }),
            create: vi.fn(),
            update: deviceUserUpdateSpy,
            delete: vi.fn(),
          },
        };
        return callback(txMock as any);
      });

      const result = await confirmTransfer(ownerId, transferId);
      expect(result.resourceType).toBe('device');
      expect(deviceUpdateSpy).toHaveBeenCalledWith({
        where: { id: deviceId },
        data: { userId: recipientId },
      });
      expect(deviceUserUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'du-recipient' },
        data: { role: 'owner' },
      });
      expect(deviceUserUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'du-owner' },
        data: { role: 'viewer' },
      });
    });

    it('should confirm device transfer by creating recipient access and removing old owner', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: deviceId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(baseTransfer)
        .mockResolvedValueOnce({
          ...baseTransfer,
          status: 'confirmed',
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });
      mockPrismaClient.device.findUnique.mockResolvedValue({ id: deviceId, label: 'Coldcard' });

      const deviceUserCreateSpy = vi.fn().mockResolvedValue({});
      const deviceUserDeleteSpy = vi.fn().mockResolvedValue({});
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          device: {
            update: vi.fn().mockResolvedValue({}),
          },
          deviceUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'du-owner', userId: ownerId, role: 'owner' })
              .mockResolvedValueOnce(null),
            create: deviceUserCreateSpy,
            update: vi.fn(),
            delete: deviceUserDeleteSpy,
          },
        };
        return callback(txMock as any);
      });

      const result = await confirmTransfer(ownerId, transferId);
      expect(result.status).toBe('confirmed');
      expect(deviceUserCreateSpy).toHaveBeenCalledWith({
        data: {
          deviceId,
          userId: recipientId,
          role: 'owner',
        },
      });
      expect(deviceUserDeleteSpy).toHaveBeenCalledWith({
        where: { id: 'du-owner' },
      });
    });

    it('should reject device confirm when owner no longer has device access', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: deviceId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValueOnce(baseTransfer);
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          device: {
            update: vi.fn().mockResolvedValue({}),
          },
          deviceUser: {
            findFirst: vi.fn().mockResolvedValueOnce(null),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/owner no longer owns this device/i);
    });

    it('should reject confirm when final transfer fetch is missing', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(baseTransfer)
        .mockResolvedValueOnce(null);

      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          walletUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'wu-owner', userId: ownerId, role: 'owner' })
              .mockResolvedValueOnce(null),
            create: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
          },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should report unknown status when transfer vanishes inside confirm transaction', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValueOnce({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(null),
            update: vi.fn(),
          },
          walletUser: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/current status: unknown/i);
    });
  });

  describe('getUserTransfers', () => {
    it('should return transfers for user', async () => {
      const mockTransfers = [
        {
          id: 'transfer-1',
          resourceType: 'wallet',
          resourceId: walletId,
          fromUserId: ownerId,
          toUserId: recipientId,
          status: 'pending',
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        },
      ];

      mockPrismaClient.ownershipTransfer.findMany.mockResolvedValue(mockTransfers);
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(1);

      const result = await getUserTransfers(ownerId);

      expect(result.transfers).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by role', async () => {
      mockPrismaClient.ownershipTransfer.findMany.mockResolvedValue([]);
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);

      await getUserTransfers(ownerId, { role: 'initiator' });

      expect(mockPrismaClient.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fromUserId: ownerId,
          }),
        })
      );
    });

    it('should filter by status', async () => {
      mockPrismaClient.ownershipTransfer.findMany.mockResolvedValue([]);
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);

      await getUserTransfers(ownerId, { status: 'pending' });

      expect(mockPrismaClient.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'pending',
          }),
        })
      );
    });

    it('should filter by recipient role, active status, and resource type', async () => {
      mockPrismaClient.ownershipTransfer.findMany.mockResolvedValue([]);
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);

      await getUserTransfers(ownerId, {
        role: 'recipient',
        status: 'active',
        resourceType: 'device',
      });

      expect(mockPrismaClient.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            toUserId: ownerId,
            status: { in: ['pending', 'accepted'] },
            resourceType: 'device',
          }),
        })
      );
    });
  });

  describe('getTransfer and counters', () => {
    it('should return null when transfer is missing', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(getTransfer('missing-transfer')).resolves.toBeNull();
    });

    it('should return formatted transfer when transfer exists', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Ops Wallet',
      });

      const transfer = await getTransfer(transferId);
      expect(transfer?.resourceName).toBe('Ops Wallet');
    });

    it('should format transfer with undefined user fields when related users are missing', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        fromUser: null,
        toUser: null,
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Ops Wallet',
      });

      const transfer = await getTransfer(transferId);
      expect(transfer?.fromUser).toBeUndefined();
      expect(transfer?.toUser).toBeUndefined();
    });

    it('should return pending incoming and awaiting confirmation counts', async () => {
      mockPrismaClient.ownershipTransfer.count
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3);

      await expect(getPendingIncomingCount(recipientId)).resolves.toBe(7);
      await expect(getAwaitingConfirmationCount(ownerId)).resolves.toBe(3);
    });
  });

  describe('hasActiveTransfer', () => {
    it('should return true when active transfer exists', async () => {
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(1);

      const result = await hasActiveTransfer('wallet', walletId);

      expect(result).toBe(true);
    });

    it('should return false when no active transfer', async () => {
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);

      const result = await hasActiveTransfer('wallet', walletId);

      expect(result).toBe(false);
    });
  });

  describe('expireOldTransfers', () => {
    it('should expire old pending and accepted transfers', async () => {
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 5 });

      const result = await expireOldTransfers();

      expect(result).toBe(5);
      expect(mockPrismaClient.ownershipTransfer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['pending', 'accepted'] },
            expiresAt: { lt: expect.any(Date) },
          }),
          data: { status: 'expired' },
        })
      );
    });

    it('should return zero when no transfers are expired', async () => {
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(expireOldTransfers()).resolves.toBe(0);
    });
  });

  describe('Race Condition Protection', () => {
    it('should use atomic update for acceptTransfer', async () => {
      // Mock updateMany returning 0 (simulating concurrent update race condition)
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      // When updateMany returns 0, code fetches current status for error message
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending', // Still shows pending because of race condition
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      // Should throw because atomic update failed (updateMany matched 0 records)
      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/cannot be accepted/i);
    });

    it('should use atomic update for declineTransfer', async () => {
      // Mock updateMany returning 0 (simulating concurrent update race condition)
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      // When updateMany returns 0, code fetches current status for error message
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      // Should throw because atomic update failed
      await expect(
        declineTransfer(recipientId, transferId)
      ).rejects.toThrow(/cannot be declined/i);
    });

    it('should use atomic update for cancelTransfer', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // First findUnique for ownership validation, then for error message
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)  // Ownership check
        .mockResolvedValueOnce(mockTransfer); // Error message fetch

      // Mock updateMany returning 0 (simulating concurrent update)
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      // Should throw because atomic update failed
      await expect(
        cancelTransfer(ownerId, transferId)
      ).rejects.toThrow(/cannot be cancelled/i);
    });

    it('should succeed when atomic update modifies exactly one row', async () => {
      // Mock updateMany returning 1 (successful atomic update)
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      // Mock the findUnique for refetch after update
      const acceptedTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(acceptedTransfer);

      const result = await acceptTransfer(recipientId, transferId);

      expect(result.status).toBe('accepted');
    });
  });
});
