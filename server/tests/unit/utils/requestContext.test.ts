/**
 * Tests for requestContext utility
 */

// Unmock to test the real implementation (setup.ts mocks this globally)
jest.unmock('../../../src/utils/requestContext');

import { requestContext } from '../../../src/utils/requestContext';

describe('requestContext', () => {
  describe('run', () => {
    it('should execute function within context', () => {
      const context = {
        requestId: 'test-123',
        startTime: Date.now(),
      };

      const result = requestContext.run(context, () => {
        return requestContext.getRequestId();
      });

      expect(result).toBe('test-123');
    });

    it('should return undefined outside context', () => {
      expect(requestContext.get()).toBeUndefined();
    });
  });

  describe('getRequestId', () => {
    it('should return requestId when in context', () => {
      const context = {
        requestId: 'req-456',
        startTime: Date.now(),
      };

      requestContext.run(context, () => {
        expect(requestContext.getRequestId()).toBe('req-456');
      });
    });

    it('should return "no-request" when not in context', () => {
      expect(requestContext.getRequestId()).toBe('no-request');
    });
  });

  describe('traceId methods', () => {
    it('should return undefined for traceId when not set', () => {
      const context = {
        requestId: 'test-123',
        startTime: Date.now(),
      };

      requestContext.run(context, () => {
        expect(requestContext.getTraceId()).toBeUndefined();
      });
    });

    it('should set and get traceId', () => {
      const context = {
        requestId: 'test-123',
        startTime: Date.now(),
      };

      requestContext.run(context, () => {
        requestContext.setTraceId('abc123def456');
        expect(requestContext.getTraceId()).toBe('abc123def456');
      });
    });

    it('should return undefined when setting traceId outside context', () => {
      // Should not throw, just silently do nothing
      expect(() => requestContext.setTraceId('test')).not.toThrow();
      expect(requestContext.getTraceId()).toBeUndefined();
    });
  });

  describe('user methods', () => {
    it('should set and get userId', () => {
      const context = {
        requestId: 'test-123',
        startTime: Date.now(),
      };

      requestContext.run(context, () => {
        expect(requestContext.getUserId()).toBeUndefined();
        requestContext.setUser('user-456', 'testuser');
        expect(requestContext.getUserId()).toBe('user-456');
      });
    });
  });

  describe('getDuration', () => {
    it('should calculate duration', async () => {
      const context = {
        requestId: 'test-123',
        startTime: Date.now(),
      };

      await requestContext.run(context, async () => {
        // Wait a small amount
        await new Promise(resolve => setTimeout(resolve, 10));
        const duration = requestContext.getDuration();
        expect(duration).toBeGreaterThanOrEqual(10);
      });
    });

    it('should return 0 when not in context', () => {
      expect(requestContext.getDuration()).toBe(0);
    });
  });
});
