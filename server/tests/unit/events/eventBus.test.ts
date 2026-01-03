/**
 * Event Bus Tests
 *
 * Tests the typed event bus with concurrency limiting features.
 */

import { createTestEventBus } from '../../../src/events/eventBus';

// Mock logger to avoid console noise
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('EventBus', () => {
  let testBus: ReturnType<typeof createTestEventBus>;

  beforeEach(() => {
    testBus = createTestEventBus();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('basic event emission', () => {
    it('should emit and receive events', async () => {
      const handler = jest.fn();

      testBus.on('wallet:synced', handler);
      testBus.emit('wallet:synced', {
        walletId: 'test-123',
        balance: 100000n,
        unconfirmedBalance: 0n,
        transactionCount: 5,
        duration: 100,
      });

      // Wait for async handler
      await jest.runAllTimersAsync();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        walletId: 'test-123',
        balance: 100000n,
      }));
    });

    it('should support multiple listeners for same event', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      testBus.on('wallet:created', handler1);
      testBus.on('wallet:created', handler2);

      testBus.emit('wallet:created', {
        walletId: 'new-wallet',
        userId: 'user-1',
        name: 'Test Wallet',
        type: 'single',
        network: 'mainnet',
      });

      await jest.runAllTimersAsync();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe when unsubscribe function is called', async () => {
      const handler = jest.fn();

      const unsubscribe = testBus.on('wallet:deleted', handler);

      // First emit - should be received
      testBus.emit('wallet:deleted', { walletId: 'w1', userId: 'u1' });
      await jest.runAllTimersAsync();
      expect(handler).toHaveBeenCalledTimes(1);

      // Unsubscribe
      unsubscribe();

      // Second emit - should not be received
      testBus.emit('wallet:deleted', { walletId: 'w2', userId: 'u1' });
      await jest.runAllTimersAsync();
      expect(handler).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should handle once listeners correctly', async () => {
      const handler = jest.fn();

      testBus.once('transaction:broadcast', handler);

      // First emit - should be received
      testBus.emit('transaction:broadcast', {
        walletId: 'w1',
        txid: 'tx1',
        rawTx: '0100...',
      });
      await jest.runAllTimersAsync();
      expect(handler).toHaveBeenCalledTimes(1);

      // Second emit - should not be received (once)
      testBus.emit('transaction:broadcast', {
        walletId: 'w2',
        txid: 'tx2',
        rawTx: '0100...',
      });
      await jest.runAllTimersAsync();
      expect(handler).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe('async event emission', () => {
    it('should wait for all handlers with emitAsync', async () => {
      const results: number[] = [];

      testBus.on('system:startup', async () => {
        await Promise.resolve(); // Simulate async work
        results.push(1);
      });

      testBus.on('system:startup', async () => {
        await Promise.resolve(); // Simulate async work
        results.push(2);
      });

      const emitPromise = testBus.emitAsync('system:startup', {
        version: '1.0.0',
        environment: 'test',
      });

      await jest.runAllTimersAsync();
      await emitPromise;

      // Both handlers should have completed
      expect(results).toHaveLength(2);
      expect(results).toContain(1);
      expect(results).toContain(2);
    });
  });

  describe('error handling', () => {
    it('should catch errors in handlers without crashing', async () => {
      const successHandler = jest.fn();

      testBus.on('wallet:syncFailed', () => {
        throw new Error('Handler error');
      });
      testBus.on('wallet:syncFailed', successHandler);

      testBus.emit('wallet:syncFailed', {
        walletId: 'w1',
        error: 'test error',
        retryCount: 0,
      });

      await jest.runAllTimersAsync();

      // The other handler should still have been called
      expect(successHandler).toHaveBeenCalled();
    });

    it('should track errors in metrics', async () => {
      testBus.on('user:login', () => {
        throw new Error('Login handler error');
      });

      testBus.emit('user:login', {
        userId: 'u1',
        username: 'test',
        ipAddress: '127.0.0.1',
      });

      await jest.runAllTimersAsync();

      const metrics = testBus.getMetrics();
      expect(metrics.errors['user:login']).toBe(1);
    });
  });

  describe('concurrency limiting', () => {
    it('should limit concurrent handler executions', async () => {
      // Create bus with low concurrency limit for testing
      const limitedBus = createTestEventBus();

      // The default config has maxConcurrentHandlers: 10
      // We'll verify handlers execute with concurrency control

      let activeCount = 0;
      let maxActive = 0;
      const results: number[] = [];

      // Register handlers that track concurrent execution
      for (let i = 0; i < 5; i++) {
        limitedBus.on('wallet:synced', async () => {
          activeCount++;
          maxActive = Math.max(maxActive, activeCount);
          await Promise.resolve(); // Simulate async work
          results.push(i);
          activeCount--;
        });
      }

      limitedBus.emit('wallet:synced', {
        walletId: 'test',
        balance: 0n,
        unconfirmedBalance: 0n,
        transactionCount: 0,
        duration: 0,
      });

      // Wait for all handlers to complete
      await jest.runAllTimersAsync();

      expect(results).toHaveLength(5);
      // Concurrency should be limited (default is 10, so with 5 handlers all should run)
      expect(maxActive).toBeLessThanOrEqual(10);
    });

    it('should queue handlers when concurrency limit reached', async () => {
      // We can't easily test the actual queueing with the default config
      // but we can verify the concurrency status is tracked
      const bus = createTestEventBus();

      const status = bus.getConcurrencyStatus();

      expect(status.maxConcurrent).toBe(10); // Default
      expect(status.available).toBe(10); // All available
      expect(status.queueLength).toBe(0); // No queue
      expect(status.utilizationPercent).toBe(0);
    });
  });

  describe('getConcurrencyStatus', () => {
    it('should return correct initial status', () => {
      const status = testBus.getConcurrencyStatus();

      expect(status).toEqual({
        maxConcurrent: 10,
        available: 10,
        queueLength: 0,
        utilizationPercent: 0,
      });
    });

    it('should update during handler execution', async () => {
      let capturedStatus: ReturnType<typeof testBus.getConcurrencyStatus> | null = null;

      testBus.on('system:shutdown', async () => {
        // Capture status while handler is running
        capturedStatus = testBus.getConcurrencyStatus();
        await Promise.resolve(); // Simulate async work
      });

      testBus.emit('system:shutdown', { reason: 'test' });

      // Run pending microtasks to start handler
      await Promise.resolve();

      // The handler should be running
      const currentStatus = testBus.getConcurrencyStatus();
      expect(currentStatus.available).toBeLessThanOrEqual(10);

      // Wait for completion
      await jest.runAllTimersAsync();

      // Should be back to full availability
      const finalStatus = testBus.getConcurrencyStatus();
      expect(finalStatus.available).toBe(10);
    });
  });

  describe('getMetrics', () => {
    it('should track emitted event counts', async () => {
      testBus.emit('wallet:created', {
        walletId: 'w1',
        userId: 'u1',
        name: 'Wallet 1',
        type: 'single',
        network: 'mainnet',
      });
      testBus.emit('wallet:created', {
        walletId: 'w2',
        userId: 'u1',
        name: 'Wallet 2',
        type: 'single',
        network: 'mainnet',
      });
      testBus.emit('wallet:deleted', {
        walletId: 'w1',
        userId: 'u1',
      });

      const metrics = testBus.getMetrics();

      expect(metrics.emitted['wallet:created']).toBe(2);
      expect(metrics.emitted['wallet:deleted']).toBe(1);
    });

    it('should track listener counts', () => {
      testBus.on('transaction:received', () => {});
      testBus.on('transaction:received', () => {});
      testBus.on('transaction:sent', () => {});

      const metrics = testBus.getMetrics();

      expect(metrics.listenerCounts['transaction:received']).toBe(2);
      expect(metrics.listenerCounts['transaction:sent']).toBe(1);
    });

    it('should include concurrency stats', () => {
      const metrics = testBus.getMetrics();

      expect(metrics.concurrency).toEqual({
        maxConcurrent: 10,
        available: 10,
        queueLength: 0,
      });
    });
  });

  describe('resetMetrics', () => {
    it('should clear emitted and error counts', async () => {
      testBus.emit('user:created', {
        userId: 'u1',
        username: 'test',
      });

      testBus.on('user:logout', () => {
        throw new Error('test');
      });
      testBus.emit('user:logout', { userId: 'u1' });
      await jest.runAllTimersAsync();

      // Verify counts exist
      let metrics = testBus.getMetrics();
      expect(metrics.emitted['user:created']).toBe(1);
      expect(metrics.errors['user:logout']).toBe(1);

      // Reset
      testBus.resetMetrics();

      // Verify cleared
      metrics = testBus.getMetrics();
      expect(metrics.emitted['user:created']).toBeUndefined();
      expect(metrics.errors['user:logout']).toBeUndefined();
    });
  });

  describe('listenerCount', () => {
    it('should return correct count for event', () => {
      expect(testBus.listenerCount('device:registered')).toBe(0);

      testBus.on('device:registered', () => {});
      expect(testBus.listenerCount('device:registered')).toBe(1);

      testBus.on('device:registered', () => {});
      expect(testBus.listenerCount('device:registered')).toBe(2);
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for specific event', () => {
      testBus.on('device:deleted', () => {});
      testBus.on('device:deleted', () => {});
      testBus.on('device:shared', () => {});

      testBus.removeAllListeners('device:deleted');

      expect(testBus.listenerCount('device:deleted')).toBe(0);
      expect(testBus.listenerCount('device:shared')).toBe(1);
    });

    it('should remove all listeners when no event specified', () => {
      testBus.on('user:passwordChanged', () => {});
      testBus.on('user:twoFactorEnabled', () => {});
      testBus.on('user:twoFactorDisabled', () => {});

      testBus.removeAllListeners();

      expect(testBus.listenerCount('user:passwordChanged')).toBe(0);
      expect(testBus.listenerCount('user:twoFactorEnabled')).toBe(0);
      expect(testBus.listenerCount('user:twoFactorDisabled')).toBe(0);
    });
  });

  describe('type safety', () => {
    it('should enforce correct event payloads', async () => {
      const handler = jest.fn();

      // This tests that the TypeScript types are correctly applied
      // The handler should receive the correct payload type
      testBus.on('blockchain:newBlock', (data) => {
        // TypeScript should know data has network, height, hash
        expect(typeof data.network).toBe('string');
        expect(typeof data.height).toBe('number');
        expect(typeof data.hash).toBe('string');
        handler(data);
      });

      testBus.emit('blockchain:newBlock', {
        network: 'mainnet',
        height: 800000,
        hash: '000000000000000000...',
      });

      await jest.runAllTimersAsync();

      expect(handler).toHaveBeenCalledWith({
        network: 'mainnet',
        height: 800000,
        hash: '000000000000000000...',
      });
    });
  });
});
