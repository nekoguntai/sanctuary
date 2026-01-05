/**
 * Label Repository Integration Tests
 *
 * Tests the label repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestWallet,
  createTestLabel,
  createTestTransaction,
  createTestAddress,
  assertNotExists,
} from './setup';

describeIfDatabase('LabelRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('create', () => {
    it('should create a label with all fields', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const label = await createTestLabel(tx, wallet.id, {
          name: 'Exchange',
          color: '#ff5733',
          description: 'Transactions from exchange',
        });

        expect(label.name).toBe('Exchange');
        expect(label.color).toBe('#ff5733');
        expect(label.description).toBe('Transactions from exchange');
        expect(label.walletId).toBe(wallet.id);
      });
    });

    it('should use default color if not specified', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const label = await tx.label.create({
          data: {
            walletId: wallet.id,
            name: 'Default Color',
          },
        });

        expect(label.color).toBe('#6366f1');
      });
    });

    it('should enforce unique name per wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestLabel(tx, wallet.id, { name: 'Duplicate' });

        await expect(
          createTestLabel(tx, wallet.id, { name: 'Duplicate' })
        ).rejects.toThrow();
      });
    });

    it('should allow same name in different wallets', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet1 = await createTestWallet(tx, user.id);
        const wallet2 = await createTestWallet(tx, user.id);

        const label1 = await createTestLabel(tx, wallet1.id, { name: 'Same Name' });
        const label2 = await createTestLabel(tx, wallet2.id, { name: 'Same Name' });

        expect(label1.walletId).not.toBe(label2.walletId);
        expect(label1.name).toBe(label2.name);
      });
    });
  });

  describe('findById', () => {
    it('should find label by ID', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label = await createTestLabel(tx, wallet.id, { name: 'FindMe' });

        const found = await tx.label.findUnique({
          where: { id: label.id },
        });

        expect(found).not.toBeNull();
        expect(found?.name).toBe('FindMe');
      });
    });
  });

  describe('findByWalletId', () => {
    it('should find all labels for a wallet with counts', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestLabel(tx, wallet.id, { name: 'Label 1' });
        await createTestLabel(tx, wallet.id, { name: 'Label 2' });
        await createTestLabel(tx, wallet.id, { name: 'Label 3' });

        const labels = await tx.label.findMany({
          where: { walletId: wallet.id },
          include: {
            _count: {
              select: {
                transactionLabels: true,
                addressLabels: true,
              },
            },
          },
          orderBy: { name: 'asc' },
        });

        expect(labels).toHaveLength(3);
        expect(labels[0].name).toBe('Label 1');
      });
    });

    it('should order labels alphabetically', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        await createTestLabel(tx, wallet.id, { name: 'Zebra' });
        await createTestLabel(tx, wallet.id, { name: 'Apple' });
        await createTestLabel(tx, wallet.id, { name: 'Mango' });

        const labels = await tx.label.findMany({
          where: { walletId: wallet.id },
          orderBy: { name: 'asc' },
        });

        expect(labels.map((l) => l.name)).toEqual(['Apple', 'Mango', 'Zebra']);
      });
    });
  });

  describe('findByNameInWallet', () => {
    it('should find label by name', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        await createTestLabel(tx, wallet.id, { name: 'Unique Name' });

        const found = await tx.label.findFirst({
          where: { walletId: wallet.id, name: 'Unique Name' },
        });

        expect(found).not.toBeNull();
        expect(found?.name).toBe('Unique Name');
      });
    });

    it('should return null for non-existent name', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const found = await tx.label.findFirst({
          where: { walletId: wallet.id, name: 'Non-Existent' },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('update', () => {
    it('should update label name', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label = await createTestLabel(tx, wallet.id, { name: 'Old Name' });

        const updated = await tx.label.update({
          where: { id: label.id },
          data: { name: 'New Name' },
        });

        expect(updated.name).toBe('New Name');
      });
    });

    it('should update label color', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label = await createTestLabel(tx, wallet.id, { color: '#000000' });

        const updated = await tx.label.update({
          where: { id: label.id },
          data: { color: '#ffffff' },
        });

        expect(updated.color).toBe('#ffffff');
      });
    });
  });

  describe('delete', () => {
    it('should delete a label', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label = await createTestLabel(tx, wallet.id);

        await tx.label.delete({
          where: { id: label.id },
        });

        await assertNotExists(tx, 'label', { id: label.id });
      });
    });

    it('should cascade delete transaction label associations', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label = await createTestLabel(tx, wallet.id);
        const transaction = await createTestTransaction(tx, wallet.id);

        // Create association
        await tx.transactionLabel.create({
          data: { transactionId: transaction.id, labelId: label.id },
        });

        // Delete label
        await tx.label.delete({
          where: { id: label.id },
        });

        // Association should be gone
        const associations = await tx.transactionLabel.findMany({
          where: { labelId: label.id },
        });
        expect(associations).toHaveLength(0);
      });
    });
  });

  describe('transaction labels', () => {
    it('should add labels to a transaction', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label1 = await createTestLabel(tx, wallet.id, { name: 'Tag 1' });
        const label2 = await createTestLabel(tx, wallet.id, { name: 'Tag 2' });
        const transaction = await createTestTransaction(tx, wallet.id);

        await tx.transactionLabel.createMany({
          data: [
            { transactionId: transaction.id, labelId: label1.id },
            { transactionId: transaction.id, labelId: label2.id },
          ],
        });

        const labels = await tx.transactionLabel.findMany({
          where: { transactionId: transaction.id },
          include: { label: true },
        });

        expect(labels).toHaveLength(2);
      });
    });

    it('should get labels for a transaction', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label = await createTestLabel(tx, wallet.id, { name: 'Important' });
        const transaction = await createTestTransaction(tx, wallet.id);

        await tx.transactionLabel.create({
          data: { transactionId: transaction.id, labelId: label.id },
        });

        const associations = await tx.transactionLabel.findMany({
          where: { transactionId: transaction.id },
          include: { label: true },
        });

        expect(associations[0].label.name).toBe('Important');
      });
    });

    it('should replace all labels on a transaction', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label1 = await createTestLabel(tx, wallet.id, { name: 'Old' });
        const label2 = await createTestLabel(tx, wallet.id, { name: 'New' });
        const transaction = await createTestTransaction(tx, wallet.id);

        // Add initial label
        await tx.transactionLabel.create({
          data: { transactionId: transaction.id, labelId: label1.id },
        });

        // Replace with new label
        await tx.transactionLabel.deleteMany({
          where: { transactionId: transaction.id },
        });
        await tx.transactionLabel.create({
          data: { transactionId: transaction.id, labelId: label2.id },
        });

        const labels = await tx.transactionLabel.findMany({
          where: { transactionId: transaction.id },
          include: { label: true },
        });

        expect(labels).toHaveLength(1);
        expect(labels[0].label.name).toBe('New');
      });
    });

    it('should remove specific label from transaction', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label1 = await createTestLabel(tx, wallet.id, { name: 'Keep' });
        const label2 = await createTestLabel(tx, wallet.id, { name: 'Remove' });
        const transaction = await createTestTransaction(tx, wallet.id);

        await tx.transactionLabel.createMany({
          data: [
            { transactionId: transaction.id, labelId: label1.id },
            { transactionId: transaction.id, labelId: label2.id },
          ],
        });

        await tx.transactionLabel.deleteMany({
          where: { transactionId: transaction.id, labelId: label2.id },
        });

        const labels = await tx.transactionLabel.findMany({
          where: { transactionId: transaction.id },
          include: { label: true },
        });

        expect(labels).toHaveLength(1);
        expect(labels[0].label.name).toBe('Keep');
      });
    });
  });

  describe('address labels', () => {
    it('should add labels to an address', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label = await createTestLabel(tx, wallet.id, { name: 'Cold Storage' });
        const address = await createTestAddress(tx, wallet.id);

        await tx.addressLabel.create({
          data: { addressId: address.id, labelId: label.id },
        });

        const labels = await tx.addressLabel.findMany({
          where: { addressId: address.id },
          include: { label: true },
        });

        expect(labels).toHaveLength(1);
        expect(labels[0].label.name).toBe('Cold Storage');
      });
    });

    it('should get labels for an address', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label1 = await createTestLabel(tx, wallet.id, { name: 'Savings' });
        const label2 = await createTestLabel(tx, wallet.id, { name: 'Emergency' });
        const address = await createTestAddress(tx, wallet.id);

        await tx.addressLabel.createMany({
          data: [
            { addressId: address.id, labelId: label1.id },
            { addressId: address.id, labelId: label2.id },
          ],
        });

        const labels = await tx.addressLabel.findMany({
          where: { addressId: address.id },
          include: { label: true },
        });

        expect(labels).toHaveLength(2);
      });
    });
  });

  describe('label with associations', () => {
    it('should find label with all associations', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const label = await createTestLabel(tx, wallet.id, { name: 'Tagged' });
        const transaction = await createTestTransaction(tx, wallet.id);
        const address = await createTestAddress(tx, wallet.id);

        await tx.transactionLabel.create({
          data: { transactionId: transaction.id, labelId: label.id },
        });
        await tx.addressLabel.create({
          data: { addressId: address.id, labelId: label.id },
        });

        const labelWithAssocs = await tx.label.findFirst({
          where: { id: label.id },
          include: {
            transactionLabels: {
              include: { transaction: true },
            },
            addressLabels: {
              include: { address: true },
            },
          },
        });

        expect(labelWithAssocs?.transactionLabels).toHaveLength(1);
        expect(labelWithAssocs?.addressLabels).toHaveLength(1);
      });
    });
  });
});
