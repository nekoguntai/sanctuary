import { describe, it, expect, vi, beforeEach } from 'vitest';

let capturedHandler: ((req: any, res: any) => Promise<void> | void) | null = null;

vi.mock('http', () => {
  const createServer = (handler: any) => {
    capturedHandler = handler;
    return {
      on: vi.fn(),
      listen: vi.fn((_port: number, cb?: () => void) => cb && cb()),
      close: vi.fn((cb?: (err?: Error | null) => void) => cb && cb(null)),
    };
  };
  return {
    __esModule: true,
    default: { createServer },
    createServer,
  };
});

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

import { startHealthServer } from '../../../src/worker/healthServer';

const makeRes = () => {
  const res: any = {};
  res.headers = {};
  res.setHeader = vi.fn((key: string, value: string) => {
    res.headers[key] = value;
  });
  res.writeHead = vi.fn((status: number, headers: Record<string, string>) => {
    res.statusCode = status;
    res.headers = { ...res.headers, ...headers };
  });
  res.end = vi.fn((body?: string) => {
    res.body = body;
  });
  return res;
};

describe('Worker Health Server', () => {
  beforeEach(() => {
    capturedHandler = null;
    vi.clearAllMocks();
  });

  it('responds with healthy status', async () => {
    startHealthServer({
      port: 3005,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });

    const req = { url: '/health' };
    const res = makeRes();

    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.status).toBe('healthy');
  });

  it('responds with readiness failure', async () => {
    startHealthServer({
      port: 3006,
      healthProvider: {
        getHealth: async () => ({ redis: false, electrum: true, jobQueue: false }),
      },
    });

    const req = { url: '/ready' };
    const res = makeRes();

    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('not ready');
  });

  it('responds with metrics when provider supplies metrics', async () => {
    startHealthServer({
      port: 3007,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
        getMetrics: async () => ({
          queues: { sync: { waiting: 1, active: 0, completed: 2, failed: 0 } },
          electrum: { subscribedAddresses: 5, networks: {} },
        }),
      },
    });

    const req = { url: '/metrics' };
    const res = makeRes();

    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.queues.sync.completed).toBe(2);
  });
});
