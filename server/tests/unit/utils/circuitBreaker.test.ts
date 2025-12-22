/**
 * Circuit Breaker Tests
 *
 * Tests the circuit breaker pattern implementation for handling
 * cascading failures in external service calls.
 */

import {
  CircuitBreaker,
  CircuitState,
  CircuitBreakerError,
  circuitBreakerRegistry,
  createCircuitBreaker,
} from '../../../src/utils/circuitBreaker';

describe('CircuitBreaker', () => {
  let circuit: CircuitBreaker;

  beforeEach(() => {
    // Reset registry between tests
    circuitBreakerRegistry.resetAll();

    circuit = new CircuitBreaker({
      name: 'test-circuit',
      failureThreshold: 3,
      resetTimeout: 1000, // 1 second for faster tests
      successThreshold: 2,
      requestTimeout: 500,
    });
  });

  describe('CLOSED state', () => {
    it('should start in CLOSED state', () => {
      expect(circuit.getState()).toBe(CircuitState.CLOSED);
    });

    it('should allow successful calls through', async () => {
      const result = await circuit.execute(async () => 'success');
      expect(result).toBe('success');
      expect(circuit.getState()).toBe(CircuitState.CLOSED);
    });

    it('should count failures but stay CLOSED below threshold', async () => {
      // Fail twice (threshold is 3)
      for (let i = 0; i < 2; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      expect(circuit.getState()).toBe(CircuitState.CLOSED);
    });

    it('should transition to OPEN after reaching failure threshold', async () => {
      // Fail 3 times (threshold is 3)
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      expect(circuit.getState()).toBe(CircuitState.OPEN);
    });

    it('should reset failure count on success', async () => {
      // Fail twice
      for (let i = 0; i < 2; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      // Succeed once - should reset counter
      await circuit.execute(async () => 'success');

      // Fail twice more - should still be CLOSED
      for (let i = 0; i < 2; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      expect(circuit.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('OPEN state', () => {
    beforeEach(async () => {
      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }
      expect(circuit.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject calls immediately when OPEN', async () => {
      await expect(
        circuit.execute(async () => 'should not run')
      ).rejects.toThrow(CircuitBreakerError);

      await expect(
        circuit.execute(async () => 'should not run')
      ).rejects.toThrow('Circuit breaker test-circuit is OPEN');
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Next call should be allowed (circuit transitions to HALF_OPEN)
      const result = await circuit.execute(async () => 'success');
      expect(result).toBe('success');
      expect(circuit.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('should report as unavailable when OPEN', () => {
      expect(circuit.isAvailable()).toBe(false);
    });

    it('should report as available after reset timeout', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(circuit.isAvailable()).toBe(true);
    });
  });

  describe('HALF_OPEN state', () => {
    beforeEach(async () => {
      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Trigger transition to HALF_OPEN
      await circuit.execute(async () => 'success');
      expect(circuit.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('should transition to CLOSED after success threshold', async () => {
      // Already had 1 success, need 1 more (threshold is 2)
      await circuit.execute(async () => 'success');
      expect(circuit.getState()).toBe(CircuitState.CLOSED);
    });

    it('should transition back to OPEN on any failure', async () => {
      await expect(
        circuit.execute(async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow('fail');

      expect(circuit.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('timeout handling', () => {
    it('should timeout slow operations', async () => {
      await expect(
        circuit.execute(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 'slow';
        })
      ).rejects.toThrow('Request timeout after 500ms');
    });

    it('should count timeout as failure', async () => {
      // Cause 3 timeouts
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          })
        ).rejects.toThrow('timeout');
      }

      expect(circuit.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('statistics', () => {
    it('should track request statistics', async () => {
      // 2 successes
      await circuit.execute(async () => 'success');
      await circuit.execute(async () => 'success');

      // 1 failure
      await expect(
        circuit.execute(async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow();

      const stats = circuit.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.successes).toBe(2);
      expect(stats.failures).toBe(1);
      expect(stats.totalFailures).toBe(1);
      expect(stats.name).toBe('test-circuit');
      expect(stats.state).toBe(CircuitState.CLOSED);
    });

    it('should track last success/failure times', async () => {
      const beforeSuccess = new Date();
      await circuit.execute(async () => 'success');
      const afterSuccess = new Date();

      const stats = circuit.getStats();
      expect(stats.lastSuccess).not.toBeNull();
      expect(stats.lastSuccess!.getTime()).toBeGreaterThanOrEqual(beforeSuccess.getTime());
      expect(stats.lastSuccess!.getTime()).toBeLessThanOrEqual(afterSuccess.getTime());
    });
  });

  describe('manual reset', () => {
    it('should reset circuit to CLOSED state', async () => {
      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }
      expect(circuit.getState()).toBe(CircuitState.OPEN);

      // Manual reset
      circuit.reset();
      expect(circuit.getState()).toBe(CircuitState.CLOSED);

      // Should allow calls again
      const result = await circuit.execute(async () => 'success');
      expect(result).toBe('success');
    });
  });

  describe('state change callback', () => {
    it('should call onStateChange when state transitions', async () => {
      const stateChanges: Array<{ from: CircuitState; to: CircuitState }> = [];

      const circuitWithCallback = new CircuitBreaker({
        name: 'callback-circuit',
        failureThreshold: 2,
        resetTimeout: 100,
        onStateChange: (_name, from, to) => {
          stateChanges.push({ from, to });
        },
      });

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          circuitWithCallback.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();
      }

      expect(stateChanges).toContainEqual({
        from: CircuitState.CLOSED,
        to: CircuitState.OPEN,
      });
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  // Use unique names per test to avoid conflicts with other tests
  const uniqueName = (base: string) => `${base}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeEach(() => {
    circuitBreakerRegistry.resetAll();
  });

  it('should create and retrieve circuit breakers', () => {
    const name = uniqueName('registry-test');
    const circuit = createCircuitBreaker({ name });
    const retrieved = circuitBreakerRegistry.get(name);

    expect(retrieved).toBe(circuit);
  });

  it('should return same instance for same name', () => {
    const name = uniqueName('same-name');
    const circuit1 = createCircuitBreaker({ name });
    const circuit2 = createCircuitBreaker({ name });

    expect(circuit1).toBe(circuit2);
  });

  it('should return undefined for unknown circuit', () => {
    const circuit = circuitBreakerRegistry.get('unknown-circuit-that-does-not-exist');
    expect(circuit).toBeUndefined();
  });

  it('should get all circuits including newly created ones', () => {
    const name1 = uniqueName('circuit-1');
    const name2 = uniqueName('circuit-2');

    const initialSize = circuitBreakerRegistry.getAll().size;

    createCircuitBreaker({ name: name1 });
    createCircuitBreaker({ name: name2 });

    const all = circuitBreakerRegistry.getAll();
    expect(all.size).toBe(initialSize + 2);
    expect(all.has(name1)).toBe(true);
    expect(all.has(name2)).toBe(true);
  });

  it('should get stats for specific circuits', async () => {
    const name1 = uniqueName('stats-1');
    const name2 = uniqueName('stats-2');

    const circuit1 = createCircuitBreaker({ name: name1 });
    const circuit2 = createCircuitBreaker({ name: name2 });

    await circuit1.execute(async () => 'success');
    await circuit2.execute(async () => 'success');
    await circuit2.execute(async () => 'success');

    const allStats = circuitBreakerRegistry.getAllStats();

    const stats1 = allStats.find((s) => s.name === name1);
    const stats2 = allStats.find((s) => s.name === name2);

    expect(stats1).toBeDefined();
    expect(stats2).toBeDefined();
    expect(stats1?.totalRequests).toBe(1);
    expect(stats2?.totalRequests).toBe(2);
  });

  it('should reset all circuits', async () => {
    const name1 = uniqueName('reset-1');
    const name2 = uniqueName('reset-2');

    const circuit1 = createCircuitBreaker({ name: name1, failureThreshold: 1 });
    const circuit2 = createCircuitBreaker({ name: name2, failureThreshold: 1 });

    // Trip both circuits
    await expect(circuit1.execute(async () => { throw new Error(); })).rejects.toThrow();
    await expect(circuit2.execute(async () => { throw new Error(); })).rejects.toThrow();

    expect(circuit1.getState()).toBe(CircuitState.OPEN);
    expect(circuit2.getState()).toBe(CircuitState.OPEN);

    // Reset all
    circuitBreakerRegistry.resetAll();

    expect(circuit1.getState()).toBe(CircuitState.CLOSED);
    expect(circuit2.getState()).toBe(CircuitState.CLOSED);
  });
});

describe('CircuitBreakerError', () => {
  it('should include circuit name and state', () => {
    const error = new CircuitBreakerError('Test error', 'my-circuit', CircuitState.OPEN);

    expect(error.message).toBe('Test error');
    expect(error.circuitName).toBe('my-circuit');
    expect(error.circuitState).toBe(CircuitState.OPEN);
    expect(error.name).toBe('CircuitBreakerError');
  });
});
