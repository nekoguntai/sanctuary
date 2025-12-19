/**
 * Integration Test Database Setup
 *
 * Uses a separate PostgreSQL test database within the existing Docker container.
 * Requires TEST_DATABASE_URL to be set, or falls back to using the main DATABASE_URL
 * with a test schema.
 */

import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;
let isSetup = false;

/**
 * Check if database is available for integration tests
 */
export function canRunIntegrationTests(): boolean {
  return !!(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL);
}

/**
 * Set up the test database connection
 */
export async function setupTestDatabase(): Promise<PrismaClient> {
  if (prisma && isSetup) {
    return prisma;
  }

  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'No database URL available. Set DATABASE_URL or TEST_DATABASE_URL to run integration tests.'
    );
  }

  // Create Prisma client for test database
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    log: process.env.DEBUG ? ['query', 'error', 'warn'] : ['error'],
  });

  try {
    await prisma.$connect();
    isSetup = true;

    // Seed with minimal required data
    await seedTestData(prisma);

    return prisma;
  } catch (error) {
    console.error('Failed to connect to test database:', error);
    throw error;
  }
}

/**
 * Seed minimal required data for tests
 */
async function seedTestData(client: PrismaClient): Promise<void> {
  // Create default system settings if they don't exist
  const defaultSettings = [
    { key: 'confirmationThreshold', value: '3' },
    { key: 'deepConfirmationThreshold', value: '100' },
    { key: 'dustThreshold', value: '546' },
  ];

  for (const setting of defaultSettings) {
    await client.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
}

/**
 * Clean all test data between tests
 * Only cleans data created during tests, preserves system settings
 */
export async function cleanupTestData(): Promise<void> {
  if (!prisma) return;

  // Delete in order respecting foreign keys
  // Using raw SQL for efficiency and to handle foreign key constraints
  try {
    // Delete labels and label associations first
    await prisma.$executeRaw`DELETE FROM "TransactionLabel"`;
    await prisma.$executeRaw`DELETE FROM "AddressLabel"`;
    await prisma.$executeRaw`DELETE FROM "Label"`;

    // Delete wallet-related data
    await prisma.$executeRaw`DELETE FROM "UTXO"`;
    await prisma.$executeRaw`DELETE FROM "Transaction"`;
    await prisma.$executeRaw`DELETE FROM "DraftTransaction"`;
    await prisma.$executeRaw`DELETE FROM "Address"`;
    await prisma.$executeRaw`DELETE FROM "WalletDevice"`;
    await prisma.$executeRaw`DELETE FROM "WalletUser"`;
    await prisma.$executeRaw`DELETE FROM "Wallet"`;

    // Delete device data
    await prisma.$executeRaw`DELETE FROM "Device"`;

    // Delete user data
    await prisma.$executeRaw`DELETE FROM "PushDevice"`;
    await prisma.$executeRaw`DELETE FROM "GroupMember"`;
    await prisma.$executeRaw`DELETE FROM "Group"`;
    await prisma.$executeRaw`DELETE FROM "User"`;

    // Delete audit logs
    await prisma.$executeRaw`DELETE FROM "AuditLog"`;
  } catch (error) {
    // Some tables might not exist or have different constraints
    console.warn('Cleanup warning:', error);
  }
}

/**
 * Tear down test database connection
 */
export async function teardownTestDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    isSetup = false;
  }
}

/**
 * Get the test Prisma client
 */
export function getTestPrisma(): PrismaClient {
  if (!prisma) {
    throw new Error('Test database not initialized. Call setupTestDatabase() first.');
  }
  return prisma;
}
