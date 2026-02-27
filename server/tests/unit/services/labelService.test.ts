import { vi, Mock } from 'vitest';
/**
 * Label Service Tests
 *
 * Tests for label management operations including CRUD,
 * transaction labels, and address labels.
 */

// Mock dependencies before imports
vi.mock('../../../src/repositories', () => ({
  labelRepository: {
    findByWalletId: vi.fn(),
    findByIdWithAssociations: vi.fn(),
    findByNameInWallet: vi.fn(),
    findByIdInWallet: vi.fn(),
    isNameTakenByOther: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getLabelsForTransaction: vi.fn(),
    findManyByIdsInWallet: vi.fn(),
    addLabelsToTransaction: vi.fn(),
    replaceTransactionLabels: vi.fn(),
    removeLabelFromTransaction: vi.fn(),
    getLabelsForAddress: vi.fn(),
    addLabelsToAddress: vi.fn(),
    replaceAddressLabels: vi.fn(),
    removeLabelFromAddress: vi.fn(),
  },
}));

vi.mock('../../../src/services/accessControl', () => ({
  requireWalletAccess: vi.fn(),
  requireWalletEditAccess: vi.fn(),
  requireTransactionAccess: vi.fn(),
  requireTransactionEditAccess: vi.fn(),
  requireAddressAccess: vi.fn(),
  requireAddressEditAccess: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { labelRepository } from '../../../src/repositories';
import {
  requireWalletAccess,
  requireWalletEditAccess,
  requireTransactionAccess,
  requireTransactionEditAccess,
  requireAddressAccess,
  requireAddressEditAccess,
} from '../../../src/services/accessControl';
import { NotFoundError, ConflictError, InvalidInputError } from '../../../src/errors';
import {
  getLabelsForWallet,
  getLabel,
  createLabel,
  updateLabel,
  deleteLabel,
  getTransactionLabels,
  addTransactionLabels,
  replaceTransactionLabels,
  removeTransactionLabel,
  getAddressLabels,
  addAddressLabels,
  replaceAddressLabels,
  removeAddressLabel,
} from '../../../src/services/labelService';

describe('LabelService', () => {
  const userId = 'user-123';
  const walletId = 'wallet-456';
  const labelId = 'label-789';

  beforeEach(() => {
    vi.clearAllMocks();
    (requireWalletAccess as Mock).mockResolvedValue(undefined);
    (requireWalletEditAccess as Mock).mockResolvedValue(undefined);
  });

  describe('Label CRUD Operations', () => {
    describe('getLabelsForWallet', () => {
      it('should return labels for a wallet', async () => {
        const mockLabels = [
          { id: 'label-1', name: 'Work', color: '#ff0000', _count: { transactions: 2, addresses: 1 } },
          { id: 'label-2', name: 'Personal', color: '#00ff00', _count: { transactions: 0, addresses: 3 } },
        ];
        (labelRepository.findByWalletId as Mock).mockResolvedValue(mockLabels);

        const result = await getLabelsForWallet(walletId, userId);

        expect(requireWalletAccess).toHaveBeenCalledWith(walletId, userId);
        expect(result).toEqual(mockLabels);
      });

      it('should throw if user lacks wallet access', async () => {
        (requireWalletAccess as Mock).mockRejectedValue(new Error('Access denied'));

        await expect(getLabelsForWallet(walletId, userId)).rejects.toThrow('Access denied');
      });
    });

    describe('getLabel', () => {
      it('should return label with associations', async () => {
        const mockLabel = {
          id: labelId,
          name: 'Work',
          color: '#ff0000',
          transactions: [{ id: 'tx-1' }],
          addresses: [{ id: 'addr-1' }],
        };
        (labelRepository.findByIdWithAssociations as Mock).mockResolvedValue(mockLabel);

        const result = await getLabel(walletId, labelId, userId);

        expect(result).toEqual(mockLabel);
      });

      it('should throw NotFoundError if label does not exist', async () => {
        (labelRepository.findByIdWithAssociations as Mock).mockResolvedValue(null);

        await expect(getLabel(walletId, labelId, userId)).rejects.toThrow(NotFoundError);
      });
    });

    describe('createLabel', () => {
      it('should create a new label', async () => {
        const mockLabel = { id: labelId, name: 'Work', color: '#ff0000', walletId };
        (labelRepository.findByNameInWallet as Mock).mockResolvedValue(null);
        (labelRepository.create as Mock).mockResolvedValue(mockLabel);

        const result = await createLabel(walletId, userId, { name: 'Work', color: '#ff0000' });

        expect(requireWalletEditAccess).toHaveBeenCalledWith(walletId, userId);
        expect(result).toEqual(mockLabel);
      });

      it('should throw InvalidInputError for empty name', async () => {
        await expect(createLabel(walletId, userId, { name: '' })).rejects.toThrow(InvalidInputError);
        await expect(createLabel(walletId, userId, { name: '   ' })).rejects.toThrow(InvalidInputError);
      });

      it('should throw ConflictError for duplicate name', async () => {
        (labelRepository.findByNameInWallet as Mock).mockResolvedValue({ id: 'existing' });

        await expect(createLabel(walletId, userId, { name: 'Work' })).rejects.toThrow(ConflictError);
      });

      it('should trim label name', async () => {
        (labelRepository.findByNameInWallet as Mock).mockResolvedValue(null);
        (labelRepository.create as Mock).mockResolvedValue({ id: labelId, name: 'Work' });

        await createLabel(walletId, userId, { name: '  Work  ' });

        expect(labelRepository.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Work' }));
      });
    });

    describe('updateLabel', () => {
      it('should update a label', async () => {
        const existingLabel = { id: labelId, name: 'Old Name', color: '#000000' };
        const updatedLabel = { id: labelId, name: 'New Name', color: '#ffffff' };
        (labelRepository.findByIdInWallet as Mock).mockResolvedValue(existingLabel);
        (labelRepository.isNameTakenByOther as Mock).mockResolvedValue(false);
        (labelRepository.update as Mock).mockResolvedValue(updatedLabel);

        const result = await updateLabel(walletId, labelId, userId, { name: 'New Name', color: '#ffffff' });

        expect(result).toEqual(updatedLabel);
      });

      it('should throw NotFoundError if label does not exist', async () => {
        (labelRepository.findByIdInWallet as Mock).mockResolvedValue(null);

        await expect(updateLabel(walletId, labelId, userId, { name: 'New' })).rejects.toThrow(NotFoundError);
      });

      it('should throw ConflictError if new name is taken', async () => {
        (labelRepository.findByIdInWallet as Mock).mockResolvedValue({ id: labelId, name: 'Old' });
        (labelRepository.isNameTakenByOther as Mock).mockResolvedValue(true);

        await expect(updateLabel(walletId, labelId, userId, { name: 'Taken' })).rejects.toThrow(ConflictError);
      });

      it('should not check for duplicate if name unchanged', async () => {
        const existingLabel = { id: labelId, name: 'Same Name' };
        (labelRepository.findByIdInWallet as Mock).mockResolvedValue(existingLabel);
        (labelRepository.update as Mock).mockResolvedValue(existingLabel);

        await updateLabel(walletId, labelId, userId, { name: 'Same Name' });

        expect(labelRepository.isNameTakenByOther).not.toHaveBeenCalled();
      });
    });

    describe('deleteLabel', () => {
      it('should delete a label', async () => {
        (labelRepository.findByIdInWallet as Mock).mockResolvedValue({ id: labelId });
        (labelRepository.remove as Mock).mockResolvedValue(undefined);

        await deleteLabel(walletId, labelId, userId);

        expect(labelRepository.remove).toHaveBeenCalledWith(labelId);
      });

      it('should throw NotFoundError if label does not exist', async () => {
        (labelRepository.findByIdInWallet as Mock).mockResolvedValue(null);

        await expect(deleteLabel(walletId, labelId, userId)).rejects.toThrow(NotFoundError);
      });
    });
  });

  describe('Transaction Label Operations', () => {
    const transactionId = 'tx-123';

    beforeEach(() => {
      (requireTransactionAccess as Mock).mockResolvedValue(undefined);
      (requireTransactionEditAccess as Mock).mockResolvedValue({ walletId });
    });

    describe('getTransactionLabels', () => {
      it('should return labels for a transaction', async () => {
        const mockLabels = [{ id: 'label-1', name: 'Income' }];
        (labelRepository.getLabelsForTransaction as Mock).mockResolvedValue(mockLabels);

        const result = await getTransactionLabels(transactionId, userId);

        expect(requireTransactionAccess).toHaveBeenCalledWith(transactionId, userId);
        expect(result).toEqual(mockLabels);
      });
    });

    describe('addTransactionLabels', () => {
      it('should add labels to a transaction', async () => {
        const labelIds = ['label-1', 'label-2'];
        const mockLabels = [{ id: 'label-1' }, { id: 'label-2' }];
        (labelRepository.findManyByIdsInWallet as Mock).mockResolvedValue(mockLabels);
        (labelRepository.getLabelsForTransaction as Mock).mockResolvedValue(mockLabels);

        const result = await addTransactionLabels(transactionId, userId, labelIds);

        expect(labelRepository.addLabelsToTransaction).toHaveBeenCalledWith(transactionId, labelIds);
        expect(result).toEqual(mockLabels);
      });

      it('should throw InvalidInputError for empty labelIds', async () => {
        await expect(addTransactionLabels(transactionId, userId, [])).rejects.toThrow(InvalidInputError);
      });

      it('should throw InvalidInputError if some labels not found', async () => {
        (labelRepository.findManyByIdsInWallet as Mock).mockResolvedValue([{ id: 'label-1' }]);

        await expect(addTransactionLabels(transactionId, userId, ['label-1', 'label-2'])).rejects.toThrow(InvalidInputError);
      });
    });

    describe('replaceTransactionLabels', () => {
      it('should replace all labels on a transaction', async () => {
        const labelIds = ['label-1'];
        const mockLabels = [{ id: 'label-1' }];
        (labelRepository.findManyByIdsInWallet as Mock).mockResolvedValue(mockLabels);
        (labelRepository.getLabelsForTransaction as Mock).mockResolvedValue(mockLabels);

        const result = await replaceTransactionLabels(transactionId, userId, labelIds);

        expect(labelRepository.replaceTransactionLabels).toHaveBeenCalledWith(transactionId, labelIds);
        expect(result).toEqual(mockLabels);
      });

      it('should allow empty labelIds to clear all labels', async () => {
        (labelRepository.getLabelsForTransaction as Mock).mockResolvedValue([]);

        const result = await replaceTransactionLabels(transactionId, userId, []);

        expect(labelRepository.replaceTransactionLabels).toHaveBeenCalledWith(transactionId, []);
        expect(result).toEqual([]);
      });

      it('should throw InvalidInputError if not an array', async () => {
        await expect(replaceTransactionLabels(transactionId, userId, null as any)).rejects.toThrow(InvalidInputError);
      });
    });

    describe('removeTransactionLabel', () => {
      it('should remove a label from a transaction', async () => {
        await removeTransactionLabel(transactionId, labelId, userId);

        expect(requireTransactionEditAccess).toHaveBeenCalledWith(transactionId, userId);
        expect(labelRepository.removeLabelFromTransaction).toHaveBeenCalledWith(transactionId, labelId);
      });
    });
  });

  describe('Address Label Operations', () => {
    const addressId = 'addr-123';

    beforeEach(() => {
      (requireAddressAccess as Mock).mockResolvedValue(undefined);
      (requireAddressEditAccess as Mock).mockResolvedValue({ walletId });
    });

    describe('getAddressLabels', () => {
      it('should return labels for an address', async () => {
        const mockLabels = [{ id: 'label-1', name: 'Savings' }];
        (labelRepository.getLabelsForAddress as Mock).mockResolvedValue(mockLabels);

        const result = await getAddressLabels(addressId, userId);

        expect(requireAddressAccess).toHaveBeenCalledWith(addressId, userId);
        expect(result).toEqual(mockLabels);
      });
    });

    describe('addAddressLabels', () => {
      it('should add labels to an address', async () => {
        const labelIds = ['label-1', 'label-2'];
        const mockLabels = [{ id: 'label-1' }, { id: 'label-2' }];
        (labelRepository.findManyByIdsInWallet as Mock).mockResolvedValue(mockLabels);
        (labelRepository.getLabelsForAddress as Mock).mockResolvedValue(mockLabels);

        const result = await addAddressLabels(addressId, userId, labelIds);

        expect(labelRepository.addLabelsToAddress).toHaveBeenCalledWith(addressId, labelIds);
        expect(result).toEqual(mockLabels);
      });

      it('should throw InvalidInputError for empty labelIds', async () => {
        await expect(addAddressLabels(addressId, userId, [])).rejects.toThrow(InvalidInputError);
      });

      it('should throw InvalidInputError if some labels not found', async () => {
        (labelRepository.findManyByIdsInWallet as Mock).mockResolvedValue([{ id: 'label-1' }]);

        await expect(addAddressLabels(addressId, userId, ['label-1', 'label-2'])).rejects.toThrow(InvalidInputError);
      });
    });

    describe('replaceAddressLabels', () => {
      it('should replace all labels on an address', async () => {
        const labelIds = ['label-1'];
        const mockLabels = [{ id: 'label-1' }];
        (labelRepository.findManyByIdsInWallet as Mock).mockResolvedValue(mockLabels);
        (labelRepository.getLabelsForAddress as Mock).mockResolvedValue(mockLabels);

        const result = await replaceAddressLabels(addressId, userId, labelIds);

        expect(labelRepository.replaceAddressLabels).toHaveBeenCalledWith(addressId, labelIds);
        expect(result).toEqual(mockLabels);
      });

      it('should allow empty labelIds to clear all labels', async () => {
        (labelRepository.getLabelsForAddress as Mock).mockResolvedValue([]);

        const result = await replaceAddressLabels(addressId, userId, []);

        expect(labelRepository.replaceAddressLabels).toHaveBeenCalledWith(addressId, []);
        expect(result).toEqual([]);
      });
    });

    describe('removeAddressLabel', () => {
      it('should remove a label from an address', async () => {
        await removeAddressLabel(addressId, labelId, userId);

        expect(requireAddressEditAccess).toHaveBeenCalledWith(addressId, userId);
        expect(labelRepository.removeLabelFromAddress).toHaveBeenCalledWith(addressId, labelId);
      });
    });
  });
});
