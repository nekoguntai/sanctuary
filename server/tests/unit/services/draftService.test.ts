import { vi, Mock } from 'vitest';
/**
 * Draft Service Tests
 *
 * Tests for draft transaction management including CRUD operations
 * and UTXO locking.
 */

// Mock dependencies before imports
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    systemSetting: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/repositories', () => ({
  draftRepository: {
    findByWalletId: vi.fn(),
    findByIdInWallet: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    deleteExpired: vi.fn(),
  },
  DraftStatus: {
    UNSIGNED: 'unsigned',
    PARTIAL: 'partial',
    SIGNED: 'signed',
  },
}));

vi.mock('../../../src/services/accessControl', () => ({
  requireWalletAccess: vi.fn(),
  checkWalletAccess: vi.fn(),
}));

vi.mock('../../../src/services/draftLockService', () => ({
  lockUtxosForDraft: vi.fn(),
  resolveUtxoIds: vi.fn(),
}));

vi.mock('../../../src/services/notifications/notificationService', () => ({
  notifyNewDraft: vi.fn(),
}));

vi.mock('../../../src/services/wallet', () => ({
  getWalletById: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/constants', () => ({
  DEFAULT_DRAFT_EXPIRATION_DAYS: 7,
}));

import prisma from '../../../src/models/prisma';
import { draftRepository } from '../../../src/repositories';
import { lockUtxosForDraft, resolveUtxoIds } from '../../../src/services/draftLockService';
import { notifyNewDraft } from '../../../src/services/notifications/notificationService';
import * as walletService from '../../../src/services/wallet';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError, WalletNotFoundError } from '../../../src/errors';
import {
  getDraftsForWallet,
  getDraft,
  createDraft,
  updateDraft,
  deleteDraft,
  deleteExpiredDrafts,
} from '../../../src/services/draftService';

describe('DraftService', () => {
  const userId = 'user-123';
  const walletId = 'wallet-456';
  const draftId = 'draft-789';

  const mockWallet = {
    id: walletId,
    name: 'Test Wallet',
    userRole: 'owner',
  };

  const mockDraft = {
    id: draftId,
    walletId,
    userId,
    recipient: 'tb1qtest...',
    amount: BigInt(100000),
    feeRate: 5,
    psbtBase64: 'cHNidP8...',
    status: 'unsigned',
    signedDeviceIds: [],
    selectedUtxoIds: ['utxo-1', 'utxo-2'],
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (walletService.getWalletById as Mock).mockResolvedValue(mockWallet);
    (notifyNewDraft as Mock).mockResolvedValue(undefined);
  });

  describe('getDraftsForWallet', () => {
    it('should return drafts for a wallet', async () => {
      const mockDrafts = [mockDraft, { ...mockDraft, id: 'draft-2' }];
      (draftRepository.findByWalletId as Mock).mockResolvedValue(mockDrafts);

      const result = await getDraftsForWallet(walletId, userId);

      expect(walletService.getWalletById).toHaveBeenCalledWith(walletId, userId);
      expect(result).toEqual(mockDrafts);
    });

    it('should throw NotFoundError if wallet not found', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue(null);

      await expect(getDraftsForWallet(walletId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getDraft', () => {
    it('should return a specific draft', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);

      const result = await getDraft(walletId, draftId, userId);

      expect(result).toEqual(mockDraft);
    });

    it('should throw NotFoundError if wallet not found', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue(null);

      await expect(getDraft(walletId, draftId, userId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if draft not found', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(null);

      await expect(getDraft(walletId, draftId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('createDraft', () => {
    const validInput = {
      recipient: 'tb1qtest...',
      amount: 100000,
      feeRate: 5,
      psbtBase64: 'cHNidP8...',
      selectedUtxoIds: ['utxo-1'],
    };

    beforeEach(() => {
      (draftRepository.create as Mock).mockResolvedValue(mockDraft);
      (resolveUtxoIds as Mock).mockResolvedValue({ found: ['utxo-id-1'], notFound: [] });
      (lockUtxosForDraft as Mock).mockResolvedValue({ success: true, lockedCount: 1 });
      (prisma.systemSetting.findUnique as Mock).mockResolvedValue(null);
    });

    it('should create a draft with valid input', async () => {
      const result = await createDraft(walletId, userId, validInput);

      expect(draftRepository.create).toHaveBeenCalled();
      expect(result).toEqual(mockDraft);
    });

    it('should lock UTXOs when selectedUtxoIds provided', async () => {
      await createDraft(walletId, userId, validInput);

      expect(resolveUtxoIds).toHaveBeenCalledWith(walletId, validInput.selectedUtxoIds);
      expect(lockUtxosForDraft).toHaveBeenCalled();
    });

    it('should not lock UTXOs for RBF transactions', async () => {
      await createDraft(walletId, userId, { ...validInput, isRBF: true });

      expect(lockUtxosForDraft).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenError for viewers', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({ ...mockWallet, userRole: 'viewer' });

      await expect(createDraft(walletId, userId, validInput)).rejects.toThrow(ForbiddenError);
    });

    it('should throw InvalidInputError for missing required fields', async () => {
      await expect(createDraft(walletId, userId, { ...validInput, recipient: '' })).rejects.toThrow(InvalidInputError);
      await expect(createDraft(walletId, userId, { ...validInput, psbtBase64: '' })).rejects.toThrow(InvalidInputError);
    });

    it('should throw ConflictError when UTXOs are already locked', async () => {
      (lockUtxosForDraft as Mock).mockResolvedValue({ success: false });

      await expect(createDraft(walletId, userId, validInput)).rejects.toThrow(ConflictError);
      expect(draftRepository.remove).toHaveBeenCalledWith(mockDraft.id);
    });

    it('should send notification after creating draft', async () => {
      await createDraft(walletId, userId, validInput);

      expect(notifyNewDraft).toHaveBeenCalledWith(
        walletId,
        expect.objectContaining({ id: mockDraft.id }),
        userId
      );
    });

    it('should use custom expiration days from settings', async () => {
      (prisma.systemSetting.findUnique as Mock).mockResolvedValue({ value: '14' });

      await createDraft(walletId, userId, validInput);

      expect(draftRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
        })
      );
    });

    it('should allow signers to create drafts', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({ ...mockWallet, userRole: 'signer' });

      const result = await createDraft(walletId, userId, validInput);

      expect(result).toEqual(mockDraft);
    });
  });

  describe('updateDraft', () => {
    beforeEach(() => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);
      (draftRepository.update as Mock).mockResolvedValue({ ...mockDraft, status: 'partial' });
    });

    it('should update draft status', async () => {
      const result = await updateDraft(walletId, draftId, userId, { status: 'partial' });

      expect(draftRepository.update).toHaveBeenCalledWith(draftId, { status: 'partial' });
      expect(result.status).toBe('partial');
    });

    it('should add signed device ID', async () => {
      await updateDraft(walletId, draftId, userId, { signedDeviceId: 'device-1' });

      expect(draftRepository.update).toHaveBeenCalledWith(draftId, expect.objectContaining({
        signedDeviceIds: ['device-1'],
      }));
    });

    it('should not duplicate signed device IDs', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue({
        ...mockDraft,
        signedDeviceIds: ['device-1'],
      });

      await updateDraft(walletId, draftId, userId, { signedDeviceId: 'device-1' });

      expect(draftRepository.update).toHaveBeenCalledWith(draftId, expect.not.objectContaining({
        signedDeviceIds: expect.anything(),
      }));
    });

    it('should throw ForbiddenError for viewers', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue({ ...mockWallet, userRole: 'viewer' });

      await expect(updateDraft(walletId, draftId, userId, { status: 'signed' })).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError if draft not found', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(null);

      await expect(updateDraft(walletId, draftId, userId, {})).rejects.toThrow(NotFoundError);
    });

    it('should throw InvalidInputError for invalid status', async () => {
      await expect(updateDraft(walletId, draftId, userId, { status: 'invalid' as any })).rejects.toThrow(InvalidInputError);
    });

    it('should update label and memo', async () => {
      await updateDraft(walletId, draftId, userId, { label: 'Test', memo: 'Note' });

      expect(draftRepository.update).toHaveBeenCalledWith(draftId, expect.objectContaining({
        label: 'Test',
        memo: 'Note',
      }));
    });
  });

  describe('deleteDraft', () => {
    beforeEach(() => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);
      (draftRepository.remove as Mock).mockResolvedValue(undefined);
    });

    it('should delete draft as creator', async () => {
      await deleteDraft(walletId, draftId, userId);

      expect(draftRepository.remove).toHaveBeenCalledWith(draftId);
    });

    it('should delete draft as wallet owner', async () => {
      const differentUser = 'other-user';
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue({
        ...mockDraft,
        userId: 'original-creator',
      });

      await deleteDraft(walletId, draftId, differentUser);

      expect(draftRepository.remove).toHaveBeenCalledWith(draftId);
    });

    it('should throw ForbiddenError if not creator or owner', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue({
        ...mockDraft,
        userId: 'original-creator',
      });
      (walletService.getWalletById as Mock).mockResolvedValue({ ...mockWallet, userRole: 'signer' });

      await expect(deleteDraft(walletId, draftId, 'other-user')).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError if wallet not found', async () => {
      (walletService.getWalletById as Mock).mockResolvedValue(null);

      await expect(deleteDraft(walletId, draftId, userId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if draft not found', async () => {
      (draftRepository.findByIdInWallet as Mock).mockResolvedValue(null);

      await expect(deleteDraft(walletId, draftId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteExpiredDrafts', () => {
    it('should delete expired drafts and return count', async () => {
      (draftRepository.deleteExpired as Mock).mockResolvedValue(5);

      const result = await deleteExpiredDrafts();

      expect(draftRepository.deleteExpired).toHaveBeenCalled();
      expect(result).toBe(5);
    });

    it('should return 0 when no expired drafts', async () => {
      (draftRepository.deleteExpired as Mock).mockResolvedValue(0);

      const result = await deleteExpiredDrafts();

      expect(result).toBe(0);
    });
  });
});
