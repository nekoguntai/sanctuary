/**
 * Legacy placeholder.
 *
 * The old infrastructure job queue implementation moved to `src/jobs/jobQueue.ts`
 * and is covered by `tests/unit/jobs/jobQueue.test.ts`.
 */

import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('Legacy infrastructure jobQueue coverage mapping', () => {
  it('is covered by jobs/jobQueue tests', () => {
    const replacement = new URL('../jobs/jobQueue.test.ts', import.meta.url);
    expect(existsSync(replacement)).toBe(true);
  });
});
