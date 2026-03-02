/**
 * Legacy placeholder.
 *
 * The old Redis circuit-breaker module was consolidated into
 * `src/services/circuitBreaker.ts`, covered by
 * `tests/unit/services/circuitBreaker.test.ts`.
 */

import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('Legacy infrastructure redisCircuitBreaker coverage mapping', () => {
  it('is covered by services/circuitBreaker tests', () => {
    const replacement = new URL('../services/circuitBreaker.test.ts', import.meta.url);
    expect(existsSync(replacement)).toBe(true);
  });
});
