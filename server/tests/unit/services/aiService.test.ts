import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  systemSettingFindMany: vi.fn(),
}));

vi.mock('../../../src/repositories/db', () => {
  const prisma = {
    systemSetting: {
      findMany: mocks.systemSettingFindMany,
    },
  };
  return {
    __esModule: true,
    db: prisma,
    default: prisma,
  };
});

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function setting(key: string, value: unknown) {
  return { key, value: JSON.stringify(value) };
}

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as any;
}

function errJson(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as any;
}

describe('aiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.systemSettingFindMany.mockResolvedValue([]);
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns enabled=true only when all required settings are configured', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.isEnabled()).resolves.toBe(true);
  });

  it('returns disabled health when AI is turned off', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', false),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health.available).toBe(false);
    expect(health.error).toContain('disabled');
  });

  it('reports container unavailable when /health check fails', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(errJson(503, { error: 'down' }));

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health.available).toBe(false);
    expect(health.containerAvailable).toBe(false);
    expect(health.error).toContain('container');
  });

  it('syncs config and reports healthy AI container', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: 'ok' }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ available: true }));

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health).toMatchObject({
      available: true,
      model: 'llama3.2',
      endpoint: 'http://ollama:11434',
      containerAvailable: true,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      'http://ai:3100/config',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('suggests transaction labels from AI container', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ suggestion: 'Payroll income' }));

    const mod = await import('../../../src/services/aiService');
    const suggestion = await mod.suggestTransactionLabel('tx-1', 'token-abc');

    expect(suggestion).toBe('Payroll income');
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      'http://ai:3100/suggest-label',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-abc',
        }),
      })
    );
  });

  it('returns null for invalid natural query response payloads', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ invalid: true }));

    const mod = await import('../../../src/services/aiService');
    const result = await mod.executeNaturalQuery('show latest', 'wallet-1', 'token-xyz');

    expect(result).toBeNull();
  });

  it('detects Ollama and validates response format', async () => {
    mocks.fetch.mockResolvedValueOnce(okJson({ found: true, endpoint: 'http://localhost:11434' }));

    const mod = await import('../../../src/services/aiService');
    const result = await mod.detectOllama();

    expect(result).toEqual({
      found: true,
      endpoint: 'http://localhost:11434',
    });
  });

  it('returns list-models error when endpoint is missing', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiModel', 'llama3.2'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    const result = await mod.listModels();

    expect(result.models).toEqual([]);
    expect(result.error).toContain('endpoint');
  });

  it('lists models through the AI container', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({
        models: [{ name: 'llama3.2', size: 123, modifiedAt: '2026-01-01T00:00:00Z' }],
      }));

    const mod = await import('../../../src/services/aiService');
    const result = await mod.listModels();

    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe('llama3.2');
  });

  it('handles pull and delete model error responses', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(500, { error: 'pull failed' }))
      .mockResolvedValueOnce(errJson(500, { error: 'delete failed' }));

    const mod = await import('../../../src/services/aiService');
    const pull = await mod.pullModel('llama3.2');
    const del = await mod.deleteModel('llama3.2');

    expect(pull).toEqual({ success: false, error: 'pull failed' });
    expect(del).toEqual({ success: false, error: 'delete failed' });
  });

  it('forceSyncConfig returns false when config sync request fails', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch.mockRejectedValue(new Error('connection refused'));

    const mod = await import('../../../src/services/aiService');
    const synced = await mod.forceSyncConfig();

    expect(synced).toBe(false);
  });
});
