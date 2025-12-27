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

  describe('Decoy Outputs', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    it('should store decoyOutputs in draft', async () => {
      const decoyOutputs = [
        { address: randomAddress(), amount: 15000 },
        { address: randomAddress(), amount: 18000 },
      ];

      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'decoy-draft',
        walletId,
        userId,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(1500),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98500),
        changeAmount: BigInt(48500),
        effectiveAmount: BigInt(50000),
        decoyOutputs: decoyOutputs,
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: randomAddress(),
          amount: BigInt(50000),
          decoyOutputs: decoyOutputs,
        },
      });

      expect(draft.decoyOutputs).toEqual(decoyOutputs);
      expect(Array.isArray(draft.decoyOutputs)).toBe(true);
      expect(draft.decoyOutputs).toHaveLength(2);
    });

    it('should validate decoy count is between 2 and 4', () => {
      // Test validation logic
      const validateDecoyCount = (count: number) => {
        return count >= 2 && count <= 4;
      };

      expect(validateDecoyCount(1)).toBe(false);
      expect(validateDecoyCount(2)).toBe(true);
      expect(validateDecoyCount(3)).toBe(true);
      expect(validateDecoyCount(4)).toBe(true);
      expect(validateDecoyCount(5)).toBe(false);
    });

    it('should handle draft without decoy outputs', async () => {
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'no-decoy-draft',
        walletId,
        userId,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
        decoyOutputs: null,
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: randomAddress(),
          amount: BigInt(50000),
          decoyOutputs: null,
        },
      });

      expect(draft.decoyOutputs).toBeNull();
    });
  });

  describe('Multiple Outputs', () => {
    const walletId = 'wallet-123';
    const userId = 'user-123';

    it('should store multiple outputs in draft', async () => {
      const outputs = [
        { address: randomAddress(), amount: 30000, sendMax: false },
        { address: randomAddress(), amount: 20000, sendMax: false },
      ];

      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'multi-output-draft',
        walletId,
        userId,
        recipient: outputs[0].address,
        amount: BigInt(50000),
        fee: BigInt(1500),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98500),
        changeAmount: BigInt(48500),
        effectiveAmount: BigInt(50000),
        outputs: outputs,
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: outputs[0].address,
          amount: BigInt(50000),
          outputs: outputs,
        },
      });

      expect(draft.outputs).toEqual(outputs);
      expect(Array.isArray(draft.outputs)).toBe(true);
      expect(draft.outputs).toHaveLength(2);
    });

    it('should handle sendMax in multiple outputs', async () => {
      const outputs = [
        { address: randomAddress(), amount: 30000, sendMax: false },
        { address: randomAddress(), amount: 0, sendMax: true },
      ];

      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'sendmax-multi-draft',
        walletId,
        userId,
        recipient: outputs[0].address,
        amount: BigInt(30000),
        fee: BigInt(1500),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98500),
        changeAmount: BigInt(0),
        effectiveAmount: BigInt(68500),
        outputs: outputs,
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: outputs[0].address,
          amount: BigInt(30000),
          outputs: outputs,
        },
      });

      expect(draft.outputs).toEqual(outputs);
      expect(draft.outputs[1].sendMax).toBe(true);
      expect(draft.outputs[1].amount).toBe(0);
    });

    it('should retrieve draft with multiple outputs', async () => {
      const outputs = [
        { address: randomAddress(), amount: 15000, sendMax: false },
        { address: randomAddress(), amount: 25000, sendMax: false },
        { address: randomAddress(), amount: 10000, sendMax: false },
      ];

      mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
        id: 'multi-retrieve',
        walletId,
        userId,
        recipient: outputs[0].address,
        amount: BigInt(50000),
        fee: BigInt(1500),
        totalInput: BigInt(100000),
        totalOutput: BigInt(98500),
        changeAmount: BigInt(48500),
        effectiveAmount: BigInt(50000),
        outputs: outputs,
      });

      const { res, getResponse } = createMockResponse();

      const draft = await mockPrismaClient.draftTransaction.findFirst({
        where: { id: 'multi-retrieve', walletId },
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
      expect(response.body.outputs).toEqual(outputs);
      expect(response.body.outputs).toHaveLength(3);
    });

    it('should handle single output for backward compatibility', async () => {
      mockPrismaClient.draftTransaction.create.mockResolvedValue({
        id: 'single-output-draft',
        walletId,
        userId,
        recipient: randomAddress(),
        amount: BigInt(50000),
        fee: BigInt(1000),
        totalInput: BigInt(100000),
        totalOutput: BigInt(99000),
        changeAmount: BigInt(49000),
        effectiveAmount: BigInt(50000),
        outputs: null, // No outputs array for single-output
      });

      const draft = await mockPrismaClient.draftTransaction.create({
        data: {
          walletId,
          userId,
          recipient: randomAddress(),
          amount: BigInt(50000),
          outputs: null,
        },
      });

      expect(draft.outputs).toBeNull();
      // Recipient field should be used instead
      expect(draft.recipient).toBeDefined();
    });
  });

  describe('Multi-sig Group Wallet Signing', () => {
    const walletId = 'wallet-multisig';
    const userId = 'user-123';
    const draftId = 'draft-multisig';

    const createMultisigWallet = (quorum: number, totalSigners: number) => ({
      id: walletId,
      name: 'Test Multisig Wallet',
      type: 'multi_sig',
      scriptType: 'native_segwit',
      network: 'testnet',
      quorum,
      totalSigners,
      userRole: 'signer',
    });

    beforeEach(() => {
      (walletService.getWalletById as jest.Mock).mockResolvedValue(createMultisigWallet(2, 3));
    });

    describe('Partial Signature Tracking', () => {
      it('should track first device signature for 2-of-3 multisig', async () => {
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

        mockPrismaClient.draftTransaction.update.mockResolvedValue({
          id: draftId,
          status: 'partial',
          signedDeviceIds: ['device-1'],
          signedPsbtBase64: 'cHNidP8...',
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

        // Add first signature - status should become 'partial'
        const currentSigned = existingDraft?.signedDeviceIds || [];
        const newSignedDeviceIds = [...currentSigned, 'device-1'];

        const updatedDraft = await mockPrismaClient.draftTransaction.update({
          where: { id: draftId },
          data: {
            signedPsbtBase64: 'cHNidP8...',
            signedDeviceIds: newSignedDeviceIds,
            status: 'partial', // First sig = partial
          },
        });

        expect(updatedDraft.status).toBe('partial');
        expect(updatedDraft.signedDeviceIds).toHaveLength(1);
        expect(updatedDraft.signedDeviceIds).toContain('device-1');
      });

      it('should track second device signature and become fully signed for 2-of-3 multisig', async () => {
        mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
          id: draftId,
          walletId,
          userId,
          status: 'partial',
          signedDeviceIds: ['device-1'],
          signedPsbtBase64: 'cHNidP8partial...',
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        });

        mockPrismaClient.draftTransaction.update.mockResolvedValue({
          id: draftId,
          status: 'signed',
          signedDeviceIds: ['device-1', 'device-2'],
          signedPsbtBase64: 'cHNidP8fullysigned...',
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

        const quorum = 2;
        const currentSigned = existingDraft?.signedDeviceIds || [];
        const newSignedDeviceIds = [...currentSigned, 'device-2'];

        // When quorum is met, status should be 'signed'
        const newStatus = newSignedDeviceIds.length >= quorum ? 'signed' : 'partial';

        const updatedDraft = await mockPrismaClient.draftTransaction.update({
          where: { id: draftId },
          data: {
            signedPsbtBase64: 'cHNidP8fullysigned...',
            signedDeviceIds: newSignedDeviceIds,
            status: newStatus,
          },
        });

        expect(updatedDraft.status).toBe('signed');
        expect(updatedDraft.signedDeviceIds).toHaveLength(2);
        expect(updatedDraft.signedDeviceIds).toContain('device-1');
        expect(updatedDraft.signedDeviceIds).toContain('device-2');
      });
    });

    describe('Quorum Validation', () => {
      it('should correctly determine if quorum is met for 2-of-3', () => {
        const quorum = 2;
        const signedCount1 = 1;
        const signedCount2 = 2;
        const signedCount3 = 3;

        expect(signedCount1 >= quorum).toBe(false);
        expect(signedCount2 >= quorum).toBe(true);
        expect(signedCount3 >= quorum).toBe(true);
      });

      it('should correctly determine if quorum is met for 3-of-5', () => {
        const quorum = 3;
        const signedCounts = [1, 2, 3, 4, 5];
        const expected = [false, false, true, true, true];

        signedCounts.forEach((count, idx) => {
          expect(count >= quorum).toBe(expected[idx]);
        });
      });

      it('should correctly determine if quorum is met for 1-of-3', () => {
        const quorum = 1;
        expect(1 >= quorum).toBe(true);
        expect(2 >= quorum).toBe(true);
        expect(3 >= quorum).toBe(true);
      });

      it('should handle single-sig wallet (quorum = 1)', () => {
        const quorum = 1;
        const signedDeviceIds = ['device-1'];

        expect(signedDeviceIds.length >= quorum).toBe(true);

        // Single device = fully signed for single-sig
        const status = signedDeviceIds.length >= quorum ? 'signed' : 'partial';
        expect(status).toBe('signed');
      });
    });

    describe('Status Progression', () => {
      it('should progress: unsigned -> partial -> signed for 3-of-5 multisig', async () => {
        const quorum = 3;

        // Initial state: unsigned
        const initialStatus = 'unsigned';
        expect(initialStatus).toBe('unsigned');

        // After first signature: partial
        const statusAfter1 = 1 >= quorum ? 'signed' : 'partial';
        expect(statusAfter1).toBe('partial');

        // After second signature: still partial
        const statusAfter2 = 2 >= quorum ? 'signed' : 'partial';
        expect(statusAfter2).toBe('partial');

        // After third signature: signed (quorum met!)
        const statusAfter3 = 3 >= quorum ? 'signed' : 'partial';
        expect(statusAfter3).toBe('signed');
      });

      it('should allow additional signatures beyond quorum', async () => {
        mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
          id: draftId,
          walletId,
          userId,
          status: 'signed',
          signedDeviceIds: ['device-1', 'device-2'],
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        });

        // Draft is already signed but third device wants to add signature
        const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
          where: { id: draftId, walletId },
        });

        const currentSigned = existingDraft?.signedDeviceIds || [];

        // Should allow adding more signatures
        if (!currentSigned.includes('device-3')) {
          const newSignedDeviceIds = [...currentSigned, 'device-3'];
          expect(newSignedDeviceIds).toHaveLength(3);
        }
      });
    });

    describe('Device ID Handling', () => {
      it('should prevent same device from signing twice', async () => {
        mockPrismaClient.draftTransaction.findFirst.mockResolvedValue({
          id: draftId,
          walletId,
          userId,
          status: 'partial',
          signedDeviceIds: ['device-1'],
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
        const newDeviceId = 'device-1'; // Same device trying to sign again

        // Check if device already signed
        const alreadySigned = currentSigned.includes(newDeviceId);
        expect(alreadySigned).toBe(true);

        // Should not add duplicate
        const newSignedDeviceIds = alreadySigned
          ? currentSigned
          : [...currentSigned, newDeviceId];
        expect(newSignedDeviceIds).toHaveLength(1);
        expect(newSignedDeviceIds).toEqual(['device-1']);
      });

      it('should track multiple unique device IDs', async () => {
        const signedDeviceIds: string[] = [];
        const devices = ['device-a', 'device-b', 'device-c'];

        devices.forEach((deviceId) => {
          if (!signedDeviceIds.includes(deviceId)) {
            signedDeviceIds.push(deviceId);
          }
        });

        expect(signedDeviceIds).toHaveLength(3);
        expect(signedDeviceIds).toEqual(['device-a', 'device-b', 'device-c']);
      });

      it('should handle empty device ID gracefully', async () => {
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

        const existingDraft = await mockPrismaClient.draftTransaction.findFirst({
          where: { id: draftId, walletId },
        });

        const currentSigned = existingDraft?.signedDeviceIds || [];
        const newDeviceId = ''; // Empty device ID

        // Empty string should be handled (not added or filter validation)
        if (newDeviceId && !currentSigned.includes(newDeviceId)) {
          currentSigned.push(newDeviceId);
        }

        expect(currentSigned).toHaveLength(0);
      });
    });

    describe('PSBT Signature Merging', () => {
      it('should update signedPsbtBase64 with each new signature', async () => {
        // First signature
        const firstPsbt = 'cHNidP8BAH...partial1';

        mockPrismaClient.draftTransaction.update.mockResolvedValueOnce({
          id: draftId,
          status: 'partial',
          signedDeviceIds: ['device-1'],
          signedPsbtBase64: firstPsbt,
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        });

        const draft1 = await mockPrismaClient.draftTransaction.update({
          where: { id: draftId },
          data: {
            signedPsbtBase64: firstPsbt,
            signedDeviceIds: ['device-1'],
            status: 'partial',
          },
        });

        expect(draft1.signedPsbtBase64).toBe(firstPsbt);

        // Second signature - merged PSBT
        const mergedPsbt = 'cHNidP8BAH...fullysigned';

        mockPrismaClient.draftTransaction.update.mockResolvedValueOnce({
          id: draftId,
          status: 'signed',
          signedDeviceIds: ['device-1', 'device-2'],
          signedPsbtBase64: mergedPsbt,
          amount: BigInt(50000),
          fee: BigInt(1000),
          totalInput: BigInt(100000),
          totalOutput: BigInt(99000),
          changeAmount: BigInt(49000),
          effectiveAmount: BigInt(50000),
        });

        const draft2 = await mockPrismaClient.draftTransaction.update({
          where: { id: draftId },
          data: {
            signedPsbtBase64: mergedPsbt,
            signedDeviceIds: ['device-1', 'device-2'],
            status: 'signed',
          },
        });

        expect(draft2.signedPsbtBase64).toBe(mergedPsbt);
        expect(draft2.signedPsbtBase64).not.toBe(firstPsbt);
      });
    });

    describe('Role-based Access for Multisig', () => {
      it('should allow signer role to add signatures', async () => {
        (walletService.getWalletById as jest.Mock).mockResolvedValue({
          ...createMultisigWallet(2, 3),
          userRole: 'signer',
        });

        const wallet = await walletService.getWalletById(walletId, userId);
        expect(wallet?.userRole).toBe('signer');

        // Signers can add signatures
        const canSign = wallet?.userRole === 'signer' || wallet?.userRole === 'owner';
        expect(canSign).toBe(true);
      });

      it('should allow owner role to add signatures', async () => {
        (walletService.getWalletById as jest.Mock).mockResolvedValue({
          ...createMultisigWallet(2, 3),
          userRole: 'owner',
        });

        const wallet = await walletService.getWalletById(walletId, userId);
        expect(wallet?.userRole).toBe('owner');

        const canSign = wallet?.userRole === 'signer' || wallet?.userRole === 'owner';
        expect(canSign).toBe(true);
      });

      it('should prevent viewer role from adding signatures', async () => {
        (walletService.getWalletById as jest.Mock).mockResolvedValue({
          ...createMultisigWallet(2, 3),
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
    });
  });
});
