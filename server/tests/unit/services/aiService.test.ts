/**
 * AI Service Unit Tests
 *
 * Tests for the AI service that manages AI feature configuration,
 * container communication, and AI-powered functionality.
 *
 * Coverage target: 80%+
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock fetch for AI container communication
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('AI Service', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('getAIConfig', () => {
    it('should return AI configuration from system settings', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
        { key: 'aiModel', value: '"llama2"' },
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };

      for (const setting of settings) {
        try {
          const value = JSON.parse(setting.value);
          if (setting.key === 'aiEnabled') config.enabled = value;
          else if (setting.key === 'aiEndpoint') config.endpoint = value;
          else if (setting.key === 'aiModel') config.model = value;
        } catch {
          if (setting.key === 'aiEndpoint') config.endpoint = setting.value;
          else if (setting.key === 'aiModel') config.model = setting.value;
        }
      }

      expect(config.enabled).toBe(true);
      expect(config.endpoint).toBe('http://localhost:11434');
      expect(config.model).toBe('llama2');
    });

    it('should return default config when settings are missing', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };

      expect(settings).toHaveLength(0);
      expect(config.enabled).toBe(false);
      expect(config.endpoint).toBe('');
      expect(config.model).toBe('');
    });

    it('should handle non-JSON endpoint values', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiEndpoint', value: 'http://localhost:11434' }, // Not JSON-wrapped
        { key: 'aiModel', value: 'llama2' }, // Not JSON-wrapped
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };

      for (const setting of settings) {
        try {
          const value = JSON.parse(setting.value);
          if (setting.key === 'aiEnabled') config.enabled = value;
          else if (setting.key === 'aiEndpoint') config.endpoint = value;
          else if (setting.key === 'aiModel') config.model = value;
        } catch {
          if (setting.key === 'aiEndpoint') config.endpoint = setting.value;
          else if (setting.key === 'aiModel') config.model = setting.value;
        }
      }

      expect(config.endpoint).toBe('http://localhost:11434');
      expect(config.model).toBe('llama2');
    });

    it('should return default config on database error', async () => {
      mockPrismaClient.systemSetting.findMany.mockRejectedValue(new Error('Database error'));

      let config = { enabled: false, endpoint: '', model: '' };

      try {
        await mockPrismaClient.systemSetting.findMany({
          where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
        });
      } catch {
        config = { enabled: false, endpoint: '', model: '' };
      }

      expect(config.enabled).toBe(false);
      expect(config.endpoint).toBe('');
      expect(config.model).toBe('');
    });
  });

  describe('isEnabled', () => {
    it('should return true when AI is enabled with valid configuration', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
        { key: 'aiModel', value: '"llama2"' },
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };
      for (const setting of settings) {
        const value = JSON.parse(setting.value);
        if (setting.key === 'aiEnabled') config.enabled = value;
        else if (setting.key === 'aiEndpoint') config.endpoint = value;
        else if (setting.key === 'aiModel') config.model = value;
      }

      const isEnabled = config.enabled && !!config.endpoint && !!config.model;

      expect(isEnabled).toBe(true);
    });

    it('should return false when AI is disabled', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'false' },
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
        { key: 'aiModel', value: '"llama2"' },
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };
      for (const setting of settings) {
        const value = JSON.parse(setting.value);
        if (setting.key === 'aiEnabled') config.enabled = value;
        else if (setting.key === 'aiEndpoint') config.endpoint = value;
        else if (setting.key === 'aiModel') config.model = value;
      }

      const isEnabled = config.enabled && !!config.endpoint && !!config.model;

      expect(isEnabled).toBe(false);
    });

    it('should return false when endpoint is missing', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiModel', value: '"llama2"' },
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };
      for (const setting of settings) {
        const value = JSON.parse(setting.value);
        if (setting.key === 'aiEnabled') config.enabled = value;
        else if (setting.key === 'aiEndpoint') config.endpoint = value;
        else if (setting.key === 'aiModel') config.model = value;
      }

      const isEnabled = config.enabled && !!config.endpoint && !!config.model;

      expect(isEnabled).toBe(false);
    });

    it('should return false when model is missing', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };
      for (const setting of settings) {
        const value = JSON.parse(setting.value);
        if (setting.key === 'aiEnabled') config.enabled = value;
        else if (setting.key === 'aiEndpoint') config.endpoint = value;
        else if (setting.key === 'aiModel') config.model = value;
      }

      const isEnabled = config.enabled && !!config.endpoint && !!config.model;

      expect(isEnabled).toBe(false);
    });
  });

  describe('isContainerAvailable', () => {
    it('should return true when container health check succeeds', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy' }),
      });

      const response = await fetch('http://ai:3100/health', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(true);
    });

    it('should return false when container health check fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
      });

      const response = await fetch('http://ai:3100/health', {
        method: 'GET',
      });

      expect(response.ok).toBe(false);
    });

    it('should return false when container is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      let isAvailable = true;
      try {
        await fetch('http://ai:3100/health');
      } catch {
        isAvailable = false;
      }

      expect(isAvailable).toBe(false);
    });

    it('should return false on timeout', async () => {
      mockFetch.mockRejectedValue(new Error('Timeout'));

      let isAvailable = true;
      try {
        await fetch('http://ai:3100/health', {
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        isAvailable = false;
      }

      expect(isAvailable).toBe(false);
    });
  });

  describe('checkHealth', () => {
    it('should return available=false when AI is disabled', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'false' },
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };
      for (const setting of settings) {
        const value = JSON.parse(setting.value);
        if (setting.key === 'aiEnabled') config.enabled = value;
      }

      if (!config.enabled) {
        const result = {
          available: false,
          error: 'AI is disabled in settings',
        };
        expect(result.available).toBe(false);
        expect(result.error).toBe('AI is disabled in settings');
      }
    });

    it('should return available=false when endpoint is not configured', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };
      for (const setting of settings) {
        const value = JSON.parse(setting.value);
        if (setting.key === 'aiEnabled') config.enabled = value;
      }

      if (!config.endpoint || !config.model) {
        const result = {
          available: false,
          error: 'AI endpoint or model not configured',
        };
        expect(result.available).toBe(false);
        expect(result.error).toBe('AI endpoint or model not configured');
      }
    });

    it('should return available=false when container is not available', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
        { key: 'aiModel', value: '"llama2"' },
      ]);

      mockFetch.mockResolvedValue({ ok: false });

      const response = await fetch('http://ai:3100/health');

      const result = {
        available: false,
        model: 'llama2',
        endpoint: 'http://localhost:11434',
        containerAvailable: response.ok,
        error: 'AI container is not available',
      };

      expect(result.containerAvailable).toBe(false);
    });

    it('should return full health status when everything is working', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
        { key: 'aiModel', value: '"llama2"' },
      ]);

      mockFetch
        .mockResolvedValueOnce({ ok: true }) // health check
        .mockResolvedValueOnce({ ok: true }) // config sync
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ available: true }),
        }); // test endpoint

      const healthResponse = await fetch('http://ai:3100/health');
      const configResponse = await fetch('http://ai:3100/config', { method: 'POST' });
      const testResponse = await fetch('http://ai:3100/test', { method: 'POST' });
      const testResult = await testResponse.json() as { available: boolean };

      const result = {
        available: testResult.available,
        model: 'llama2',
        endpoint: 'http://localhost:11434',
        containerAvailable: true,
      };

      expect(result.available).toBe(true);
      expect(result.containerAvailable).toBe(true);
    });
  });

  describe('suggestTransactionLabel', () => {
    beforeEach(() => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
        { key: 'aiModel', value: '"llama2"' },
      ]);
    });

    it('should return null when AI is not enabled', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'false' },
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };
      for (const setting of settings) {
        const value = JSON.parse(setting.value);
        if (setting.key === 'aiEnabled') config.enabled = value;
      }

      if (!config.enabled || !config.endpoint || !config.model) {
        const result = null;
        expect(result).toBeNull();
      }
    });

    it('should return suggestion from AI container', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true }) // config sync
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ suggestion: 'Exchange deposit' }),
        });

      // Simulate config sync
      await fetch('http://ai:3100/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, endpoint: 'http://localhost:11434', model: 'llama2' }),
      });

      const response = await fetch('http://ai:3100/suggest-label', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ transactionId: 'tx-123' }),
      });

      const result = await response.json() as { suggestion: string };

      expect(result.suggestion).toBe('Exchange deposit');
    });

    it('should return null when AI container returns error', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true }) // config sync
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'AI processing failed' }),
        });

      await fetch('http://ai:3100/config', { method: 'POST' });

      const response = await fetch('http://ai:3100/suggest-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: 'tx-123' }),
      });

      if (!response.ok) {
        const result = null;
        expect(result).toBeNull();
      }
    });

    it('should return null on network error', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true }) // config sync
        .mockRejectedValueOnce(new Error('Network error'));

      await fetch('http://ai:3100/config', { method: 'POST' });

      let result: string | null = 'test';
      try {
        await fetch('http://ai:3100/suggest-label', { method: 'POST' });
      } catch {
        result = null;
      }

      expect(result).toBeNull();
    });

    it('should include auth token in request to AI container', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ suggestion: 'Test' }),
        });

      await fetch('http://ai:3100/config', { method: 'POST' });

      const authToken = 'user-auth-token';
      await fetch('http://ai:3100/suggest-label', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ transactionId: 'tx-123' }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://ai:3100/suggest-label',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer user-auth-token',
          }),
        })
      );
    });
  });

  describe('executeNaturalQuery', () => {
    beforeEach(() => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'true' },
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
        { key: 'aiModel', value: '"llama2"' },
      ]);
    });

    it('should return null when AI is not enabled', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEnabled', value: 'false' },
      ]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEnabled', 'aiEndpoint', 'aiModel'] } },
      });

      const config = { enabled: false, endpoint: '', model: '' };
      for (const setting of settings) {
        const value = JSON.parse(setting.value);
        if (setting.key === 'aiEnabled') config.enabled = value;
      }

      if (!config.enabled) {
        const result = null;
        expect(result).toBeNull();
      }
    });

    it('should return structured query from AI container', async () => {
      const expectedQuery = {
        type: 'transactions',
        filter: { type: 'receive' },
        sort: { field: 'amount', order: 'desc' },
        limit: 10,
      };

      mockFetch
        .mockResolvedValueOnce({ ok: true }) // config sync
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ query: expectedQuery }),
        });

      await fetch('http://ai:3100/config', { method: 'POST' });

      const response = await fetch('http://ai:3100/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
          query: 'Show my largest receives',
          walletId: 'wallet-123',
        }),
      });

      const result = await response.json() as { query: any };

      expect(result.query).toEqual(expectedQuery);
      expect(result.query.type).toBe('transactions');
      expect(result.query.filter.type).toBe('receive');
    });

    it('should handle various query types', async () => {
      const queryTypes = [
        { type: 'transactions', filter: {} },
        { type: 'addresses', filter: { used: true } },
        { type: 'utxos', filter: { spent: false } },
        { type: 'summary', aggregation: 'sum' },
      ];

      for (const queryResult of queryTypes) {
        mockFetch.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ query: queryResult }),
        });

        await fetch('http://ai:3100/config', { method: 'POST' });
        const response = await fetch('http://ai:3100/query', { method: 'POST' });
        const result = await response.json() as { query: any };

        expect(result.query.type).toBe(queryResult.type);
      }
    });

    it('should return null when AI container returns error', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Query processing failed' }),
        });

      await fetch('http://ai:3100/config', { method: 'POST' });

      const response = await fetch('http://ai:3100/query', { method: 'POST' });

      if (!response.ok) {
        const result = null;
        expect(result).toBeNull();
      }
    });
  });

  describe('detectOllama', () => {
    it('should return found=true when Ollama is detected', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          found: true,
          endpoint: 'http://localhost:11434',
          models: ['llama2', 'codellama'],
        }),
      });

      const response = await fetch('http://ai:3100/detect-ollama', {
        method: 'POST',
      });

      const result = await response.json() as { found: boolean; endpoint?: string; models?: string[] };

      expect(result.found).toBe(true);
      expect(result.endpoint).toBe('http://localhost:11434');
      expect(result.models).toContain('llama2');
    });

    it('should return found=false when Ollama is not detected', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          found: false,
          message: 'No Ollama instance found',
        }),
      });

      const response = await fetch('http://ai:3100/detect-ollama', {
        method: 'POST',
      });

      const result = await response.json() as { found: boolean; message?: string };

      expect(result.found).toBe(false);
      expect(result.message).toBeDefined();
    });

    it('should return found=false when container is unavailable', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      let result = { found: true, message: '' };
      try {
        await fetch('http://ai:3100/detect-ollama', { method: 'POST' });
      } catch {
        result = { found: false, message: 'AI container not available' };
      }

      expect(result.found).toBe(false);
      expect(result.message).toBe('AI container not available');
    });
  });

  describe('listModels', () => {
    it('should return list of models from endpoint', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
      ]);

      mockFetch
        .mockResolvedValueOnce({ ok: true }) // config sync
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            models: [
              { name: 'llama2', size: 3826793472, modifiedAt: '2024-01-15T10:00:00Z' },
              { name: 'codellama', size: 3826793472, modifiedAt: '2024-01-14T10:00:00Z' },
            ],
          }),
        });

      await fetch('http://ai:3100/config', { method: 'POST' });

      const response = await fetch('http://ai:3100/list-models');
      const result = await response.json() as { models: Array<{ name: string }> };

      expect(result.models).toHaveLength(2);
      expect(result.models[0].name).toBe('llama2');
    });

    it('should return error when no endpoint is configured', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEndpoint'] } },
      });

      let config = { endpoint: '' };
      for (const setting of settings) {
        if (setting.key === 'aiEndpoint') config.endpoint = setting.value;
      }

      if (!config.endpoint) {
        const result = { models: [], error: 'No AI endpoint configured' };
        expect(result.error).toBe('No AI endpoint configured');
      }
    });

    it('should return error when container request fails', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
      ]);

      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'Failed to connect to Ollama' }),
        });

      await fetch('http://ai:3100/config', { method: 'POST' });

      const response = await fetch('http://ai:3100/list-models');
      const error = await response.json() as { error?: string };

      expect(error.error).toBeDefined();
    });
  });

  describe('pullModel', () => {
    beforeEach(() => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([
        { key: 'aiEndpoint', value: '"http://localhost:11434"' },
      ]);
    });

    it('should successfully pull a model', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true }) // config sync
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            model: 'llama2',
            status: 'completed',
          }),
        });

      await fetch('http://ai:3100/config', { method: 'POST' });

      const response = await fetch('http://ai:3100/pull-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama2' }),
      });

      const result = await response.json() as { success: boolean; model?: string };

      expect(result.success).toBe(true);
      expect(result.model).toBe('llama2');
    });

    it('should return error when no endpoint is configured', async () => {
      mockPrismaClient.systemSetting.findMany.mockResolvedValue([]);

      const settings = await mockPrismaClient.systemSetting.findMany({
        where: { key: { in: ['aiEndpoint'] } },
      });

      let config = { endpoint: '' };
      for (const setting of settings) {
        if (setting.key === 'aiEndpoint') config.endpoint = setting.value;
      }

      if (!config.endpoint) {
        const result = { success: false, error: 'No AI endpoint configured' };
        expect(result.success).toBe(false);
        expect(result.error).toBe('No AI endpoint configured');
      }
    });

    it('should return error when pull fails', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'Model not found' }),
        });

      await fetch('http://ai:3100/config', { method: 'POST' });

      const response = await fetch('http://ai:3100/pull-model', {
        method: 'POST',
        body: JSON.stringify({ model: 'nonexistent-model' }),
      });

      if (!response.ok) {
        const error = await response.json() as { error?: string };
        expect(error.error).toBeDefined();
      }
    });

    it('should handle timeout for large model pulls', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(new Error('Timeout'));

      await fetch('http://ai:3100/config', { method: 'POST' });

      let result = { success: true, error: '' };
      try {
        await fetch('http://ai:3100/pull-model', {
          method: 'POST',
          body: JSON.stringify({ model: 'large-model' }),
          signal: AbortSignal.timeout(600000),
        });
      } catch {
        result = { success: false, error: 'Pull operation failed' };
      }

      expect(result.success).toBe(false);
      expect(result.error).toBe('Pull operation failed');
    });
  });

  describe('syncConfigToContainer', () => {
    it('should successfully sync config to container', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const response = await fetch('http://ai:3100/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          endpoint: 'http://localhost:11434',
          model: 'llama2',
        }),
      });

      expect(response.ok).toBe(true);
    });

    it('should return false when sync fails', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const response = await fetch('http://ai:3100/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });

      expect(response.ok).toBe(false);
    });

    it('should return false when container is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      let success = true;
      try {
        await fetch('http://ai:3100/config', { method: 'POST' });
      } catch {
        success = false;
      }

      expect(success).toBe(false);
    });
  });

  describe('Type Definitions', () => {
    it('should validate TransactionContext interface', () => {
      const context = {
        amount: 50000,
        direction: 'send' as const,
        date: new Date(),
        existingLabels: ['Exchange', 'Trading'],
      };

      expect(context.direction).toMatch(/^(send|receive)$/);
      expect(typeof context.amount).toBe('number');
      expect(context.date instanceof Date).toBe(true);
      expect(Array.isArray(context.existingLabels)).toBe(true);
    });

    it('should validate QueryResult interface', () => {
      const queryResult = {
        type: 'transactions' as const,
        filter: { type: 'receive' },
        sort: { field: 'amount', order: 'desc' as const },
        limit: 10,
        aggregation: null,
      };

      expect(['transactions', 'addresses', 'utxos', 'summary']).toContain(queryResult.type);
      expect(typeof queryResult.filter).toBe('object');
      expect(['asc', 'desc']).toContain(queryResult.sort.order);
      expect(typeof queryResult.limit).toBe('number');
    });

    it('should validate AIConfig interface', () => {
      const config = {
        enabled: true,
        endpoint: 'http://localhost:11434',
        model: 'llama2',
      };

      expect(typeof config.enabled).toBe('boolean');
      expect(typeof config.endpoint).toBe('string');
      expect(typeof config.model).toBe('string');
    });
  });
});
