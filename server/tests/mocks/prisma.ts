/**
 * Prisma Client Mock
 *
 * Provides a fully mocked Prisma client for unit testing.
 * Each model's methods are mocked and can be configured per test.
 */

import { PrismaClient } from '@prisma/client';

// Create mock implementations for all Prisma model methods
const createModelMock = () => ({
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  findUnique: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'mock-id', ...data.data })),
  createMany: jest.fn().mockResolvedValue({ count: 0 }),
  update: jest.fn().mockImplementation((data) => Promise.resolve({ id: data.where.id, ...data.data })),
  updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  delete: jest.fn().mockResolvedValue(null),
  deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  upsert: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'mock-id', ...data.create })),
  count: jest.fn().mockResolvedValue(0),
  aggregate: jest.fn().mockResolvedValue({}),
  groupBy: jest.fn().mockResolvedValue([]),
});

// Create the mock Prisma client
export const mockPrismaClient = {
  // Models
  user: createModelMock(),
  wallet: createModelMock(),
  walletUser: createModelMock(),
  walletDevice: createModelMock(),
  device: createModelMock(),
  address: createModelMock(),
  transaction: createModelMock(),
  uTXO: createModelMock(),
  group: createModelMock(),
  groupMember: createModelMock(),
  label: createModelMock(),
  transactionLabel: createModelMock(),
  addressLabel: createModelMock(),
  nodeConfig: createModelMock(),
  systemSetting: createModelMock(),
  auditLog: createModelMock(),
  draftTransaction: createModelMock(),
  pushSubscription: createModelMock(),
  pushDevice: createModelMock(),
  feeEstimate: createModelMock(),
  priceData: createModelMock(),
  hardwareDeviceModel: createModelMock(),
  electrumServer: createModelMock(),
  draftUtxoLock: createModelMock(),

  // Transaction method
  $transaction: jest.fn().mockImplementation(async (callback) => {
    if (typeof callback === 'function') {
      return callback(mockPrismaClient);
    }
    // Array of operations
    return Promise.all(callback);
  }),

  // Connection methods
  $connect: jest.fn().mockResolvedValue(undefined),
  $disconnect: jest.fn().mockResolvedValue(undefined),
  $executeRaw: jest.fn().mockResolvedValue(0),
  $queryRaw: jest.fn().mockResolvedValue([]),
};

// Type assertion for compatibility
export const prismaMock = mockPrismaClient as unknown as PrismaClient;

// Default implementations for model methods
const defaultModelImplementations = {
  findMany: () => Promise.resolve([]),
  findFirst: () => Promise.resolve(null),
  findUnique: () => Promise.resolve(null),
  create: (data: any) => Promise.resolve({ id: 'mock-id', ...data.data }),
  createMany: () => Promise.resolve({ count: 0 }),
  update: (data: any) => Promise.resolve({ id: data.where.id, ...data.data }),
  updateMany: () => Promise.resolve({ count: 0 }),
  delete: () => Promise.resolve(null),
  deleteMany: () => Promise.resolve({ count: 0 }),
  upsert: (data: any) => Promise.resolve({ id: 'mock-id', ...data.create }),
  count: () => Promise.resolve(0),
  aggregate: () => Promise.resolve({}),
  groupBy: () => Promise.resolve([]),
};

// Helper to reset all mocks between tests
export function resetPrismaMocks(): void {
  Object.entries(mockPrismaClient).forEach(([key, model]) => {
    if (typeof model === 'object' && model !== null && !key.startsWith('$')) {
      Object.entries(model).forEach(([method, fn]) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          (fn as jest.Mock).mockReset();
          // Restore default implementation
          const defaultImpl = (defaultModelImplementations as any)[method];
          if (defaultImpl) {
            (fn as jest.Mock).mockImplementation(defaultImpl);
          }
        }
      });
    }
  });

  // Reset $transaction to its default implementation
  (mockPrismaClient.$transaction as jest.Mock).mockReset();
  (mockPrismaClient.$transaction as jest.Mock).mockImplementation(async (callback) => {
    if (typeof callback === 'function') {
      return callback(mockPrismaClient);
    }
    // Array of operations
    return Promise.all(callback);
  });

  // Reset other $ methods
  (mockPrismaClient.$connect as jest.Mock).mockReset();
  (mockPrismaClient.$connect as jest.Mock).mockResolvedValue(undefined);
  (mockPrismaClient.$disconnect as jest.Mock).mockReset();
  (mockPrismaClient.$disconnect as jest.Mock).mockResolvedValue(undefined);
  (mockPrismaClient.$executeRaw as jest.Mock).mockReset();
  (mockPrismaClient.$executeRaw as jest.Mock).mockResolvedValue(0);
  (mockPrismaClient.$queryRaw as jest.Mock).mockReset();
  (mockPrismaClient.$queryRaw as jest.Mock).mockResolvedValue([]);
}

// Helper to set up common mock returns
export function setupPrismaMockReturns(config: {
  user?: Partial<Record<keyof typeof mockPrismaClient.user, any>>;
  wallet?: Partial<Record<keyof typeof mockPrismaClient.wallet, any>>;
  address?: Partial<Record<keyof typeof mockPrismaClient.address, any>>;
  transaction?: Partial<Record<keyof typeof mockPrismaClient.transaction, any>>;
  uTXO?: Partial<Record<keyof typeof mockPrismaClient.uTXO, any>>;
  systemSetting?: Partial<Record<keyof typeof mockPrismaClient.systemSetting, any>>;
}): void {
  if (config.user) {
    Object.entries(config.user).forEach(([method, value]) => {
      (mockPrismaClient.user as any)[method].mockResolvedValue(value);
    });
  }
  if (config.wallet) {
    Object.entries(config.wallet).forEach(([method, value]) => {
      (mockPrismaClient.wallet as any)[method].mockResolvedValue(value);
    });
  }
  if (config.address) {
    Object.entries(config.address).forEach(([method, value]) => {
      (mockPrismaClient.address as any)[method].mockResolvedValue(value);
    });
  }
  if (config.transaction) {
    Object.entries(config.transaction).forEach(([method, value]) => {
      (mockPrismaClient.transaction as any)[method].mockResolvedValue(value);
    });
  }
  if (config.uTXO) {
    Object.entries(config.uTXO).forEach(([method, value]) => {
      (mockPrismaClient.uTXO as any)[method].mockResolvedValue(value);
    });
  }
  if (config.systemSetting) {
    Object.entries(config.systemSetting).forEach(([method, value]) => {
      (mockPrismaClient.systemSetting as any)[method].mockResolvedValue(value);
    });
  }
}

// Export default mock
export default prismaMock;
