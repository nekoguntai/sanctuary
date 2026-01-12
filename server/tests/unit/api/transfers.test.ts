/**
 * Transfers API Routes Tests
 *
 * Tests for ownership transfer endpoints including:
 * - POST /transfers
 * - GET /transfers
 * - GET /transfers/counts
 * - GET /transfers/:id
 * - POST /transfers/:id/accept
 * - POST /transfers/:id/decline
 * - POST /transfers/:id/cancel
 * - POST /transfers/:id/confirm
 */

import { vi, describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Mock dependencies BEFORE importing the router

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock transfer service
vi.mock('../../../src/services/transferService', () => ({
  initiateTransfer: vi.fn(),
  acceptTransfer: vi.fn(),
  declineTransfer: vi.fn(),
  cancelTransfer: vi.fn(),
  confirmTransfer: vi.fn(),
  getUserTransfers: vi.fn(),
  getTransfer: vi.fn(),
  getPendingIncomingCount: vi.fn(),
  getAwaitingConfirmationCount: vi.fn(),
}));

// Mock authenticate middleware - pass through with user
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      // Parse user ID from authorization header for test flexibility
      const userId = req.headers['x-test-user-id'] as string || 'test-user-123';
      req.user = { userId, username: 'testuser', isAdmin: false };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
}));

// Import the router and mocked modules AFTER all mocks are set up
import transfersRouter from '../../../src/api/transfers';
import {
  initiateTransfer,
  acceptTransfer,
  declineTransfer,
  cancelTransfer,
  confirmTransfer,
  getUserTransfers,
  getTransfer,
  getPendingIncomingCount,
  getAwaitingConfirmationCount,
} from '../../../src/services/transferService';

// Get typed references to mocked functions
const mockInitiateTransfer = initiateTransfer as ReturnType<typeof vi.fn>;
const mockAcceptTransfer = acceptTransfer as ReturnType<typeof vi.fn>;
const mockDeclineTransfer = declineTransfer as ReturnType<typeof vi.fn>;
const mockCancelTransfer = cancelTransfer as ReturnType<typeof vi.fn>;
const mockConfirmTransfer = confirmTransfer as ReturnType<typeof vi.fn>;
const mockGetUserTransfers = getUserTransfers as ReturnType<typeof vi.fn>;
const mockGetTransfer = getTransfer as ReturnType<typeof vi.fn>;
const mockGetPendingIncomingCount = getPendingIncomingCount as ReturnType<typeof vi.fn>;
const mockGetAwaitingConfirmationCount = getAwaitingConfirmationCount as ReturnType<typeof vi.fn>;

describe('Transfers API Routes', () => {
  let app: Express;
  const authHeader = 'Bearer valid-token';
  const userId = 'user-123';
  const recipientId = 'recipient-456';
  const walletId = 'wallet-789';
  const transferId = 'transfer-xyz';

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/transfers', transfersRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/v1/transfers', () => {
    it('should initiate a transfer successfully', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: 'test-user-123',
        toUserId: recipientId,
        status: 'pending',
        fromUser: { id: 'test-user-123', username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockInitiateTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
      expect(res.body.resourceType).toBe('wallet');
      expect(mockInitiateTransfer).toHaveBeenCalled();
    });

    it('should return 400 when resourceType is missing', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('resourceType');
    });

    it('should return 400 when resourceId is missing', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          toUserId: recipientId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('resourceId');
    });

    it('should return 400 when toUserId is missing', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('toUserId');
    });

    it('should return 400 for invalid resource type', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'invalid',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('wallet');
    });

    it('should return 404 when resource not found', async () => {
      mockInitiateTransfer.mockRejectedValue(new Error('Resource not found'));

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: 'non-existent',
          toUserId: recipientId,
        });

      expect(res.status).toBe(404);
    });

    it('should return 403 when user is not owner', async () => {
      mockInitiateTransfer.mockRejectedValue(new Error('not the owner'));

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(403);
    });

    it('should return 409 when transfer already pending', async () => {
      mockInitiateTransfer.mockRejectedValue(new Error('already has a pending transfer'));

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(409);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(401);
    });

    it('should include optional fields in transfer', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: 'device-123',
        fromUserId: 'test-user-123',
        toUserId: recipientId,
        status: 'pending',
        message: 'Here is my device',
        keepExistingUsers: true,
      };

      mockInitiateTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'device',
          resourceId: 'device-123',
          toUserId: recipientId,
          message: 'Here is my device',
          keepExistingUsers: true,
          expiresInDays: 7,
        });

      expect(res.status).toBe(201);
      expect(mockInitiateTransfer).toHaveBeenCalledWith(
        'test-user-123',
        expect.objectContaining({
          resourceType: 'device',
          message: 'Here is my device',
          keepExistingUsers: true,
          expiresInDays: 7,
        })
      );
    });
  });

  describe('GET /api/v1/transfers', () => {
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

      const res = await request(app)
        .get('/api/v1/transfers')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.transfers).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it('should filter transfers by role', async () => {
      mockGetUserTransfers.mockResolvedValue({ transfers: [], total: 0 });

      await request(app)
        .get('/api/v1/transfers?role=initiator')
        .set('Authorization', authHeader);

      expect(mockGetUserTransfers).toHaveBeenCalledWith(
        'test-user-123',
        expect.objectContaining({ role: 'initiator' })
      );
    });

    it('should filter transfers by status', async () => {
      mockGetUserTransfers.mockResolvedValue({ transfers: [], total: 0 });

      await request(app)
        .get('/api/v1/transfers?status=pending')
        .set('Authorization', authHeader);

      expect(mockGetUserTransfers).toHaveBeenCalledWith(
        'test-user-123',
        expect.objectContaining({ status: 'pending' })
      );
    });

    it('should filter transfers by resourceType', async () => {
      mockGetUserTransfers.mockResolvedValue({ transfers: [], total: 0 });

      await request(app)
        .get('/api/v1/transfers?resourceType=wallet')
        .set('Authorization', authHeader);

      expect(mockGetUserTransfers).toHaveBeenCalledWith(
        'test-user-123',
        expect.objectContaining({ resourceType: 'wallet' })
      );
    });

    it('should return 500 on service error', async () => {
      mockGetUserTransfers.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .get('/api/v1/transfers')
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/transfers');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/transfers/counts', () => {
    it('should return transfer counts', async () => {
      mockGetPendingIncomingCount.mockResolvedValue(3);
      mockGetAwaitingConfirmationCount.mockResolvedValue(2);

      const res = await request(app)
        .get('/api/v1/transfers/counts')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        pendingIncoming: 3,
        awaitingConfirmation: 2,
        total: 5,
      });
    });

    it('should return zero counts when no transfers', async () => {
      mockGetPendingIncomingCount.mockResolvedValue(0);
      mockGetAwaitingConfirmationCount.mockResolvedValue(0);

      const res = await request(app)
        .get('/api/v1/transfers/counts')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    });

    it('should return 500 on service error', async () => {
      mockGetPendingIncomingCount.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .get('/api/v1/transfers/counts')
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/v1/transfers/:id', () => {
    it('should return transfer details for initiator', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: 'test-user-123',
        toUserId: recipientId,
        status: 'pending',
        fromUser: { id: 'test-user-123', username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockGetTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .get(`/api/v1/transfers/${transferId}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(transferId);
    });

    it('should return transfer details for recipient', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: userId,
        toUserId: 'test-user-123', // The recipient
        status: 'pending',
      };

      mockGetTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .get(`/api/v1/transfers/${transferId}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
    });

    it('should return 404 for non-existent transfer', async () => {
      mockGetTransfer.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/transfers/non-existent')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 for non-involved user', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: userId,
        toUserId: recipientId,
        status: 'pending',
      };

      mockGetTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .get(`/api/v1/transfers/${transferId}`)
        .set('Authorization', authHeader);
      // test-user-123 is not fromUserId or toUserId

      expect(res.status).toBe(403);
    });

    it('should return 500 on service error', async () => {
      mockGetTransfer.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .get(`/api/v1/transfers/${transferId}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/v1/transfers/:id/accept', () => {
    it('should accept a pending transfer', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
        fromUser: { id: userId, username: 'owner' },
        toUser: { id: 'test-user-123', username: 'recipient' },
      };

      mockAcceptTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/accept`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accepted');
      expect(mockAcceptTransfer).toHaveBeenCalledWith('test-user-123', transferId);
    });

    it('should return 404 when transfer not found', async () => {
      mockAcceptTransfer.mockRejectedValue(new Error('Transfer not found'));

      const res = await request(app)
        .post('/api/v1/transfers/non-existent/accept')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 when not recipient', async () => {
      mockAcceptTransfer.mockRejectedValue(new Error('Only the recipient can accept'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/accept`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 400 when transfer cannot be accepted', async () => {
      mockAcceptTransfer.mockRejectedValue(new Error('Transfer cannot be accepted'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/accept`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });

    it('should return 400 when transfer expired', async () => {
      mockAcceptTransfer.mockRejectedValue(new Error('Transfer has expired'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/accept`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/transfers/:id/decline', () => {
    it('should decline a pending transfer', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'declined',
        declineReason: 'Not interested',
      };

      mockDeclineTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/decline`)
        .set('Authorization', authHeader)
        .send({ reason: 'Not interested' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('declined');
      expect(mockDeclineTransfer).toHaveBeenCalledWith('test-user-123', transferId, 'Not interested');
    });

    it('should decline without reason', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'declined',
      };

      mockDeclineTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/decline`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(mockDeclineTransfer).toHaveBeenCalledWith('test-user-123', transferId, undefined);
    });

    it('should return 404 when transfer not found', async () => {
      mockDeclineTransfer.mockRejectedValue(new Error('Transfer not found'));

      const res = await request(app)
        .post('/api/v1/transfers/non-existent/decline')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 when not recipient', async () => {
      mockDeclineTransfer.mockRejectedValue(new Error('Only the recipient can decline'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/decline`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 400 when transfer cannot be declined', async () => {
      mockDeclineTransfer.mockRejectedValue(new Error('Transfer cannot be declined'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/decline`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/transfers/:id/cancel', () => {
    it('should cancel a transfer', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      };

      mockCancelTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/cancel`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
      expect(mockCancelTransfer).toHaveBeenCalledWith('test-user-123', transferId);
    });

    it('should return 404 when transfer not found', async () => {
      mockCancelTransfer.mockRejectedValue(new Error('Transfer not found'));

      const res = await request(app)
        .post('/api/v1/transfers/non-existent/cancel')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 when not initiator', async () => {
      mockCancelTransfer.mockRejectedValue(new Error('Only the transfer initiator can cancel'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/cancel`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 400 when transfer cannot be cancelled', async () => {
      mockCancelTransfer.mockRejectedValue(new Error('Transfer cannot be cancelled'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/cancel`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/transfers/:id/confirm', () => {
    it('should confirm an accepted transfer', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        status: 'completed',
        confirmedAt: new Date().toISOString(),
      };

      mockConfirmTransfer.mockResolvedValue(mockTransfer);

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
      expect(mockConfirmTransfer).toHaveBeenCalledWith('test-user-123', transferId);
    });

    it('should return 404 when transfer not found', async () => {
      mockConfirmTransfer.mockRejectedValue(new Error('Transfer not found'));

      const res = await request(app)
        .post('/api/v1/transfers/non-existent/confirm')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 when not initiator', async () => {
      mockConfirmTransfer.mockRejectedValue(new Error('Only the transfer initiator can confirm'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 403 when no longer owner', async () => {
      mockConfirmTransfer.mockRejectedValue(new Error('You no longer own this resource'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 400 when transfer cannot be confirmed', async () => {
      mockConfirmTransfer.mockRejectedValue(new Error('Transfer cannot be confirmed'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });

    it('should return 400 when transfer expired', async () => {
      mockConfirmTransfer.mockRejectedValue(new Error('Transfer has expired'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });

    it('should return 500 when transfer execution fails', async () => {
      mockConfirmTransfer.mockRejectedValue(new Error('Transfer failed during execution'));

      const res = await request(app)
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Transfer Failed');
    });
  });

  describe('Error Handling', () => {
    it('should return 500 for unexpected errors', async () => {
      mockInitiateTransfer.mockRejectedValue(new Error('Unexpected error'));

      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });
});
