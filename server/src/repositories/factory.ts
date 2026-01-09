/**
 * Repository Factory
 *
 * Factory pattern for creating repositories with injectable Prisma client.
 * Enables unit testing repositories without a real database connection.
 *
 * Usage (Production):
 *   import { repositories } from './repositories';
 *   const wallet = await repositories.wallet.findById(id);
 *
 * Usage (Testing):
 *   const mockPrisma = createMockPrismaClient();
 *   const testRepos = createRepositories(mockPrisma);
 *   const wallet = await testRepos.wallet.findById(id);
 */

import type { PrismaClient, Wallet, Transaction, Address, UTXO, User, Label } from '@prisma/client';
import prisma from '../models/prisma';

// Type for the minimal Prisma client interface needed by repositories
export type PrismaClientLike = Pick<
  PrismaClient,
  'wallet' | 'transaction' | 'address' | 'uTXO' | 'user' | 'walletUser' | 'groupMember' | 'label' | 'transactionLabel' | 'addressLabel' | '$transaction'
>;

/**
 * Wallet Repository Interface
 */
export interface WalletRepositoryInterface {
  findById(walletId: string): Promise<Wallet | null>;
  findByIdWithAccess(walletId: string, userId: string): Promise<Wallet | null>;
  findByUserId(userId: string): Promise<Wallet[]>;
  hasAccess(walletId: string, userId: string): Promise<boolean>;
  getName(walletId: string): Promise<string | null>;
  update(walletId: string, data: Partial<Wallet>): Promise<Wallet>;
}

/**
 * Transaction Repository Interface
 */
export interface TransactionRepositoryInterface {
  findByWalletId(walletId: string, options?: { skip?: number; take?: number }): Promise<Transaction[]>;
  findByTxid(txid: string, walletId: string): Promise<Transaction | null>;
  countByWalletId(walletId: string): Promise<number>;
  deleteByWalletId(walletId: string): Promise<number>;
}

/**
 * Address Repository Interface
 */
export interface AddressRepositoryInterface {
  findByWalletId(walletId: string, options?: { used?: boolean }): Promise<Address[]>;
  findNextUnused(walletId: string): Promise<Address | null>;
  markAsUsed(addressId: string): Promise<Address>;
  resetUsedFlags(walletId: string): Promise<number>;
}

/**
 * UTXO Repository Interface
 */
export interface UtxoRepositoryInterface {
  findByWalletId(walletId: string, options?: { spent?: boolean }): Promise<UTXO[]>;
  findUnspent(walletId: string): Promise<UTXO[]>;
  getUnspentBalance(walletId: string): Promise<bigint>;
  deleteByWalletId(walletId: string): Promise<number>;
}

/**
 * User Repository Interface
 */
export interface UserRepositoryInterface {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  exists(id: string): Promise<boolean>;
}

/**
 * Label with usage counts
 */
export interface LabelWithCounts extends Label {
  transactionCount: number;
  addressCount: number;
}

/**
 * Label with full associations
 */
export interface LabelWithAssociations extends Label {
  transactions: Array<{
    id: string;
    txid: string;
    type: string;
    amount: bigint;
    confirmations: number;
    blockTime: Date | null;
  }>;
  addresses: Array<{
    id: string;
    address: string;
    derivationPath: string;
    index: number;
    used: boolean;
  }>;
}

/**
 * Label Repository Interface
 */
export interface LabelRepositoryInterface {
  // Label CRUD
  findByWalletId(walletId: string): Promise<LabelWithCounts[]>;
  findById(labelId: string): Promise<Label | null>;
  findByIdInWallet(labelId: string, walletId: string): Promise<Label | null>;
  findByIdWithAssociations(labelId: string, walletId: string): Promise<LabelWithAssociations | null>;
  findByNameInWallet(walletId: string, name: string): Promise<Label | null>;
  isNameTakenByOther(walletId: string, name: string, excludeLabelId: string): Promise<boolean>;
  findManyByIdsInWallet(labelIds: string[], walletId: string): Promise<Label[]>;
  create(data: { walletId: string; name: string; color?: string; description?: string | null }): Promise<Label>;
  update(labelId: string, data: { name?: string; color?: string; description?: string | null }): Promise<Label>;
  remove(labelId: string): Promise<void>;
  // Transaction label operations
  getLabelsForTransaction(transactionId: string): Promise<Label[]>;
  addLabelsToTransaction(transactionId: string, labelIds: string[]): Promise<void>;
  replaceTransactionLabels(transactionId: string, labelIds: string[]): Promise<void>;
  removeLabelFromTransaction(transactionId: string, labelId: string): Promise<void>;
  // Address label operations
  getLabelsForAddress(addressId: string): Promise<Label[]>;
  addLabelsToAddress(addressId: string, labelIds: string[]): Promise<void>;
  replaceAddressLabels(addressId: string, labelIds: string[]): Promise<void>;
  removeLabelFromAddress(addressId: string, labelId: string): Promise<void>;
}

/**
 * Combined Repository Interface
 */
export interface RepositoryFactory {
  wallet: WalletRepositoryInterface;
  transaction: TransactionRepositoryInterface;
  address: AddressRepositoryInterface;
  utxo: UtxoRepositoryInterface;
  user: UserRepositoryInterface;
  label: LabelRepositoryInterface;
}

/**
 * Build access control WHERE clause
 */
function buildAccessWhere(userId: string) {
  return {
    OR: [
      { users: { some: { userId } } },
      { group: { members: { some: { userId } } } },
    ],
  };
}

/**
 * Create wallet repository with injectable client
 */
function createWalletRepository(client: PrismaClientLike): WalletRepositoryInterface {
  return {
    async findById(walletId: string) {
      return client.wallet.findUnique({ where: { id: walletId } });
    },

    async findByIdWithAccess(walletId: string, userId: string) {
      return client.wallet.findFirst({
        where: { id: walletId, ...buildAccessWhere(userId) },
      });
    },

    async findByUserId(userId: string) {
      return client.wallet.findMany({
        where: buildAccessWhere(userId),
      });
    },

    async hasAccess(walletId: string, userId: string) {
      const wallet = await client.wallet.findFirst({
        where: { id: walletId, ...buildAccessWhere(userId) },
        select: { id: true },
      });
      return wallet !== null;
    },

    async getName(walletId: string) {
      const wallet = await client.wallet.findUnique({
        where: { id: walletId },
        select: { name: true },
      });
      return wallet?.name ?? null;
    },

    async update(walletId: string, data: Partial<Wallet>) {
      return client.wallet.update({
        where: { id: walletId },
        data,
      });
    },
  };
}

/**
 * Create transaction repository with injectable client
 */
function createTransactionRepository(client: PrismaClientLike): TransactionRepositoryInterface {
  return {
    async findByWalletId(walletId: string, options?: { skip?: number; take?: number }) {
      return client.transaction.findMany({
        where: { walletId },
        skip: options?.skip,
        take: options?.take,
        orderBy: { blockTime: 'desc' },
      });
    },

    async findByTxid(txid: string, walletId: string) {
      return client.transaction.findFirst({
        where: { txid, walletId },
      });
    },

    async countByWalletId(walletId: string) {
      return client.transaction.count({ where: { walletId } });
    },

    async deleteByWalletId(walletId: string) {
      const result = await client.transaction.deleteMany({ where: { walletId } });
      return result.count;
    },
  };
}

/**
 * Create address repository with injectable client
 */
function createAddressRepository(client: PrismaClientLike): AddressRepositoryInterface {
  return {
    async findByWalletId(walletId: string, options?: { used?: boolean }) {
      return client.address.findMany({
        where: {
          walletId,
          ...(options?.used !== undefined ? { used: options.used } : {}),
        },
        orderBy: { index: 'asc' },
      });
    },

    async findNextUnused(walletId: string) {
      return client.address.findFirst({
        where: { walletId, used: false },
        orderBy: { index: 'asc' },
      });
    },

    async markAsUsed(addressId: string) {
      return client.address.update({
        where: { id: addressId },
        data: { used: true },
      });
    },

    async resetUsedFlags(walletId: string) {
      const result = await client.address.updateMany({
        where: { walletId },
        data: { used: false },
      });
      return result.count;
    },
  };
}

/**
 * Create UTXO repository with injectable client
 */
function createUtxoRepository(client: PrismaClientLike): UtxoRepositoryInterface {
  return {
    async findByWalletId(walletId: string, options?: { spent?: boolean }) {
      return client.uTXO.findMany({
        where: {
          walletId,
          ...(options?.spent !== undefined ? { spent: options.spent } : {}),
        },
        orderBy: { amount: 'desc' },
      });
    },

    async findUnspent(walletId: string) {
      return client.uTXO.findMany({
        where: { walletId, spent: false },
        orderBy: { amount: 'desc' },
      });
    },

    async getUnspentBalance(walletId: string) {
      const result = await client.uTXO.aggregate({
        where: { walletId, spent: false },
        _sum: { amount: true },
      });
      return result._sum.amount || BigInt(0);
    },

    async deleteByWalletId(walletId: string) {
      const result = await client.uTXO.deleteMany({ where: { walletId } });
      return result.count;
    },
  };
}

/**
 * Create user repository with injectable client
 */
function createUserRepository(client: PrismaClientLike): UserRepositoryInterface {
  return {
    async findById(id: string) {
      return client.user.findUnique({ where: { id } });
    },

    async findByEmail(email: string) {
      return client.user.findUnique({ where: { email } });
    },

    async exists(id: string) {
      const count = await client.user.count({ where: { id } });
      return count > 0;
    },
  };
}

/**
 * Create label repository with injectable client
 */
function createLabelRepository(client: PrismaClientLike): LabelRepositoryInterface {
  return {
    async findByWalletId(walletId: string) {
      const labels = await client.label.findMany({
        where: { walletId },
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
      return labels.map(label => ({
        ...label,
        transactionCount: label._count.transactionLabels,
        addressCount: label._count.addressLabels,
      }));
    },

    async findById(labelId: string) {
      return client.label.findUnique({ where: { id: labelId } });
    },

    async findByIdInWallet(labelId: string, walletId: string) {
      return client.label.findFirst({ where: { id: labelId, walletId } });
    },

    async findByIdWithAssociations(labelId: string, walletId: string) {
      const label = await client.label.findFirst({
        where: { id: labelId, walletId },
        include: {
          transactionLabels: {
            include: {
              transaction: {
                select: {
                  id: true,
                  txid: true,
                  type: true,
                  amount: true,
                  confirmations: true,
                  blockTime: true,
                },
              },
            },
          },
          addressLabels: {
            include: {
              address: {
                select: {
                  id: true,
                  address: true,
                  derivationPath: true,
                  index: true,
                  used: true,
                },
              },
            },
          },
        },
      });

      if (!label) return null;

      return {
        ...label,
        transactions: label.transactionLabels.map(tl => tl.transaction),
        addresses: label.addressLabels.map(al => al.address),
      };
    },

    async findByNameInWallet(walletId: string, name: string) {
      return client.label.findFirst({ where: { walletId, name } });
    },

    async isNameTakenByOther(walletId: string, name: string, excludeLabelId: string) {
      const label = await client.label.findFirst({
        where: { walletId, name, id: { not: excludeLabelId } },
        select: { id: true },
      });
      return label !== null;
    },

    async findManyByIdsInWallet(labelIds: string[], walletId: string) {
      return client.label.findMany({
        where: { id: { in: labelIds }, walletId },
      });
    },

    async create(data) {
      return client.label.create({
        data: {
          walletId: data.walletId,
          name: data.name.trim(),
          color: data.color || '#6366f1',
          description: data.description || null,
        },
      });
    },

    async update(labelId: string, data) {
      return client.label.update({
        where: { id: labelId },
        data: {
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.color !== undefined && { color: data.color }),
          ...(data.description !== undefined && { description: data.description }),
        },
      });
    },

    async remove(labelId: string) {
      await client.label.delete({ where: { id: labelId } });
    },

    async getLabelsForTransaction(transactionId: string) {
      const associations = await client.transactionLabel.findMany({
        where: { transactionId },
        include: { label: true },
      });
      return associations.map(a => a.label);
    },

    async addLabelsToTransaction(transactionId: string, labelIds: string[]) {
      await client.transactionLabel.createMany({
        data: labelIds.map(labelId => ({ transactionId, labelId })),
        skipDuplicates: true,
      });
    },

    async replaceTransactionLabels(transactionId: string, labelIds: string[]) {
      await client.$transaction([
        client.transactionLabel.deleteMany({ where: { transactionId } }),
        client.transactionLabel.createMany({
          data: labelIds.map(labelId => ({ transactionId, labelId })),
        }),
      ]);
    },

    async removeLabelFromTransaction(transactionId: string, labelId: string) {
      await client.transactionLabel.deleteMany({ where: { transactionId, labelId } });
    },

    async getLabelsForAddress(addressId: string) {
      const associations = await client.addressLabel.findMany({
        where: { addressId },
        include: { label: true },
      });
      return associations.map(a => a.label);
    },

    async addLabelsToAddress(addressId: string, labelIds: string[]) {
      await client.addressLabel.createMany({
        data: labelIds.map(labelId => ({ addressId, labelId })),
        skipDuplicates: true,
      });
    },

    async replaceAddressLabels(addressId: string, labelIds: string[]) {
      await client.$transaction([
        client.addressLabel.deleteMany({ where: { addressId } }),
        client.addressLabel.createMany({
          data: labelIds.map(labelId => ({ addressId, labelId })),
        }),
      ]);
    },

    async removeLabelFromAddress(addressId: string, labelId: string) {
      await client.addressLabel.deleteMany({ where: { addressId, labelId } });
    },
  };
}

/**
 * Create all repositories with injectable client
 */
export function createRepositories(client: PrismaClientLike = prisma): RepositoryFactory {
  return {
    wallet: createWalletRepository(client),
    transaction: createTransactionRepository(client),
    address: createAddressRepository(client),
    utxo: createUtxoRepository(client),
    user: createUserRepository(client),
    label: createLabelRepository(client),
  };
}

// Default repositories using the real Prisma client
export const repositories = createRepositories();

/**
 * Create a mock Prisma client for testing
 * Returns a partial mock that can be customized per test
 *
 * @param mockFn - A mock function creator (e.g., vi.fn from Vitest)
 *                 Defaults to a simple function that returns promises
 */
export function createMockPrismaClient(
  mockFn?: <T>(impl?: () => T) => (() => T) & { mockResolvedValue?: (val: T) => void; mockImplementation?: (fn: (...args: unknown[]) => T) => void }
): PrismaClientLike {
  // Default simple mock function if none provided
  const createFn = mockFn || (<T>(impl?: () => T) => {
    const fn = (..._args: unknown[]) => impl ? Promise.resolve(impl()) : Promise.resolve(null);
    return fn as unknown as (() => T) & { mockResolvedValue?: (val: T) => void };
  });

  const createMockModel = () => ({
    findUnique: createFn(() => null as unknown),
    findFirst: createFn(() => null as unknown),
    findMany: createFn(() => [] as unknown),
    create: createFn(() => ({} as unknown)),
    update: createFn(() => ({} as unknown)),
    delete: createFn(() => ({} as unknown)),
    deleteMany: createFn(() => ({ count: 0 } as unknown)),
    updateMany: createFn(() => ({ count: 0 } as unknown)),
    count: createFn(() => 0 as unknown),
    aggregate: createFn(() => ({ _sum: { amount: BigInt(0) } } as unknown)),
  });

  const transactionFn = createFn();
  const mockTransaction = (fn: (client: unknown) => unknown) => fn({
    wallet: createMockModel(),
    transaction: createMockModel(),
    address: createMockModel(),
    uTXO: createMockModel(),
    user: createMockModel(),
    label: createMockModel(),
    transactionLabel: createMockModel(),
    addressLabel: createMockModel(),
  });

  return {
    wallet: createMockModel() as unknown as PrismaClient['wallet'],
    transaction: createMockModel() as unknown as PrismaClient['transaction'],
    address: createMockModel() as unknown as PrismaClient['address'],
    uTXO: createMockModel() as unknown as PrismaClient['uTXO'],
    user: createMockModel() as unknown as PrismaClient['user'],
    walletUser: createMockModel() as unknown as PrismaClient['walletUser'],
    groupMember: createMockModel() as unknown as PrismaClient['groupMember'],
    label: createMockModel() as unknown as PrismaClient['label'],
    transactionLabel: createMockModel() as unknown as PrismaClient['transactionLabel'],
    addressLabel: createMockModel() as unknown as PrismaClient['addressLabel'],
    $transaction: transactionFn || mockTransaction,
  } as PrismaClientLike;
}
