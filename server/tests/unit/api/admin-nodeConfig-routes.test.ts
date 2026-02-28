import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const {
  mockTestNodeConfig,
  mockResetNodeClient,
  mockEncrypt,
  mockAuditLogFromRequest,
  mockSocksCreateConnection,
  mockNodeFetch,
} = vi.hoisted(() => ({
  mockTestNodeConfig: vi.fn(),
  mockResetNodeClient: vi.fn(),
  mockEncrypt: vi.fn((value: string) => `enc:${value}`),
  mockAuditLogFromRequest: vi.fn(),
  mockSocksCreateConnection: vi.fn(),
  mockNodeFetch: vi.fn(),
}));

vi.mock('../../../src/repositories/db', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    db: prisma,
    default: prisma,
  };
});

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  testNodeConfig: mockTestNodeConfig,
  resetNodeClient: mockResetNodeClient,
}));

vi.mock('../../../src/utils/encryption', () => ({
  encrypt: mockEncrypt,
}));

vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    logFromRequest: mockAuditLogFromRequest,
  },
  AuditAction: {
    NODE_CONFIG_UPDATE: 'NODE_CONFIG_UPDATE',
  },
  AuditCategory: {
    ADMIN: 'ADMIN',
  },
}));

vi.mock('socks', () => ({
  SocksClient: {
    createConnection: mockSocksCreateConnection,
  },
}));

vi.mock('socks-proxy-agent', () => ({
  SocksProxyAgent: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('node-fetch', () => ({
  __esModule: true,
  default: mockNodeFetch,
}));

import nodeConfigRouter from '../../../src/api/admin/nodeConfig';

type NodeConfigRecord = {
  id: string;
  type: string;
  host: string;
  port: number;
  useSsl: boolean;
  allowSelfSignedCert: boolean;
  explorerUrl: string;
  feeEstimatorUrl: string | null;
  mempoolEstimator: string;
  poolEnabled: boolean;
  poolMinConnections: number;
  poolMaxConnections: number;
  poolLoadBalancing: string;
  servers: Array<{ id: string; host: string; port: number; priority: number }>;
  mainnetMode: string;
  mainnetSingletonHost: string | null;
  mainnetSingletonPort: number | null;
  mainnetSingletonSsl: boolean | null;
  mainnetPoolMin: number | null;
  mainnetPoolMax: number | null;
  mainnetPoolLoadBalancing: string | null;
  testnetEnabled: boolean;
  testnetMode: string | null;
  testnetSingletonHost: string | null;
  testnetSingletonPort: number | null;
  testnetSingletonSsl: boolean | null;
  testnetPoolMin: number | null;
  testnetPoolMax: number | null;
  testnetPoolLoadBalancing: string | null;
  signetEnabled: boolean;
  signetMode: string | null;
  signetSingletonHost: string | null;
  signetSingletonPort: number | null;
  signetSingletonSsl: boolean | null;
  signetPoolMin: number | null;
  signetPoolMax: number | null;
  signetPoolLoadBalancing: string | null;
  proxyEnabled: boolean;
  proxyHost: string | null;
  proxyPort: number | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
  isDefault: boolean;
};

function buildNodeConfig(overrides: Partial<NodeConfigRecord> = {}): NodeConfigRecord {
  return {
    id: 'default',
    type: 'electrum',
    host: 'electrum.example.com',
    port: 50002,
    useSsl: true,
    allowSelfSignedCert: false,
    explorerUrl: 'https://mempool.space',
    feeEstimatorUrl: 'https://mempool.space',
    mempoolEstimator: 'simple',
    poolEnabled: true,
    poolMinConnections: 1,
    poolMaxConnections: 5,
    poolLoadBalancing: 'round_robin',
    servers: [],
    mainnetMode: 'pool',
    mainnetSingletonHost: 'electrum.blockstream.info',
    mainnetSingletonPort: 50002,
    mainnetSingletonSsl: true,
    mainnetPoolMin: 1,
    mainnetPoolMax: 5,
    mainnetPoolLoadBalancing: 'round_robin',
    testnetEnabled: false,
    testnetMode: 'singleton',
    testnetSingletonHost: 'electrum.blockstream.info',
    testnetSingletonPort: 60002,
    testnetSingletonSsl: true,
    testnetPoolMin: 1,
    testnetPoolMax: 3,
    testnetPoolLoadBalancing: 'round_robin',
    signetEnabled: false,
    signetMode: 'singleton',
    signetSingletonHost: 'electrum.mutinynet.com',
    signetSingletonPort: 50002,
    signetSingletonSsl: true,
    signetPoolMin: 1,
    signetPoolMax: 3,
    signetPoolLoadBalancing: 'round_robin',
    proxyEnabled: false,
    proxyHost: null,
    proxyPort: null,
    proxyUsername: null,
    proxyPassword: null,
    isDefault: true,
    ...overrides,
  };
}

describe('Admin Node Config Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', nodeConfigRouter);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockAuditLogFromRequest.mockResolvedValue(undefined);
    mockResetNodeClient.mockResolvedValue(undefined);
    mockTestNodeConfig.mockResolvedValue({
      success: true,
      message: 'Connection successful',
      info: { blockHeight: 850000 },
    });
    mockSocksCreateConnection.mockResolvedValue({
      socket: { destroy: vi.fn() },
    });
    mockNodeFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ IsTor: true, IP: '1.2.3.4' }),
    });
  });

  it('returns defaults when node config does not exist', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/admin/node-config');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      type: 'electrum',
      host: 'electrum.blockstream.info',
      port: '50002',
      hasPassword: false,
      poolEnabled: true,
    });
    expect(response.body.servers).toEqual([]);
  });

  it('returns persisted config and masks proxy password', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        host: 'saved.example.com',
        port: 60002,
        proxyEnabled: true,
        proxyPassword: 'encrypted-secret',
      })
    );

    const response = await request(app).get('/api/v1/admin/node-config');

    expect(response.status).toBe(200);
    expect(response.body.host).toBe('saved.example.com');
    expect(response.body.port).toBe('60002');
    expect(response.body.proxyPassword).toBe('********');
  });

  it('returns 500 when loading node config fails', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockRejectedValue(new Error('read failed'));

    const response = await request(app).get('/api/v1/admin/node-config');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'Failed to get node configuration',
    });
  });

  it('validates required fields on update', async () => {
    const response = await request(app)
      .put('/api/v1/admin/node-config')
      .send({ type: 'electrum', host: 'example.com' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('required');
  });

  it('rejects unsupported node type on update', async () => {
    const response = await request(app)
      .put('/api/v1/admin/node-config')
      .send({ type: 'rpc', host: 'example.com', port: 50002 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Only Electrum');
  });

  it('updates existing default config and resets node client', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
    mockPrismaClient.nodeConfig.update.mockResolvedValue(
      buildNodeConfig({
        id: 'default-existing',
        host: 'updated.example.com',
        port: 51001,
        proxyPassword: 'enc:proxy-secret',
      })
    );

    const response = await request(app)
      .put('/api/v1/admin/node-config')
      .send({
        type: 'electrum',
        host: 'updated.example.com',
        port: '51001',
        useSsl: true,
        mempoolEstimator: 'not-valid',
        poolLoadBalancing: 'also-invalid',
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
        proxyUsername: 'tor',
        proxyPassword: 'proxy-secret',
      });

    expect(response.status).toBe(200);
    expect(response.body.host).toBe('updated.example.com');
    expect(response.body.port).toBe('51001');
    expect(response.body.message).toContain('updated successfully');

    expect(mockEncrypt).toHaveBeenCalledWith('proxy-secret');
    expect(mockPrismaClient.nodeConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mempoolEstimator: 'simple',
          poolLoadBalancing: 'round_robin',
          proxyPassword: 'enc:proxy-secret',
        }),
      })
    );
    expect(mockAuditLogFromRequest).toHaveBeenCalled();
    expect(mockResetNodeClient).toHaveBeenCalled();
  });

  it('creates a default config when none exists', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
    mockPrismaClient.nodeConfig.create.mockResolvedValue(
      buildNodeConfig({
        id: 'default',
        host: 'new.example.com',
        port: 50001,
      })
    );

    const response = await request(app)
      .put('/api/v1/admin/node-config')
      .send({
        type: 'electrum',
        host: 'new.example.com',
        port: 50001,
      });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.nodeConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: 'default',
          isDefault: true,
          host: 'new.example.com',
          port: 50001,
        }),
      })
    );
  });

  it('returns 500 when updating node config fails', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ id: 'default-existing' });
    mockPrismaClient.nodeConfig.update.mockRejectedValue(new Error('write failed'));

    const response = await request(app)
      .put('/api/v1/admin/node-config')
      .send({
        type: 'electrum',
        host: 'updated.example.com',
        port: 50002,
      });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal Server Error',
      message: 'Failed to update node configuration',
    });
  });

  it('tests node connection successfully', async () => {
    mockTestNodeConfig.mockResolvedValue({
      success: true,
      message: 'OK',
      info: { blockHeight: 900000 },
    });

    const response = await request(app)
      .post('/api/v1/admin/node-config/test')
      .send({
        type: 'electrum',
        host: 'electrum.example.com',
        port: '50002',
        useSsl: true,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      blockHeight: 900000,
      message: 'OK',
    });
    expect(mockTestNodeConfig).toHaveBeenCalledWith({
      host: 'electrum.example.com',
      port: 50002,
      protocol: 'ssl',
    });
  });

  it('returns connection failure from node test endpoint', async () => {
    mockTestNodeConfig.mockResolvedValue({
      success: false,
      message: 'Connection refused',
    });

    const response = await request(app)
      .post('/api/v1/admin/node-config/test')
      .send({
        type: 'electrum',
        host: 'electrum.example.com',
        port: 50002,
      });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      error: 'Connection Failed',
    });
  });

  it('validates required node test fields', async () => {
    const response = await request(app)
      .post('/api/v1/admin/node-config/test')
      .send({ type: 'electrum', host: 'electrum.example.com' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('required');
  });

  it('rejects unsupported node type on test endpoint', async () => {
    const response = await request(app)
      .post('/api/v1/admin/node-config/test')
      .send({ type: 'rpc', host: 'example.com', port: 8332 });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Only Electrum');
  });

  it('handles unexpected node test errors', async () => {
    mockTestNodeConfig.mockRejectedValue(new Error('test failed'));

    const response = await request(app)
      .post('/api/v1/admin/node-config/test')
      .send({
        type: 'electrum',
        host: 'electrum.example.com',
        port: 50002,
      });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      error: 'Internal Server Error',
    });
  });

  it('validates proxy test inputs', async () => {
    const response = await request(app)
      .post('/api/v1/admin/proxy/test')
      .send({ port: 9050 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('required');
  });

  it('returns tor verification failure when .onion connection fails', async () => {
    mockSocksCreateConnection.mockRejectedValueOnce(new Error('onion connection failed'));

    const response = await request(app)
      .post('/api/v1/admin/proxy/test')
      .send({ host: '127.0.0.1', port: 9050 });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      error: 'Tor Verification Failed',
    });
  });

  it('returns successful tor verification with exit IP', async () => {
    const response = await request(app)
      .post('/api/v1/admin/proxy/test')
      .send({ host: '127.0.0.1', port: 9050 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(typeof response.body.message).toBe('string');
    expect(response.body.exitIp).toBeDefined();
    expect(typeof response.body.isTorExit).toBe('boolean');
    expect(mockSocksCreateConnection).toHaveBeenCalled();
  });

  it('handles proxy verification setup errors', async () => {
    const response = await request(app)
      .post('/api/v1/admin/proxy/test')
      .send({
        host: '127.0.0.1',
        port: { toString: null },
      });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      error: 'Tor Verification Failed',
    });
  });
});
