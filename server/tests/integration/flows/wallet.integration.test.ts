/**
 * Wallet Lifecycle Integration Tests
 *
 * Tests the complete wallet lifecycle:
 * - Create wallets (single-sig, multi-sig)
 * - Get wallet details
 * - Update wallet settings
 * - Add/remove devices from wallet
 * - Delete wallet
 * - Wallet access permissions (owner, viewer, signer roles)
 *
 * Requires a running PostgreSQL database.
 * Set DATABASE_URL or TEST_DATABASE_URL environment variable.
 *
 * Run with: npm run test:integration
 */

import request from 'supertest';
import { setupTestDatabase, cleanupTestData, teardownTestDatabase, canRunIntegrationTests } from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import { TEST_USER, createTestUser, loginTestUser, createAndLoginUser, authHeader } from '../setup/helpers';
import { PrismaClient } from '@prisma/client';
import { Express } from 'express';

// Increase timeout for integration tests
jest.setTimeout(30000);

// Skip all tests if no database is available
const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Wallet Lifecycle Integration', () => {
  let app: Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Mock external services before importing routes
    jest.doMock('../../../src/services/bitcoin/electrum', () => ({
      getElectrumClient: jest.fn().mockResolvedValue({
        connect: jest.fn().mockResolvedValue(undefined),
        isConnected: jest.fn().mockReturnValue(true),
        blockchainScripthash_getBalance: jest.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
        blockchainScripthash_listunspent: jest.fn().mockResolvedValue([]),
        blockchainScripthash_getHistory: jest.fn().mockResolvedValue([]),
      }),
    }));

    prisma = await setupTestDatabase();
    app = createTestApp();
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  describe('Create Wallet', () => {
    it('should create a single-sig native segwit wallet', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const walletData = {
        name: 'My Single Sig Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      };

      const response = await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send(walletData)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe(walletData.name);
      expect(response.body.type).toBe(walletData.type);
      expect(response.body.scriptType).toBe(walletData.scriptType);
      expect(response.body.network).toBe(walletData.network);
      expect(response.body.descriptor).toBe(walletData.descriptor);
    });

    it('should create a multi-sig wallet', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const walletData = {
        name: 'My Multi-Sig Wallet',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'testnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: "wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/2']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[11223344/48'/1'/0'/2']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*,[55667788/48'/1'/0'/2']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*))",
      };

      const response = await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send(walletData)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.name).toBe(walletData.name);
      expect(response.body.type).toBe(walletData.type);
      expect(response.body.quorum).toBe(walletData.quorum);
      expect(response.body.totalSigners).toBe(walletData.totalSigners);
    });

    it('should create a taproot wallet', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const walletData = {
        name: 'My Taproot Wallet',
        type: 'single_sig',
        scriptType: 'taproot',
        network: 'testnet',
        descriptor: "tr([aabbccdd/86'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
      };

      const response = await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send(walletData)
        .expect(201);

      expect(response.body.scriptType).toBe('taproot');
    });

    it('should reject wallet creation with missing required fields', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send({
          name: 'Incomplete Wallet',
          // Missing type and scriptType
        })
        .expect(400);
    });

    it('should reject wallet creation with invalid type', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send({
          name: 'Invalid Wallet',
          type: 'invalid_type',
          scriptType: 'native_segwit',
        })
        .expect(400);
    });

    it('should reject wallet creation with invalid scriptType', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .post('/api/v1/wallets')
        .set(authHeader(token))
        .send({
          name: 'Invalid Wallet',
          type: 'single_sig',
          scriptType: 'invalid_script',
        })
        .expect(400);
    });
  });

  describe('Get Wallets', () => {
    it('should get all wallets for a user', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      // Create multiple wallets
      const wallet1 = await prisma.wallet.create({
        data: {
          name: 'Wallet 1',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const wallet2 = await prisma.wallet.create({
        data: {
          name: 'Wallet 2',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          network: 'mainnet',
          quorum: 2,
          totalSigners: 3,
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .get('/api/v1/wallets')
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
      expect(response.body.find((w: any) => w.id === wallet1.id)).toBeDefined();
      expect(response.body.find((w: any) => w.id === wallet2.id)).toBeDefined();
    });

    it('should return empty array when user has no wallets', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      const response = await request(app)
        .get('/api/v1/wallets')
        .set(authHeader(token))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });
  });

  describe('Get Wallet by ID', () => {
    it('should get a specific wallet by ID', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          network: 'testnet',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body.id).toBe(wallet.id);
      expect(response.body.name).toBe(wallet.name);
      expect(response.body.type).toBe(wallet.type);
    });

    it('should return 404 for non-existent wallet', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      await request(app)
        .get('/api/v1/wallets/00000000-0000-0000-0000-000000000000')
        .set(authHeader(token))
        .expect(404);
    });

    it('should deny access to wallet user does not have access to', async () => {
      const { token } = await createAndLoginUser(app, prisma);

      // Create another user and their wallet
      const otherUser = await createTestUser(prisma, {
        username: 'otheruser',
        password: 'OtherPassword123!',
      });

      const otherWallet = await prisma.wallet.create({
        data: {
          name: 'Other User Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId: otherUser.id,
              role: 'owner',
            },
          },
        },
      });

      await request(app)
        .get(`/api/v1/wallets/${otherWallet.id}`)
        .set(authHeader(token))
        .expect(403);
    });
  });

  describe('Update Wallet', () => {
    it('should update wallet name (owner only)', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Original Name',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .patch(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(token))
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');

      // Verify in database
      const updated = await prisma.wallet.findUnique({
        where: { id: wallet.id },
      });
      expect(updated?.name).toBe('Updated Name');
    });

    it('should update wallet descriptor (owner only)', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          descriptor: "wpkh([old]tpubOld/0/*)",
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const newDescriptor = "wpkh([aabbccdd/84'/1'/0']tpubNew/0/*)";
      const response = await request(app)
        .patch(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(token))
        .send({ descriptor: newDescriptor })
        .expect(200);

      expect(response.body.descriptor).toBe(newDescriptor);
    });

    it('should deny update for non-owner (viewer)', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma, {
        username: 'viewer',
        password: 'ViewerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: viewerId, role: 'viewer' },
            ],
          },
        },
      });

      await request(app)
        .patch(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(viewerToken))
        .send({ name: 'Hacked Name' })
        .expect(403);
    });

    it('should deny update for non-owner (signer)', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: signerId, token: signerToken } = await createAndLoginUser(app, prisma, {
        username: 'signer',
        password: 'SignerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: signerId, role: 'signer' },
            ],
          },
        },
      });

      await request(app)
        .patch(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(signerToken))
        .send({ name: 'Hacked Name' })
        .expect(403);
    });
  });

  describe('Delete Wallet', () => {
    it('should delete wallet (owner only)', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Wallet to Delete',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      await request(app)
        .delete(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(token))
        .expect(204);

      // Verify wallet is deleted
      const deleted = await prisma.wallet.findUnique({
        where: { id: wallet.id },
      });
      expect(deleted).toBeNull();
    });

    it('should deny delete for non-owner (viewer)', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma, {
        username: 'viewer',
        password: 'ViewerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Protected Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: viewerId, role: 'viewer' },
            ],
          },
        },
      });

      await request(app)
        .delete(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(viewerToken))
        .expect(403);

      // Verify wallet still exists
      const stillExists = await prisma.wallet.findUnique({
        where: { id: wallet.id },
      });
      expect(stillExists).not.toBeNull();
    });

    it('should deny delete for non-owner (signer)', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: signerId, token: signerToken } = await createAndLoginUser(app, prisma, {
        username: 'signer',
        password: 'SignerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Protected Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: signerId, role: 'signer' },
            ],
          },
        },
      });

      await request(app)
        .delete(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(signerToken))
        .expect(403);

      // Verify wallet still exists
      const stillExists = await prisma.wallet.findUnique({
        where: { id: wallet.id },
      });
      expect(stillExists).not.toBeNull();
    });
  });

  describe('Wallet Devices', () => {
    it('should add a device to wallet (owner or signer)', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const device = await prisma.device.create({
        data: {
          userId,
          type: 'coldcard',
          label: 'My ColdCard',
          fingerprint: 'aabbccdd',
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: "m/84'/1'/0'",
        },
      });

      const response = await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(token))
        .send({ deviceId: device.id })
        .expect(201);

      expect(response.body.message).toBeDefined();

      // Verify device is linked to wallet
      const walletDevice = await prisma.walletDevice.findFirst({
        where: {
          walletId: wallet.id,
          deviceId: device.id,
        },
      });
      expect(walletDevice).not.toBeNull();
    });

    it('should add device with signer index for multi-sig', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Multi-Sig Wallet',
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          totalSigners: 3,
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const device = await prisma.device.create({
        data: {
          userId,
          type: 'coldcard',
          label: 'ColdCard 1',
          fingerprint: '11223344',
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
          derivationPath: "m/48'/1'/0'/2'",
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(token))
        .send({ deviceId: device.id, signerIndex: 0 })
        .expect(201);

      // Verify signer index is set
      const walletDevice = await prisma.walletDevice.findFirst({
        where: {
          walletId: wallet.id,
          deviceId: device.id,
        },
      });
      expect(walletDevice?.signerIndex).toBe(0);
    });

    it('should allow signer to add device', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: signerId, token: signerToken } = await createAndLoginUser(app, prisma, {
        username: 'signer',
        password: 'SignerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: signerId, role: 'signer' },
            ],
          },
        },
      });

      const device = await prisma.device.create({
        data: {
          userId: signerId,
          type: 'ledger',
          label: 'Signer Ledger',
          fingerprint: '55667788',
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(signerToken))
        .send({ deviceId: device.id })
        .expect(201);
    });

    it('should deny viewer from adding device', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma, {
        username: 'viewer',
        password: 'ViewerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: viewerId, role: 'viewer' },
            ],
          },
        },
      });

      const device = await prisma.device.create({
        data: {
          userId: viewerId,
          type: 'ledger',
          label: 'Viewer Ledger',
          fingerprint: '99887766',
          xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(viewerToken))
        .send({ deviceId: device.id })
        .expect(403);
    });

    it('should reject adding device without deviceId', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/devices`)
        .set(authHeader(token))
        .send({})
        .expect(400);
    });
  });

  describe('Wallet Sharing', () => {
    describe('Share with User', () => {
      it('should share wallet with another user as viewer', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: 'owner',
          password: 'OwnerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: 'targetuser',
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: {
                userId: ownerId,
                role: 'owner',
              },
            },
          },
        });

        const response = await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(ownerToken))
          .send({
            targetUserId: targetUser.id,
            role: 'viewer',
          })
          .expect(201);

        expect(response.body.success).toBe(true);

        // Verify user has access
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: targetUser.id,
          },
        });
        expect(walletUser).not.toBeNull();
        expect(walletUser?.role).toBe('viewer');
      });

      it('should share wallet with another user as signer', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: 'owner',
          password: 'OwnerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: 'targetuser',
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: {
                userId: ownerId,
                role: 'owner',
              },
            },
          },
        });

        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(ownerToken))
          .send({
            targetUserId: targetUser.id,
            role: 'signer',
          })
          .expect(201);

        // Verify user has signer access
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: targetUser.id,
          },
        });
        expect(walletUser?.role).toBe('signer');
      });

      it('should update existing user access when sharing again', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: 'owner',
          password: 'OwnerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: 'targetuser',
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: [
                { userId: ownerId, role: 'owner' },
                { userId: targetUser.id, role: 'viewer' },
              ],
            },
          },
        });

        // Upgrade viewer to signer
        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(ownerToken))
          .send({
            targetUserId: targetUser.id,
            role: 'signer',
          })
          .expect(200);

        // Verify role was updated
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: targetUser.id,
          },
        });
        expect(walletUser?.role).toBe('signer');
      });

      it('should deny non-owner from sharing wallet', async () => {
        const owner = await createTestUser(prisma, {
          username: 'owner',
          password: 'OwnerPass123!',
        });

        const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma, {
          username: 'viewer',
          password: 'ViewerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: 'targetuser',
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: [
                { userId: owner.id, role: 'owner' },
                { userId: viewerId, role: 'viewer' },
              ],
            },
          },
        });

        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(viewerToken))
          .send({
            targetUserId: targetUser.id,
            role: 'viewer',
          })
          .expect(403);
      });

      it('should return 404 when sharing with non-existent user', async () => {
        const { userId, token } = await createAndLoginUser(app, prisma);

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: {
                userId,
                role: 'owner',
              },
            },
          },
        });

        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(token))
          .send({
            targetUserId: '00000000-0000-0000-0000-000000000000',
            role: 'viewer',
          })
          .expect(404);
      });

      it('should reject sharing with invalid role', async () => {
        const { userId, token } = await createAndLoginUser(app, prisma);

        const targetUser = await createTestUser(prisma, {
          username: 'targetuser',
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: {
                userId,
                role: 'owner',
              },
            },
          },
        });

        await request(app)
          .post(`/api/v1/wallets/${wallet.id}/share/user`)
          .set(authHeader(token))
          .send({
            targetUserId: targetUser.id,
            role: 'invalid_role',
          })
          .expect(400);
      });
    });

    describe('Remove User Access', () => {
      it('should remove user access from wallet', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: 'owner',
          password: 'OwnerPass123!',
        });

        const targetUser = await createTestUser(prisma, {
          username: 'targetuser',
          password: 'TargetPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: [
                { userId: ownerId, role: 'owner' },
                { userId: targetUser.id, role: 'viewer' },
              ],
            },
          },
        });

        await request(app)
          .delete(`/api/v1/wallets/${wallet.id}/share/user/${targetUser.id}`)
          .set(authHeader(ownerToken))
          .expect(200);

        // Verify user no longer has access
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: targetUser.id,
          },
        });
        expect(walletUser).toBeNull();
      });

      it('should prevent removing the owner', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: 'owner',
          password: 'OwnerPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: {
                userId: ownerId,
                role: 'owner',
              },
            },
          },
        });

        await request(app)
          .delete(`/api/v1/wallets/${wallet.id}/share/user/${ownerId}`)
          .set(authHeader(ownerToken))
          .expect(400);

        // Verify owner still has access
        const walletUser = await prisma.walletUser.findFirst({
          where: {
            walletId: wallet.id,
            userId: ownerId,
          },
        });
        expect(walletUser).not.toBeNull();
      });

      it('should return 404 when removing non-existent user', async () => {
        const { userId, token } = await createAndLoginUser(app, prisma);

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Test Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: {
                userId,
                role: 'owner',
              },
            },
          },
        });

        await request(app)
          .delete(`/api/v1/wallets/${wallet.id}/share/user/00000000-0000-0000-0000-000000000000`)
          .set(authHeader(token))
          .expect(404);
      });
    });

    describe('Get Sharing Info', () => {
      it('should get wallet sharing information', async () => {
        const { userId: ownerId, token: ownerToken } = await createAndLoginUser(app, prisma, {
          username: 'owner',
          password: 'OwnerPass123!',
        });

        const viewer = await createTestUser(prisma, {
          username: 'viewer',
          password: 'ViewerPass123!',
        });

        const signer = await createTestUser(prisma, {
          username: 'signer',
          password: 'SignerPass123!',
        });

        const wallet = await prisma.wallet.create({
          data: {
            name: 'Shared Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            users: {
              create: [
                { userId: ownerId, role: 'owner' },
                { userId: viewer.id, role: 'viewer' },
                { userId: signer.id, role: 'signer' },
              ],
            },
          },
        });

        const response = await request(app)
          .get(`/api/v1/wallets/${wallet.id}/share`)
          .set(authHeader(ownerToken))
          .expect(200);

        expect(response.body.users).toBeDefined();
        expect(Array.isArray(response.body.users)).toBe(true);
        expect(response.body.users.length).toBe(3);

        // Verify all roles are present
        const roles = response.body.users.map((u: any) => u.role);
        expect(roles).toContain('owner');
        expect(roles).toContain('viewer');
        expect(roles).toContain('signer');
      });
    });
  });

  describe('Wallet Access Permissions', () => {
    it('should allow viewer to view wallet', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma, {
        username: 'viewer',
        password: 'ViewerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: viewerId, role: 'viewer' },
            ],
          },
        },
      });

      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}`)
        .set(authHeader(viewerToken))
        .expect(200);

      expect(response.body.id).toBe(wallet.id);
    });

    it('should deny viewer from generating addresses', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma, {
        username: 'viewer',
        password: 'ViewerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: viewerId, role: 'viewer' },
            ],
          },
        },
      });

      await request(app)
        .post(`/api/v1/wallets/${wallet.id}/addresses`)
        .set(authHeader(viewerToken))
        .expect(403);
    });

    it('should allow signer to generate addresses', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: signerId, token: signerToken } = await createAndLoginUser(app, prisma, {
        username: 'signer',
        password: 'SignerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: signerId, role: 'signer' },
            ],
          },
        },
      });

      const response = await request(app)
        .post(`/api/v1/wallets/${wallet.id}/addresses`)
        .set(authHeader(signerToken))
        .expect(201);

      expect(response.body.address).toBeDefined();
    });

    it('should allow owner to generate addresses', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          descriptor: "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)",
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .post(`/api/v1/wallets/${wallet.id}/addresses`)
        .set(authHeader(token))
        .expect(201);

      expect(response.body.address).toBeDefined();
    });
  });

  describe('Wallet Stats', () => {
    it('should get wallet statistics', async () => {
      const { userId, token } = await createAndLoginUser(app, prisma);

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
      });

      const response = await request(app)
        .get(`/api/v1/wallets/${wallet.id}/stats`)
        .set(authHeader(token))
        .expect(200);

      expect(response.body).toBeDefined();
      // Stats should include balance, transaction count, etc.
    });

    it('should allow viewer to access wallet stats', async () => {
      const owner = await createTestUser(prisma, {
        username: 'owner',
        password: 'OwnerPass123!',
      });

      const { userId: viewerId, token: viewerToken } = await createAndLoginUser(app, prisma, {
        username: 'viewer',
        password: 'ViewerPass123!',
      });

      const wallet = await prisma.wallet.create({
        data: {
          name: 'Test Wallet',
          type: 'single_sig',
          scriptType: 'native_segwit',
          users: {
            create: [
              { userId: owner.id, role: 'owner' },
              { userId: viewerId, role: 'viewer' },
            ],
          },
        },
      });

      await request(app)
        .get(`/api/v1/wallets/${wallet.id}/stats`)
        .set(authHeader(viewerToken))
        .expect(200);
    });
  });
});
