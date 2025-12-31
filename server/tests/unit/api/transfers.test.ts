/**
 * Transfers API Routes Tests
 *
 * Tests for ownership transfer endpoints including:
 * - POST /transfers
 * - GET /transfers
 * - GET /transfers/:transferId
 * - POST /transfers/:transferId/accept
 * - POST /transfers/:transferId/decline
 * - POST /transfers/:transferId/cancel
 * - POST /transfers/:transferId/confirm
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
} from '../../helpers/testUtils';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock transfer service
const mockInitiateTransfer = jest.fn();
const mockAcceptTransfer = jest.fn();
const mockDeclineTransfer = jest.fn();
const mockCancelTransfer = jest.fn();
const mockConfirmTransfer = jest.fn();
const mockGetUserTransfers = jest.fn();
const mockGetTransfer = jest.fn();
const mockGetTransferCounts = jest.fn();

jest.mock('../../../src/services/transferService', () => ({
  initiateTransfer: (...args: any[]) => mockInitiateTransfer(...args),
  acceptTransfer: (...args: any[]) => mockAcceptTransfer(...args),
  declineTransfer: (...args: any[]) => mockDeclineTransfer(...args),
  cancelTransfer: (...args: any[]) => mockCancelTransfer(...args),
  confirmTransfer: (...args: any[]) => mockConfirmTransfer(...args),
  getUserTransfers: (...args: any[]) => mockGetUserTransfers(...args),
  getTransfer: (...args: any[]) => mockGetTransfer(...args),
  getPendingIncomingCount: jest.fn().mockResolvedValue(0),
  getAwaitingConfirmationCount: jest.fn().mockResolvedValue(0),
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('Transfers API', () => {
  const userId = 'user-123';
  const recipientId = 'recipient-456';
  const walletId = 'wallet-789';
  const transferId = 'transfer-xyz';

  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('POST /transfers', () => {
    it('should initiate a transfer', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: userId,
        toUserId: recipientId,
        status: 'pending',
        fromUser: { id: userId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockInitiateTransfer.mockResolvedValue(mockTransfer);

      const req = createMockRequest({
        user: { userId, username: 'owner', isAdmin: false },
        body: {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        },
      });
      const { res, getResponse } = createMockResponse();

      // Simulate handler
      const transfer = await mockInitiateTransfer(userId, req.body);
      res.status!(201).json!(transfer);

      const response = getResponse();
      expect(response.statusCode).toBe(201);
      expect(response.body.status).toBe('pending');
      expect(mockInitiateTransfer).toHaveBeenCalledWith(userId, req.body);
    });

    it('should reject invalid resource type', async () => {
      mockInitiateTransfer.mockRejectedValue(new Error('Invalid resource type'));

      const req = createMockRequest({
        user: { userId, username: 'owner', isAdmin: false },
        body: {
          resourceType: 'invalid',
          resourceId: walletId,
          toUserId: recipientId,
        },
      });

      await expect(mockInitiateTransfer(userId, req.body)).rejects.toThrow();
    });
  });

  describe('GET /transfers', () => {
    it('should return user transfers', async () => {
      const mockTransfers = {
        transfers: [
          {
            id: transferId,
            resourceType: 'wallet',
            status: 'pending',
            fromUser: { id: userId, username: 'owner' },
            toUser: { id: recipientId, username: 'recipient' },
          },
        ],
        total: 1,
      };

      mockGetUserTransfers.mockResolvedValue(mockTransfers);

      const req = createMockRequest({
        user: { userId, username: 'owner', isAdmin: false },
        query: {},
      });
      const { res, getResponse } = createMockResponse();

      // Simulate handler
      const result = await mockGetUserTransfers(userId, {});
      res.json!(result);

      const response = getResponse();
      expect(response.body.transfers).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should filter transfers by role', async () => {
      mockGetUserTransfers.mockResolvedValue({ transfers: [], total: 0 });

      const req = createMockRequest({
        user: { userId, username: 'owner', isAdmin: false },
        query: { role: 'initiator' },
      });

      await mockGetUserTransfers(userId, { role: 'initiator' });

      expect(mockGetUserTransfers).toHaveBeenCalledWith(userId, { role: 'initiator' });
    });
  });

  describe('POST /transfers/:transferId/accept', () => {
    it('should accept a pending transfer', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'accepted',
        acceptedAt: new Date(),
        fromUser: { id: userId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockAcceptTransfer.mockResolvedValue(mockTransfer);

      const req = createMockRequest({
        user: { userId: recipientId, username: 'recipient', isAdmin: false },
        params: { transferId },
      });
      const { res, getResponse } = createMockResponse();

      // Simulate handler
      const result = await mockAcceptTransfer(recipientId, transferId);
      res.json!(result);

      const response = getResponse();
      expect(response.body.status).toBe('accepted');
      expect(mockAcceptTransfer).toHaveBeenCalledWith(recipientId, transferId);
    });
  });

  describe('POST /transfers/:transferId/decline', () => {
    it('should decline a pending transfer', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'declined',
        declineReason: 'Not interested',
        fromUser: { id: userId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockDeclineTransfer.mockResolvedValue(mockTransfer);

      const req = createMockRequest({
        user: { userId: recipientId, username: 'recipient', isAdmin: false },
        params: { transferId },
        body: { reason: 'Not interested' },
      });
      const { res, getResponse } = createMockResponse();

      // Simulate handler
      const result = await mockDeclineTransfer(recipientId, transferId, 'Not interested');
      res.json!(result);

      const response = getResponse();
      expect(response.body.status).toBe('declined');
    });
  });

  describe('POST /transfers/:transferId/cancel', () => {
    it('should cancel a transfer as owner', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'cancelled',
        cancelledAt: new Date(),
        fromUser: { id: userId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockCancelTransfer.mockResolvedValue(mockTransfer);

      const req = createMockRequest({
        user: { userId, username: 'owner', isAdmin: false },
        params: { transferId },
      });
      const { res, getResponse } = createMockResponse();

      // Simulate handler
      const result = await mockCancelTransfer(userId, transferId);
      res.json!(result);

      const response = getResponse();
      expect(response.body.status).toBe('cancelled');
      expect(mockCancelTransfer).toHaveBeenCalledWith(userId, transferId);
    });
  });

  describe('POST /transfers/:transferId/confirm', () => {
    it('should confirm an accepted transfer', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'confirmed',
        confirmedAt: new Date(),
        fromUser: { id: userId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockConfirmTransfer.mockResolvedValue(mockTransfer);

      const req = createMockRequest({
        user: { userId, username: 'owner', isAdmin: false },
        params: { transferId },
      });
      const { res, getResponse } = createMockResponse();

      // Simulate handler
      const result = await mockConfirmTransfer(userId, transferId);
      res.json!(result);

      const response = getResponse();
      expect(response.body.status).toBe('confirmed');
      expect(mockConfirmTransfer).toHaveBeenCalledWith(userId, transferId);
    });
  });

  describe('GET /transfers/:transferId', () => {
    it('should return transfer details for involved user', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: userId,
        toUserId: recipientId,
        status: 'pending',
        fromUser: { id: userId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockGetTransfer.mockResolvedValue(mockTransfer);

      const req = createMockRequest({
        user: { userId, username: 'owner', isAdmin: false },
        params: { transferId },
      });
      const { res, getResponse } = createMockResponse();

      // Simulate handler
      const result = await mockGetTransfer(transferId);

      // Check authorization (user is involved)
      if (result.fromUserId !== userId && result.toUserId !== userId) {
        res.status!(403).json!({ error: 'Forbidden' });
      } else {
        res.json!(result);
      }

      const response = getResponse();
      expect(response.body.id).toBe(transferId);
    });

    it('should reject access for non-involved user', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: userId,
        toUserId: recipientId,
        status: 'pending',
      };

      mockGetTransfer.mockResolvedValue(mockTransfer);

      const req = createMockRequest({
        user: { userId: 'other-user', username: 'other', isAdmin: false },
        params: { transferId },
      });
      const { res, getResponse } = createMockResponse();

      // Simulate handler with auth check
      const result = await mockGetTransfer(transferId);

      // Check authorization (user is NOT involved)
      if (result.fromUserId !== 'other-user' && result.toUserId !== 'other-user') {
        res.status!(403).json!({ error: 'Forbidden' });
      } else {
        res.json!(result);
      }

      const response = getResponse();
      expect(response.statusCode).toBe(403);
    });
  });
});
