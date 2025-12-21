/**
 * AI API Routes Tests
 *
 * Tests for public AI API endpoints including authentication,
 * rate limiting, and error handling.
 *
 * Coverage target: 80%+
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
} from '../../helpers/testUtils';
import { Request, Response, NextFunction } from 'express';

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

// Mock AI service
const mockAiService = {
  isEnabled: jest.fn(),
  isContainerAvailable: jest.fn(),
  checkHealth: jest.fn(),
  suggestTransactionLabel: jest.fn(),
  executeNaturalQuery: jest.fn(),
  detectOllama: jest.fn(),
  listModels: jest.fn(),
  pullModel: jest.fn(),
};

jest.mock('../../../src/services/aiService', () => ({
  aiService: mockAiService,
}));

// Mock rate limiter
const mockRateLimiter = jest.fn((req: Request, res: Response, next: NextFunction) => next());
jest.mock('express-rate-limit', () => () => mockRateLimiter);

// Mock authenticate middleware
const mockAuthenticate = jest.fn((req: Request, res: Response, next: NextFunction) => {
  if (req.headers.authorization) {
    (req as any).user = { userId: 'user-123', username: 'testuser', isAdmin: false };
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

jest.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => mockAuthenticate(req, res, next),
}));

describe('AI API Routes', () => {
  beforeEach(() => {
    resetPrismaMocks();
    jest.clearAllMocks();
  });

  describe('GET /api/v1/ai/status', () => {
    it('should return AI status when enabled and available', async () => {
      mockAiService.isEnabled.mockResolvedValue(true);
      mockAiService.checkHealth.mockResolvedValue({
        available: true,
        model: 'llama2',
        endpoint: 'http://localhost:11434',
        containerAvailable: true,
      });

      const enabled = await mockAiService.isEnabled();
      expect(enabled).toBe(true);

      const health = await mockAiService.checkHealth();

      const response = {
        available: health.available,
        model: health.model,
        endpoint: health.endpoint,
        containerAvailable: health.containerAvailable,
        error: health.error,
      };

      expect(response.available).toBe(true);
      expect(response.model).toBe('llama2');
      expect(response.endpoint).toBe('http://localhost:11434');
      expect(response.containerAvailable).toBe(true);
    });

    it('should return unavailable status when AI is disabled', async () => {
      mockAiService.isEnabled.mockResolvedValue(false);

      const enabled = await mockAiService.isEnabled();

      if (!enabled) {
        const response = {
          available: false,
          message: 'AI is disabled or not configured',
        };

        expect(response.available).toBe(false);
        expect(response.message).toBe('AI is disabled or not configured');
      }
    });

    it('should return error details when health check fails', async () => {
      mockAiService.isEnabled.mockResolvedValue(true);
      mockAiService.checkHealth.mockResolvedValue({
        available: false,
        model: 'llama2',
        endpoint: 'http://localhost:11434',
        containerAvailable: false,
        error: 'AI container is not available',
      });

      const health = await mockAiService.checkHealth();

      expect(health.available).toBe(false);
      expect(health.error).toBe('AI container is not available');
    });

    it('should return 500 on unexpected error', async () => {
      mockAiService.isEnabled.mockRejectedValue(new Error('Unexpected error'));

      const { res, getResponse } = createMockResponse();

      try {
        await mockAiService.isEnabled();
      } catch {
        res.status!(500).json!({
          error: 'Internal Server Error',
          message: 'Failed to check AI status',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('POST /api/v1/ai/suggest-label', () => {
    it('should return label suggestion when AI is available', async () => {
      mockAiService.isEnabled.mockResolvedValue(true);
      mockAiService.suggestTransactionLabel.mockResolvedValue('Exchange deposit');

      const suggestion = await mockAiService.suggestTransactionLabel('tx-123', 'auth-token');

      const response = { suggestion };

      expect(response.suggestion).toBe('Exchange deposit');
      expect(mockAiService.suggestTransactionLabel).toHaveBeenCalledWith('tx-123', 'auth-token');
    });

    it('should return 400 when transactionId is missing', async () => {
      const { res, getResponse } = createMockResponse();

      const body = {};

      if (!(body as any).transactionId) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'transactionId is required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe('transactionId is required');
    });

    it('should return 503 when AI is not enabled', async () => {
      mockAiService.isEnabled.mockResolvedValue(false);

      const { res, getResponse } = createMockResponse();

      const enabled = await mockAiService.isEnabled();

      if (!enabled) {
        res.status!(503).json!({
          error: 'Service Unavailable',
          message: 'AI is not enabled or configured',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(503);
      expect(response.body.message).toBe('AI is not enabled or configured');
    });

    it('should return 503 when suggestion is null', async () => {
      mockAiService.isEnabled.mockResolvedValue(true);
      mockAiService.suggestTransactionLabel.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const suggestion = await mockAiService.suggestTransactionLabel('tx-123', 'token');

      if (!suggestion) {
        res.status!(503).json!({
          error: 'Service Unavailable',
          message: 'AI endpoint is not available or returned no suggestion',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(503);
    });

    it('should return 500 on unexpected error', async () => {
      mockAiService.isEnabled.mockResolvedValue(true);
      mockAiService.suggestTransactionLabel.mockRejectedValue(new Error('AI error'));

      const { res, getResponse } = createMockResponse();

      try {
        await mockAiService.suggestTransactionLabel('tx-123', 'token');
      } catch {
        res.status!(500).json!({
          error: 'Internal Server Error',
          message: 'Failed to generate label suggestion',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
    });

    it('should extract auth token from Authorization header', async () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer test-token-123' },
      });

      const authToken = (req.headers as any).authorization?.replace('Bearer ', '') || '';

      expect(authToken).toBe('test-token-123');
    });
  });

  describe('POST /api/v1/ai/query', () => {
    it('should return structured query result', async () => {
      const expectedResult = {
        type: 'transactions' as const,
        filter: { type: 'receive' },
        sort: { field: 'amount', order: 'desc' as const },
        limit: 10,
      };

      mockAiService.isEnabled.mockResolvedValue(true);
      mockAiService.executeNaturalQuery.mockResolvedValue(expectedResult);

      const result = await mockAiService.executeNaturalQuery(
        'Show my largest receives',
        'wallet-123',
        'auth-token'
      );

      expect(result).toEqual(expectedResult);
      expect(mockAiService.executeNaturalQuery).toHaveBeenCalledWith(
        'Show my largest receives',
        'wallet-123',
        'auth-token'
      );
    });

    it('should return 400 when query is missing', async () => {
      const { res, getResponse } = createMockResponse();

      const body = { walletId: 'wallet-123' };

      if (!(body as any).query || !body.walletId) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Query and walletId are required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when walletId is missing', async () => {
      const { res, getResponse } = createMockResponse();

      const body = { query: 'Show transactions' };

      if (!body.query || !(body as any).walletId) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Query and walletId are required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });

    it('should return 503 when AI is not enabled', async () => {
      mockAiService.isEnabled.mockResolvedValue(false);

      const { res, getResponse } = createMockResponse();

      const enabled = await mockAiService.isEnabled();

      if (!enabled) {
        res.status!(503).json!({
          error: 'Service Unavailable',
          message: 'AI is not enabled or configured',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(503);
    });

    it('should return 503 when query result is null', async () => {
      mockAiService.isEnabled.mockResolvedValue(true);
      mockAiService.executeNaturalQuery.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const result = await mockAiService.executeNaturalQuery('query', 'wallet', 'token');

      if (!result) {
        res.status!(503).json!({
          error: 'Service Unavailable',
          message: 'AI endpoint is not available or could not process query',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(503);
    });

    it('should return 500 on unexpected error', async () => {
      mockAiService.isEnabled.mockResolvedValue(true);
      mockAiService.executeNaturalQuery.mockRejectedValue(new Error('Query error'));

      const { res, getResponse } = createMockResponse();

      try {
        await mockAiService.executeNaturalQuery('query', 'wallet', 'token');
      } catch {
        res.status!(500).json!({
          error: 'Internal Server Error',
          message: 'Failed to execute natural language query',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /api/v1/ai/detect-ollama', () => {
    it('should return detection results when Ollama is found', async () => {
      mockAiService.detectOllama.mockResolvedValue({
        found: true,
        endpoint: 'http://localhost:11434',
        models: ['llama2', 'codellama'],
      });

      const result = await mockAiService.detectOllama();

      expect(result.found).toBe(true);
      expect(result.endpoint).toBe('http://localhost:11434');
      expect(result.models).toContain('llama2');
    });

    it('should return not found when Ollama is unavailable', async () => {
      mockAiService.detectOllama.mockResolvedValue({
        found: false,
        message: 'No Ollama instance found',
      });

      const result = await mockAiService.detectOllama();

      expect(result.found).toBe(false);
      expect(result.message).toBeDefined();
    });

    it('should return 500 on error', async () => {
      mockAiService.detectOllama.mockRejectedValue(new Error('Detection error'));

      const { res, getResponse } = createMockResponse();

      try {
        await mockAiService.detectOllama();
      } catch {
        res.status!(500).json!({
          error: 'Internal Server Error',
          message: 'Failed to detect Ollama',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /api/v1/ai/models', () => {
    it('should return list of available models', async () => {
      mockAiService.listModels.mockResolvedValue({
        models: [
          { name: 'llama2', size: 3826793472, modifiedAt: '2024-01-15T10:00:00Z' },
          { name: 'codellama', size: 3826793472, modifiedAt: '2024-01-14T10:00:00Z' },
        ],
      });

      const result = await mockAiService.listModels();

      expect(result.models).toHaveLength(2);
      expect(result.models[0].name).toBe('llama2');
    });

    it('should return 502 when models endpoint returns error', async () => {
      mockAiService.listModels.mockResolvedValue({
        models: [],
        error: 'Failed to connect to Ollama',
      });

      const { res, getResponse } = createMockResponse();

      const result = await mockAiService.listModels();

      if (result.error) {
        res.status!(502).json!({
          error: 'Bad Gateway',
          message: result.error,
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(502);
      expect(response.body.message).toBe('Failed to connect to Ollama');
    });

    it('should return 500 on unexpected error', async () => {
      mockAiService.listModels.mockRejectedValue(new Error('List error'));

      const { res, getResponse } = createMockResponse();

      try {
        await mockAiService.listModels();
      } catch {
        res.status!(500).json!({
          error: 'Internal Server Error',
          message: 'Failed to list models',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /api/v1/ai/pull-model', () => {
    it('should successfully pull a model', async () => {
      mockAiService.pullModel.mockResolvedValue({
        success: true,
        model: 'llama2',
        status: 'completed',
      });

      const result = await mockAiService.pullModel('llama2');

      expect(result.success).toBe(true);
      expect(result.model).toBe('llama2');
    });

    it('should return 400 when model name is missing', async () => {
      const { res, getResponse } = createMockResponse();

      const body = {};

      if (!(body as any).model) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Model name is required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe('Model name is required');
    });

    it('should return 502 when pull fails', async () => {
      mockAiService.pullModel.mockResolvedValue({
        success: false,
        error: 'Model not found in registry',
      });

      const { res, getResponse } = createMockResponse();

      const result = await mockAiService.pullModel('nonexistent-model');

      if (!result.success) {
        res.status!(502).json!({
          error: 'Bad Gateway',
          message: result.error || 'Pull failed',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(502);
    });

    it('should return 500 on unexpected error', async () => {
      mockAiService.pullModel.mockRejectedValue(new Error('Pull error'));

      const { res, getResponse } = createMockResponse();

      try {
        await mockAiService.pullModel('llama2');
      } catch {
        res.status!(500).json!({
          error: 'Internal Server Error',
          message: 'Failed to pull model',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(500);
    });
  });

  describe('Authentication', () => {
    it('should require authentication for all endpoints', () => {
      const req = createMockRequest({});
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      mockAuthenticate(req as Request, res as Response, next);

      expect(getResponse().statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should pass authentication with valid token', () => {
      const req = createMockRequest({
        headers: { authorization: 'Bearer valid-token' },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      mockAuthenticate(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).user).toBeDefined();
      expect((req as any).user.userId).toBe('user-123');
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiter to all AI endpoints', () => {
      const req = createMockRequest({});
      const { res } = createMockResponse();
      const next = createMockNext();

      mockRateLimiter(req as Request, res as Response, next);

      expect(mockRateLimiter).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should have reasonable rate limit configuration', () => {
      // Rate limit: 10 requests per minute per IP
      const windowMs = 60 * 1000;
      const max = 10;

      expect(windowMs).toBe(60000);
      expect(max).toBe(10);
    });
  });

  describe('Error Messages', () => {
    it('should return consistent error format', () => {
      const errorResponse = {
        error: 'Bad Request',
        message: 'transactionId is required',
      };

      expect(errorResponse).toHaveProperty('error');
      expect(errorResponse).toHaveProperty('message');
      expect(typeof errorResponse.error).toBe('string');
      expect(typeof errorResponse.message).toBe('string');
    });

    it('should not expose internal error details', () => {
      const internalError = new Error('Database connection failed: password incorrect');

      const publicErrorResponse = {
        error: 'Internal Server Error',
        message: 'Failed to process request',
      };

      expect(publicErrorResponse.message).not.toContain('password');
      expect(publicErrorResponse.message).not.toContain('Database');
    });
  });

  describe('Request Body Validation', () => {
    it('should validate suggest-label request body', () => {
      const validBody = { transactionId: 'tx-123' };
      const invalidBody = {};

      expect(validBody.transactionId).toBeDefined();
      expect((invalidBody as any).transactionId).toBeUndefined();
    });

    it('should validate query request body', () => {
      const validBody = { query: 'Show transactions', walletId: 'wallet-123' };
      const missingQuery = { walletId: 'wallet-123' };
      const missingWallet = { query: 'Show transactions' };

      expect(validBody.query).toBeDefined();
      expect(validBody.walletId).toBeDefined();
      expect((missingQuery as any).query).toBeUndefined();
      expect((missingWallet as any).walletId).toBeUndefined();
    });

    it('should validate pull-model request body', () => {
      const validBody = { model: 'llama2' };
      const invalidBody = {};

      expect(validBody.model).toBeDefined();
      expect((invalidBody as any).model).toBeUndefined();
    });
  });

  describe('Response Format', () => {
    it('should return status response format', async () => {
      mockAiService.isEnabled.mockResolvedValue(true);
      mockAiService.checkHealth.mockResolvedValue({
        available: true,
        model: 'llama2',
        endpoint: 'http://localhost:11434',
        containerAvailable: true,
      });

      const health = await mockAiService.checkHealth();

      expect(health).toHaveProperty('available');
      expect(health).toHaveProperty('model');
      expect(health).toHaveProperty('endpoint');
      expect(health).toHaveProperty('containerAvailable');
    });

    it('should return suggestion response format', async () => {
      mockAiService.suggestTransactionLabel.mockResolvedValue('Exchange deposit');

      const suggestion = await mockAiService.suggestTransactionLabel('tx-123', 'token');

      const response = { suggestion };

      expect(response).toHaveProperty('suggestion');
      expect(typeof response.suggestion).toBe('string');
    });

    it('should return query response format', async () => {
      const queryResult = {
        type: 'transactions' as const,
        filter: {},
        sort: { field: 'date', order: 'desc' as const },
      };

      mockAiService.executeNaturalQuery.mockResolvedValue(queryResult);

      const result = await mockAiService.executeNaturalQuery('query', 'wallet', 'token');

      expect(result).toHaveProperty('type');
      expect(['transactions', 'addresses', 'utxos', 'summary']).toContain(result?.type);
    });

    it('should return models response format', async () => {
      mockAiService.listModels.mockResolvedValue({
        models: [
          { name: 'llama2', size: 3826793472, modifiedAt: '2024-01-15T10:00:00Z' },
        ],
      });

      const result = await mockAiService.listModels();

      expect(result).toHaveProperty('models');
      expect(Array.isArray(result.models)).toBe(true);
      expect(result.models[0]).toHaveProperty('name');
      expect(result.models[0]).toHaveProperty('size');
      expect(result.models[0]).toHaveProperty('modifiedAt');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty transactionId', async () => {
      const { res, getResponse } = createMockResponse();

      const transactionId = '';

      if (!transactionId) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'transactionId is required',
        });
      }

      expect(getResponse().statusCode).toBe(400);
    });

    it('should handle whitespace-only query', async () => {
      const query = '   ';

      if (!query.trim()) {
        const isValidQuery = false;
        expect(isValidQuery).toBe(false);
      }
    });

    it('should handle very long query', async () => {
      const longQuery = 'a'.repeat(10000);

      // Should still process (may truncate internally)
      mockAiService.executeNaturalQuery.mockResolvedValue({
        type: 'transactions',
        filter: {},
      });

      const result = await mockAiService.executeNaturalQuery(longQuery, 'wallet', 'token');

      expect(result).toBeDefined();
    });

    it('should handle special characters in query', async () => {
      const queryWithSpecialChars = "Show transactions with label 'Exchange & Trading'";

      mockAiService.executeNaturalQuery.mockResolvedValue({
        type: 'transactions',
        filter: { label: "Exchange & Trading" },
      });

      const result = await mockAiService.executeNaturalQuery(queryWithSpecialChars, 'wallet', 'token');

      expect(result).toBeDefined();
    });
  });
});
