import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockBuildWalletAccessWhere } = vi.hoisted(() => ({
  mockBuildWalletAccessWhere: vi.fn((userId: string) => ({
    OR: [
      { users: { some: { userId } } },
      { group: { members: { some: { userId } } } },
    ],
  })),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {},
}));

vi.mock('../../../src/repositories/accessControl', () => ({
  buildWalletAccessWhere: mockBuildWalletAccessWhere,
}));

import {
  createMockPrismaClient,
  createRepositories,
  repositories,
} from '../../../src/repositories/factory';

function buildClient() {
  const client: any = {
    wallet: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    address: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    uTXO: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    walletUser: {
      findMany: vi.fn(),
    },
    groupMember: {
      findMany: vi.fn(),
    },
    label: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    transactionLabel: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    addressLabel: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  return client;
}

describe('repository factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates wallet repository methods with access filters', async () => {
    const client = buildClient();
    client.wallet.findUnique.mockResolvedValueOnce({ id: 'wallet-1' }).mockResolvedValueOnce({ name: 'Main' });
    client.wallet.findFirst.mockResolvedValueOnce({ id: 'wallet-1' }).mockResolvedValueOnce({ id: 'wallet-1' });
    client.wallet.findMany.mockResolvedValue([{ id: 'wallet-a' }]);
    client.wallet.update.mockResolvedValue({ id: 'wallet-1', name: 'Updated' });

    const repos = createRepositories(client);

    await expect(repos.wallet.findById('wallet-1')).resolves.toEqual({ id: 'wallet-1' });
    await expect(repos.wallet.findByIdWithAccess('wallet-1', 'user-1')).resolves.toEqual({ id: 'wallet-1' });
    await expect(repos.wallet.findByUserId('user-1')).resolves.toEqual([{ id: 'wallet-a' }]);
    await expect(repos.wallet.hasAccess('wallet-1', 'user-1')).resolves.toBe(true);
    await expect(repos.wallet.getName('wallet-1')).resolves.toBe('Main');
    await expect(repos.wallet.update('wallet-1', { name: 'Updated' } as any)).resolves.toEqual({
      id: 'wallet-1',
      name: 'Updated',
    });

    expect(mockBuildWalletAccessWhere).toHaveBeenCalledWith('user-1');
    expect(client.wallet.findFirst).toHaveBeenCalledWith({
      where: { id: 'wallet-1', ...mockBuildWalletAccessWhere('user-1') },
    });
    expect(client.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: { name: 'Updated' },
    });
  });

  it('returns null wallet name when wallet is missing', async () => {
    const client = buildClient();
    client.wallet.findUnique.mockResolvedValue(null);

    const repos = createRepositories(client);

    await expect(repos.wallet.getName('missing-wallet')).resolves.toBeNull();
  });

  it('handles transaction/address/utxo/user repository methods', async () => {
    const client = buildClient();
    client.transaction.findMany.mockResolvedValue([{ id: 'tx-1' }]);
    client.transaction.findFirst.mockResolvedValue({ id: 'tx-1' });
    client.transaction.count.mockResolvedValue(5);
    client.transaction.deleteMany.mockResolvedValue({ count: 2 });
    client.address.findMany.mockResolvedValue([{ id: 'addr-1' }]);
    client.address.findFirst.mockResolvedValue({ id: 'addr-next' });
    client.address.update.mockResolvedValue({ id: 'addr-1', used: true });
    client.address.updateMany.mockResolvedValue({ count: 4 });
    client.uTXO.findMany.mockResolvedValue([{ id: 'u-1' }]);
    client.uTXO.aggregate.mockResolvedValue({ _sum: { amount: BigInt(12) } });
    client.uTXO.deleteMany.mockResolvedValue({ count: 3 });
    client.user.findUnique.mockResolvedValueOnce({ id: 'user-1' }).mockResolvedValueOnce({ id: 'user-1', email: 'u@example.com' });
    client.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const repos = createRepositories(client);

    await expect(repos.transaction.findByWalletId('wallet-1', { skip: 1, take: 2 })).resolves.toEqual([{ id: 'tx-1' }]);
    await expect(repos.transaction.findByTxid('txid-1', 'wallet-1')).resolves.toEqual({ id: 'tx-1' });
    await expect(repos.transaction.countByWalletId('wallet-1')).resolves.toBe(5);
    await expect(repos.transaction.deleteByWalletId('wallet-1')).resolves.toBe(2);

    await expect(repos.address.findByWalletId('wallet-1', { used: false })).resolves.toEqual([{ id: 'addr-1' }]);
    await expect(repos.address.findNextUnused('wallet-1')).resolves.toEqual({ id: 'addr-next' });
    await expect(repos.address.markAsUsed('addr-1')).resolves.toEqual({ id: 'addr-1', used: true });
    await expect(repos.address.resetUsedFlags('wallet-1')).resolves.toBe(4);

    await expect(repos.utxo.findByWalletId('wallet-1', { spent: false })).resolves.toEqual([{ id: 'u-1' }]);
    await expect(repos.utxo.findUnspent('wallet-1')).resolves.toEqual([{ id: 'u-1' }]);
    await expect(repos.utxo.getUnspentBalance('wallet-1')).resolves.toBe(BigInt(12));
    await expect(repos.utxo.deleteByWalletId('wallet-1')).resolves.toBe(3);

    await expect(repos.user.findById('user-1')).resolves.toEqual({ id: 'user-1' });
    await expect(repos.user.findByEmail('u@example.com')).resolves.toEqual({ id: 'user-1', email: 'u@example.com' });
    await expect(repos.user.exists('user-1')).resolves.toBe(true);
    await expect(repos.user.exists('user-2')).resolves.toBe(false);

    expect(client.transaction.findMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1' },
      skip: 1,
      take: 2,
      orderBy: { blockTime: 'desc' },
    });
    expect(client.address.findMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1', used: false },
      orderBy: { index: 'asc' },
    });
  });

  it('omits optional address and utxo filters when options are not provided', async () => {
    const client = buildClient();
    client.address.findMany.mockResolvedValue([]);
    client.uTXO.findMany.mockResolvedValue([]);

    const repos = createRepositories(client);

    await expect(repos.address.findByWalletId('wallet-1')).resolves.toEqual([]);
    await expect(repos.utxo.findByWalletId('wallet-1')).resolves.toEqual([]);

    expect(client.address.findMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1' },
      orderBy: { index: 'asc' },
    });
    expect(client.uTXO.findMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1' },
      orderBy: { amount: 'desc' },
    });
  });

  it('falls back to zero unspent balance when aggregate sum is missing', async () => {
    const client = buildClient();
    client.uTXO.aggregate.mockResolvedValue({ _sum: { amount: null } });

    const repos = createRepositories(client);

    await expect(repos.utxo.getUnspentBalance('wallet-1')).resolves.toBe(BigInt(0));
  });

  it('maps label repository read and write helpers', async () => {
    const client = buildClient();
    client.label.findMany
      .mockResolvedValueOnce([
        {
          id: 'label-1',
          name: 'A',
          walletId: 'wallet-1',
          _count: { transactionLabels: 2, addressLabels: 1 },
        },
      ])
      .mockResolvedValueOnce([{ id: 'label-1' }]);
    client.label.findUnique.mockResolvedValue({ id: 'label-1' });
    client.label.findFirst
      .mockResolvedValueOnce({ id: 'label-1' })
      .mockResolvedValueOnce({
        id: 'label-1',
        transactionLabels: [{ transaction: { id: 'tx-1', txid: 'txid', type: 'receive', amount: BigInt(1), confirmations: 1, blockTime: null } }],
        addressLabels: [{ address: { id: 'addr-1', address: 'bc1', derivationPath: 'm/0/0', index: 0, used: false } }],
      })
      .mockResolvedValueOnce({ id: 'label-by-name' })
      .mockResolvedValueOnce({ id: 'taken-id' });
    client.label.create.mockResolvedValue({ id: 'label-created' });
    client.label.update.mockResolvedValue({ id: 'label-updated' });
    client.label.delete.mockResolvedValue(undefined);
    client.transactionLabel.findMany.mockResolvedValue([{ label: { id: 'l1' } }]);
    client.addressLabel.findMany.mockResolvedValue([{ label: { id: 'l2' } }]);
    client.transactionLabel.createMany.mockResolvedValue(undefined);
    client.transactionLabel.deleteMany.mockResolvedValue(undefined);
    client.addressLabel.createMany.mockResolvedValue(undefined);
    client.addressLabel.deleteMany.mockResolvedValue(undefined);
    client.$transaction.mockResolvedValue(undefined);

    const repos = createRepositories(client);

    await expect(repos.label.findByWalletId('wallet-1')).resolves.toEqual([
      {
        id: 'label-1',
        name: 'A',
        walletId: 'wallet-1',
        _count: { transactionLabels: 2, addressLabels: 1 },
        transactionCount: 2,
        addressCount: 1,
      },
    ]);
    await expect(repos.label.findById('label-1')).resolves.toEqual({ id: 'label-1' });
    await expect(repos.label.findByIdInWallet('label-1', 'wallet-1')).resolves.toEqual({ id: 'label-1' });
    await expect(repos.label.findByIdWithAssociations('label-1', 'wallet-1')).resolves.toEqual({
      id: 'label-1',
      transactionLabels: [
        {
          transaction: {
            id: 'tx-1',
            txid: 'txid',
            type: 'receive',
            amount: BigInt(1),
            confirmations: 1,
            blockTime: null,
          },
        },
      ],
      addressLabels: [
        {
          address: {
            id: 'addr-1',
            address: 'bc1',
            derivationPath: 'm/0/0',
            index: 0,
            used: false,
          },
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          txid: 'txid',
          type: 'receive',
          amount: BigInt(1),
          confirmations: 1,
          blockTime: null,
        },
      ],
      addresses: [
        {
          id: 'addr-1',
          address: 'bc1',
          derivationPath: 'm/0/0',
          index: 0,
          used: false,
        },
      ],
    } as any);
    await expect(repos.label.findByNameInWallet('wallet-1', 'A')).resolves.toEqual({ id: 'label-by-name' });
    await expect(repos.label.isNameTakenByOther('wallet-1', 'A', 'label-2')).resolves.toBe(true);
    await expect(repos.label.findManyByIdsInWallet(['label-1'], 'wallet-1')).resolves.toEqual([{ id: 'label-1' }]);
    await expect(
      repos.label.create({ walletId: 'wallet-1', name: '  New  ', color: '', description: '' })
    ).resolves.toEqual({ id: 'label-created' });
    await expect(
      repos.label.update('label-1', { name: '  Name ', color: '#fff', description: null })
    ).resolves.toEqual({ id: 'label-updated' });
    await expect(repos.label.remove('label-1')).resolves.toBeUndefined();

    await expect(repos.label.getLabelsForTransaction('tx-1')).resolves.toEqual([{ id: 'l1' }]);
    await expect(repos.label.addLabelsToTransaction('tx-1', ['l1', 'l2'])).resolves.toBeUndefined();
    await expect(repos.label.replaceTransactionLabels('tx-1', ['l1'])).resolves.toBeUndefined();
    await expect(repos.label.removeLabelFromTransaction('tx-1', 'l1')).resolves.toBeUndefined();

    await expect(repos.label.getLabelsForAddress('addr-1')).resolves.toEqual([{ id: 'l2' }]);
    await expect(repos.label.addLabelsToAddress('addr-1', ['l2'])).resolves.toBeUndefined();
    await expect(repos.label.replaceAddressLabels('addr-1', ['l2'])).resolves.toBeUndefined();
    await expect(repos.label.removeLabelFromAddress('addr-1', 'l2')).resolves.toBeUndefined();

    expect(client.label.create).toHaveBeenCalledWith({
      data: {
        walletId: 'wallet-1',
        name: 'New',
        color: '#6366f1',
        description: null,
      },
    });
    expect(client.$transaction).toHaveBeenCalledTimes(2);
  });

  it('returns null for missing label association lookup', async () => {
    const client = buildClient();
    client.label.findFirst.mockResolvedValue(null);

    const repos = createRepositories(client);
    await expect(repos.label.findByIdWithAssociations('missing', 'wallet-1')).resolves.toBeNull();
  });

  it('provides default repositories singleton shape', () => {
    expect(repositories).toEqual(
      expect.objectContaining({
        wallet: expect.any(Object),
        transaction: expect.any(Object),
        address: expect.any(Object),
        utxo: expect.any(Object),
        user: expect.any(Object),
        label: expect.any(Object),
      })
    );
  });

  it('createMockPrismaClient builds async callable mocks with defaults', async () => {
    const mockClient = createMockPrismaClient();

    await expect(mockClient.wallet.findUnique()).resolves.toBeNull();
    await expect(mockClient.wallet.findMany()).resolves.toEqual([]);
    await expect(mockClient.wallet.findFirst()).resolves.toBeNull();
    await expect(mockClient.wallet.create()).resolves.toEqual({});
    await expect(mockClient.wallet.update()).resolves.toEqual({});
    await expect(mockClient.wallet.delete()).resolves.toEqual({});
    await expect(mockClient.wallet.deleteMany()).resolves.toEqual({ count: 0 });
    await expect(mockClient.wallet.updateMany()).resolves.toEqual({ count: 0 });
    await expect(mockClient.wallet.count()).resolves.toBe(0);
    await expect(mockClient.uTXO.aggregate()).resolves.toEqual({ _sum: { amount: BigInt(0) } });
    await expect((mockClient.$transaction as any)()).resolves.toBeNull();
  });

  it('createMockPrismaClient supports custom mock function factory', async () => {
    const mockFnFactory = <T>(impl?: () => T) => {
      const fn = vi.fn(() => (impl ? impl() : null));
      return fn as unknown as (() => T) & {
        mockResolvedValue?: (val: T) => void;
        mockImplementation?: (fn: (...args: unknown[]) => T) => void;
      };
    };
    const mockClient = createMockPrismaClient(mockFnFactory);

    const result = (mockClient.wallet.findUnique as unknown as Mock)();
    expect(result).toBeNull();
    expect((mockClient.wallet.findUnique as unknown as Mock).mock.calls.length).toBe(1);
  });

  it('createMockPrismaClient falls back to mock transaction helper when factory returns no transaction fn', async () => {
    const selectiveMockFactory = <T>(impl?: () => T) => {
      if (!impl) return undefined as unknown as (() => T);
      const fn = vi.fn(() => Promise.resolve(impl()));
      return fn as unknown as (() => T) & {
        mockResolvedValue?: (val: T) => void;
        mockImplementation?: (fn: (...args: unknown[]) => T) => void;
      };
    };

    const mockClient = createMockPrismaClient(selectiveMockFactory);
    const result = await (mockClient.$transaction as unknown as (fn: (tx: any) => Promise<unknown>) => Promise<unknown>)(
      async tx => tx.wallet.findMany()
    );

    expect(result).toEqual([]);
  });
});
