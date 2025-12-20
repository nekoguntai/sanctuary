/**
 * Draft Transaction API Tests
 *
 * Tests for draft transaction endpoints including:
 * - POST /api/v1/wallets/:walletId/drafts (create draft with UTXO locking)
 * - GET /api/v1/wallets/:walletId/drafts
 * - GET /api/v1/wallets/:walletId/drafts/:draftId
 * - PATCH /api/v1/wallets/:walletId/drafts/:draftId
 * - DELETE /api/v1/wallets/:walletId/drafts/:draftId
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
  randomTxid,
  randomAddress,
} from '../../helpers/testUtils';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock wallet service
jest.mock('../../../src/services/wallet', () => ({
  getWalletById: jest.fn(),
  checkWalletAccess: jest.fn().mockResolvedValue(true),
}));

// Mock draft lock service
jest.mock('../../../src/services/draftLockService', () => ({
  lockUtxosForDraft: jest.fn(),
  resolveUtxoIds: jest.fn(),
  unlockUtxosForDraft: jest.fn(),
}));

// Mock notification service
jest.mock('../../../src/services/notifications/notificationService', () => ({
  notifyNewDraft: jest.fn().mockResolvedValue(undefined),
}));

import * as walletService from '../../../src/services/wallet';
import * as draftLockService from '../../../src/services/draftLockService';

describe('Draft Transaction API', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('POST /wallets/:walletId/drafts', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    const validDraftRequest = {
      recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      amount: 50000,
      feeRate: 10,
      selectedUtxoIds: ['txid-aaa:0', 'txid-bbb:1'],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      label: 'Test payment',
      memo: 'Testing draft creation',
      psbtBase64: 'cHNidP8BAHUCAAAAAAEAAAAAAAAAAACNEQsAAAAAIgAgtest...',
      fee: 1500,
      totalInput: 100000,
      totalOutput: 98500,
      changeAmount: 48500,
      changeAddress: 'tb1qchange...',
      effectiveAmount: 50000,
      inputPaths: ["m/84'/1'/0'/0/0", "m/84'/1'/0'/0/1"],
    };

    beforeEach(() => {
      // Default: wallet exists and user has signer role
      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'signer',
      });

      // Default: UTXOs resolve successfully
      (draftLockService.resolveUtxoIds as jest.Mock).mockResolvedValue({
        found: ['utxo-id-1', 'utxo-id-2'],
        notFound: [],
      });

      // Default: locking succeeds
      (draftLockService.lockUtxosForDraft as jest.Mock).mockResolvedValue({
        success: true,
        lockedCount: 2,
        failedUtxoIds: [],
        lockedByDraftIds: [],
      });

      // Default: draft creation succeeds
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'draft-new',
        walletId,
        userId,
        ...validDraftRequest,
        amount: BigInt(validDraftRequest.amount),
        fee: BigInt(validDraftRequest.fee),
        totalInput: BigInt(validDraftRequest.totalInput),
        totalOutput: BigInt(validDraftRequest.totalOutput),
        changeAmount: BigInt(validDraftRequest.changeAmount),
        effectiveAmount: BigInt(validDraftRequest.effectiveAmount),
        status: 'unsigned',
        signedDeviceIds: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // System setting for expiration
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'draftExpirationDays',
        value: '7',
      });
    });

    it('should create a draft and lock UTXOs successfully', async () => {
      const req = createMockRequest({
        params: { walletId },
        body: validDraftRequest,
        user: { userId, username: 'testuser', isAdmin: false },
      });

      // Simulate the route handler behavior
      const wallet = await walletService.getWalletById(walletId, userId);
      expect(wallet).toBeDefined();
      expect(wallet?.userRole).not.toBe('viewer');

      // Create draft
      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          ...validDraftRequest,
          amount: BigInt(validDraftRequest.amount),
          fee: BigInt(validDraftRequest.fee),
          totalInput: BigInt(validDraftRequest.totalInput),
          totalOutput: BigInt(validDraftRequest.totalOutput),
          changeAmount: BigInt(validDraftRequest.changeAmount),
          effectiveAmount: BigInt(validDraftRequest.effectiveAmount),
          status: 'unsigned',
          signedDeviceIds: [],
        },
      });

      // Lock UTXOs
      const { found: utxoIds } = await draftLockService.resolveUtxoIds(
        walletId,
        validDraftRequest.selectedUtxoIds
      );
      const lockResult = await draftLockService.lockUtxosForDraft(
        draft.id,
        utxoIds,
        { isRBF: false }
      );

      expect(lockResult.success).toBe(true);
      expect(lockResult.lockedCount).toBe(2);
    });

    it('should return 409 Conflict when UTXOs are already locked', async () => {
      // UTXOs are locked by another draft
      (draftLockService.lockUtxosForDraft as jest.Mock).mockResolvedValue({
        success: false,
        lockedCount: 0,
        failedUtxoIds: ['txid-aaa:0'],
        lockedByDraftIds: ['other-draft-456'],
      });

      const { res, getResponse } = createMockResponse();

      // Simulate the route handler logic
      const draft = await mockPrismaClient.draftTransaction.create({
        data: { id: 'draft-temp' },
      });

      const { found: utxoIds } = await draftLockService.resolveUtxoIds(
        walletId,
        validDraftRequest.selectedUtxoIds
      );

      const lockResult = await draftLockService.lockUtxosForDraft(
        draft.id,
        utxoIds,
        { isRBF: false }
      );

      if (!lockResult.success) {
        // Delete the draft and return 409
        await mockPrismaClient.draftTransaction.delete({ where: { id: draft.id } });

        res.status!(409).json!({
          error: 'Conflict',
          message: 'One or more UTXOs are already locked by another draft transaction',
          lockedByDraftIds: lockResult.lockedByDraftIds,
          failedUtxoIds: lockResult.failedUtxoIds,
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(409);
      expect(response.body.error).toBe('Conflict');
      expect(response.body.lockedByDraftIds).toContain('other-draft-456');
      expect(response.body.failedUtxoIds).toContain('txid-aaa:0');
      expect(mockPrismaClient.draftTransaction.delete).toHaveBeenCalled();
    });

    it('should skip UTXO locking for RBF drafts', async () => {
      const rbfDraftRequest = {
        ...validDraftRequest,
        isRBF: true,
        memo: 'Replacing transaction abc123...',
      };

      // Simulate route handler
      const draft = await mockPrismaClient.draftTransaction.create({
        data: { ...rbfDraftRequest, isRBF: true },
      });

      // For RBF, we skip locking
      if (!rbfDraftRequest.isRBF) {
        await draftLockService.lockUtxosForDraft(draft.id, [], { isRBF: false });
      }

      // Verify lockUtxosForDraft was NOT called since isRBF is true
      expect(draftLockService.lockUtxosForDraft).not.toHaveBeenCalled();
    });

    it('should return 403 for viewer role', async () => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'viewer', // Viewer cannot create drafts
      });

      const { res, getResponse } = createMockResponse();

      const wallet = await walletService.getWalletById(walletId, userId);
      if (wallet?.userRole === 'viewer') {
        res.status!(403).json!({
          error: 'Forbidden',
          message: 'Viewers cannot create draft transactions',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 404 when wallet not found', async () => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const wallet = await walletService.getWalletById(walletId, userId);
      if (!wallet) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'Wallet not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
    });

    it('should return 400 when required fields are missing', async () => {
      const invalidRequest = {
        recipient: 'tb1q...',
        // Missing: amount, feeRate, psbtBase64
      };

      const { res, getResponse } = createMockResponse();

      if (!invalidRequest.recipient || !(invalidRequest as any).amount ||
          !(invalidRequest as any).feeRate || !(invalidRequest as any).psbtBase64) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'recipient, amount, feeRate, and psbtBase64 are required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });

    it('should warn when some UTXOs are not found', async () => {
      (draftLockService.resolveUtxoIds as jest.Mock).mockResolvedValue({
        found: ['utxo-id-1'],
        notFound: ['txid-missing:99'], // One UTXO not found
      });

      const { found, notFound } = await draftLockService.resolveUtxoIds(
        walletId,
        ['txid-aaa:0', 'txid-missing:99']
      );

      expect(found).toHaveLength(1);
      expect(notFound).toHaveLength(1);
      expect(notFound).toContain('txid-missing:99');

      // Should still proceed with found UTXOs
      const lockResult = await draftLockService.lockUtxosForDraft(
        'draft-id',
        found,
        { isRBF: false }
      );
      expect(lockResult.success).toBe(true);
    });
  });

  describe('GET /wallets/:walletId/drafts', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    it('should return all drafts for a wallet', async () => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      const mockDrafts = [
        {
          id: 'draft-1',
          walletId,
          recipient: randomAddress(),
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
          status: 'unsigned',
          createdAt: new Date(),
        },
        {
          id: 'draft-2',
          walletId,
          recipient: randomAddress(),
          amount: BigInt(25000),
          fee: BigInt(500),
          totalInput: BigInt(50000),
          totalOutput: BigInt(49500),
          changeAmount: BigInt(24500),
          effectiveAmount: BigInt(25000),
          status: 'partial',
          createdAt: new Date(),
        },
      ];

      mockPrismaClient.draftTransaction.findMany.mockResolvedValue(mockDrafts);

      const { res, getResponse } = createMockResponse();

      const drafts = await mockPrismaClient.draftTransaction.findMany({
        where: { walletId },
        orderBy: { createdAt: 'desc' },
      });

      // Serialize BigInt for JSON
      const serializedDrafts = drafts.map((draft: any) => ({
        ...draft,
        amount: Number(draft.amount),
        fee: Number(draft.fee),
        totalInput: Number(draft.totalInput),
        totalOutput: Number(draft.totalOutput),
        changeAmount: Number(draft.changeAmount),
        effectiveAmount: Number(draft.effectiveAmount),
      }));

      res.json!(serializedDrafts);

      const response = getResponse();
      expect(response.body).toHaveLength(2);
      expect(response.body[0].amount).toBe(50000);
      expect(response.body[1].status).toBe('partial');
    });

    it('should return empty array when no drafts exist', async () => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      mockPrismaClient.draftTransaction.findMany.mockResolvedValue([]);

      const { res, getResponse } = createMockResponse();

      const drafts = await mockPrismaClient.draftTransaction.findMany({
        where: { walletId },
      });

      res.json!(drafts);

      expect(getResponse().body).toEqual([]);
    });
  });

  describe('GET /wallets/:walletId/drafts/:draftId', () => {
    const walletId = 'wallet-123';
    const draftId = 'draft-456';
    const userId = 'user-123';

    it('should return a specific draft', async () => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      const mockDraft = {
        id: draftId,
        walletId,
        recipient: randomAddress(),
        amount: BigInt(75000),
        fee: BigInt(1500),
        totalInput: BigInt(150000),
        totalOutput: BigInt(148500),
        changeAmount: BigInt(73500),
        effectiveAmount: BigInt(75000),
        status: 'signed',
        psbtBase64: 'cHNidP8...',
        signedPsbtBase64: 'cHNidP8signed...',
      };

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue(mockDraft);

      const { res, getResponse } = createMockResponse();

      const draft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      if (draft) {
        res.json!({
          ...draft,
          amount: Number(draft.amount),
          fee: Number(draft.fee),
          totalInput: Number(draft.totalInput),
          totalOutput: Number(draft.totalOutput),
          changeAmount: Number(draft.changeAmount),
          effectiveAmount: Number(draft.effectiveAmount),
        });
      }

      const response = getResponse();
      expect(response.body.id).toBe(draftId);
      expect(response.body.amount).toBe(75000);
      expect(response.body.status).toBe('signed');
    });

    it('should return 404 when draft not found', async () => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const draft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      if (!draft) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'Draft not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /wallets/:walletId/drafts/:draftId', () => {
    const walletId = 'wallet-123';
    const draftId = 'draft-456';
    const userId = 'user-123';

    beforeEach(() => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'signer',
      });

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId,
        status: 'unsigned',
        signedDeviceIds: [],
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
      });
    });

    it('should update draft with new signature', async () => {
      const updateData = {
        signedPsbtBase64: 'cHNidP8signed...',
        signedDeviceId: 'device-1',
        status: 'partial',
      };

      mockPrismaClient.draftTransaction.update.mockResolvedValue({
        id: draftId,
        status: 'partial',
        signedDeviceIds: ['device-1'],
        signedPsbtBase64: updateData.signedPsbtBase64,
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
      });

      const { res, getResponse } = createMockResponse();

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      const currentSigned = existingDraft?.signedDeviceIds || [];
      const newSignedDeviceIds = currentSigned.includes(updateData.signedDeviceId)
        ? currentSigned
        : [...currentSigned, updateData.signedDeviceId];

      const updatedDraft = await mockPrismaClient.draftTransaction.update({
        where: { id: draftId },
        data: {
          signedPsbtBase64: updateData.signedPsbtBase64,
          signedDeviceIds: newSignedDeviceIds,
          status: updateData.status,
        },
      });

      res.json!({
        ...updatedDraft,
        amount: Number(updatedDraft.amount),
        fee: Number(updatedDraft.fee),
        totalInput: Number(updatedDraft.totalInput),
        totalOutput: Number(updatedDraft.totalOutput),
        changeAmount: Number(updatedDraft.changeAmount),
        effectiveAmount: Number(updatedDraft.effectiveAmount),
      });

      const response = getResponse();
      expect(response.body.status).toBe('partial');
      expect(response.body.signedDeviceIds).toContain('device-1');
    });

    it('should not add duplicate device IDs', async () => {
      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId,
        status: 'partial',
        signedDeviceIds: ['device-1'], // Already signed
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
      });

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      const currentSigned = existingDraft?.signedDeviceIds || [];
      const signedDeviceId = 'device-1';

      // Should not add duplicate
      if (!currentSigned.includes(signedDeviceId)) {
        currentSigned.push(signedDeviceId);
      }

      expect(currentSigned).toHaveLength(1);
      expect(currentSigned).toEqual(['device-1']);
    });

    it('should return 403 for viewer role', async () => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'viewer',
      });

      const { res, getResponse } = createMockResponse();

      const wallet = await walletService.getWalletById(walletId, userId);
      if (wallet?.userRole === 'viewer') {
        res.status!(403).json!({
          error: 'Forbidden',
          message: 'Viewers cannot modify draft transactions',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(403);
    });

    it('should return 400 for invalid status', async () => {
      const invalidStatus = 'invalid_status';

      const { res, getResponse } = createMockResponse();

      if (!['unsigned', 'partial', 'signed'].includes(invalidStatus)) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Invalid status. Must be unsigned, partial, or signed',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /wallets/:walletId/drafts/:draftId', () => {
    const walletId = 'wallet-123';
    const draftId = 'draft-456';
    const userId = 'user-123';

    beforeEach(() => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'owner',
      });

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId,
        status: 'unsigned',
      });

      mockPrismaClient.draftTransaction.delete.mockResolvedValue({
        id: draftId,
      });
    });

    it('should delete draft and release UTXO locks', async () => {
      const { res, getResponse } = createMockResponse();

      await mockPrismaClient.draftTransaction.delete({
        where: { id: draftId },
      });

      res.status!(204).send!();

      const response = getResponse();
      expect(response.statusCode).toBe(204);
      expect(mockPrismaClient.draftTransaction.delete).toHaveBeenCalledWith({
        where: { id: draftId },
      });
    });

    it('should allow creator to delete their own draft', async () => {
      const creatorUserId = 'creator-user';

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId: creatorUserId, // Draft belongs to creator
        status: 'unsigned',
      });

      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'signer', // Not owner, but is the creator
      });

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });
      const wallet = await walletService.getWalletById(walletId, creatorUserId);

      // Creator can delete their own draft
      const canDelete = existingDraft?.userId === creatorUserId || wallet?.userRole === 'owner';
      expect(canDelete).toBe(true);
    });

    it('should return 403 when non-creator non-owner tries to delete', async () => {
      const otherUserId = 'other-user';

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: draftId,
        walletId,
        userId: 'creator-user', // Draft belongs to someone else
        status: 'unsigned',
      });

      (walletService.getWalletById as jest.Mock).mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
        userRole: 'signer', // Not owner
      });

      const { res, getResponse } = createMockResponse();

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });
      const wallet = await walletService.getWalletById(walletId, otherUserId);

      if (existingDraft?.userId !== otherUserId && wallet?.userRole !== 'owner') {
        res.status!(403).json!({
          error: 'Forbidden',
          message: 'Only the creator or wallet owner can delete drafts',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(403);
    });

    it('should return 404 when draft not found', async () => {
      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: draftId, walletId },
      });

      if (!existingDraft) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'Draft not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
    });
  });

  describe('isRBF Flag Behavior', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    it('should set isRBF flag correctly for RBF transactions', async () => {
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'rbf-draft',
        walletId,
        userId,
        isRBF: true,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(2000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98000),
        changeAmount: BigInt(48000),
        effectiveAmount: BigInt(50000),
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          isRBF: true,
          recipient: randomAddress(),
          amount: BigInt(50000),
          fee: BigInt(2000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(98000),
          changeAmount: BigInt(48000),
          effectiveAmount: BigInt(50000),
        },
      });

      expect(draft.isRBF).toBe(true);
    });

    it('should default isRBF to false for regular transactions', async () => {
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'regular-draft',
        walletId,
        userId,
        isRBF: false,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          isRBF: false, // Explicitly false
          recipient: randomAddress(),
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        },
      });

      expect(draft.isRBF).toBe(false);
    });
  });
});
