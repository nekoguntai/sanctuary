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

import type { PrismaClient, Wallet, Transaction, Address, UTXO, User } from '@prisma/client';
import prisma from '../models/prisma';

// Type for the minimal Prisma client interface needed by repositories
export type PrismaClientLike = Pick<
  PrismaClient,
  'wallet' | 'transaction' | 'address' | 'uTXO' | 'user' | 'walletUser' | 'groupMember' | '$transaction'
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
 * Combined Repository Interface
 */
export interface RepositoryFactory {
  wallet: WalletRepositoryInterface;
  transaction: TransactionRepositoryInterface;
  address: AddressRepositoryInterface;
  utxo: UtxoRepositoryInterface;
  user: UserRepositoryInterface;
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
 * Create all repositories with injectable client
 */
export function createRepositories(client: PrismaClientLike = prisma): RepositoryFactory {
  return {
    wallet: createWalletRepository(client),
    transaction: createTransactionRepository(client),
    address: createAddressRepository(client),
    utxo: createUtxoRepository(client),
    user: createUserRepository(client),
  };
}

// Default repositories using the real Prisma client
export const repositories = createRepositories();

/**
 * Create a mock Prisma client for testing
 * Returns a partial mock that can be customized per test
 */
export function createMockPrismaClient(): PrismaClientLike {
  const createMockModel = () => ({
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: BigInt(0) } }),
  });

  return {
    wallet: createMockModel() as unknown as PrismaClient['wallet'],
    transaction: createMockModel() as unknown as PrismaClient['transaction'],
    address: createMockModel() as unknown as PrismaClient['address'],
    uTXO: createMockModel() as unknown as PrismaClient['uTXO'],
    user: createMockModel() as unknown as PrismaClient['user'],
    walletUser: createMockModel() as unknown as PrismaClient['walletUser'],
    groupMember: createMockModel() as unknown as PrismaClient['groupMember'],
    $transaction: jest.fn().mockImplementation((fn) => fn({
      wallet: createMockModel(),
      transaction: createMockModel(),
      address: createMockModel(),
      uTXO: createMockModel(),
      user: createMockModel(),
    })),
  } as PrismaClientLike;
}
