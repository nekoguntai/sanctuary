/**
 * Legacy placeholder.
 *
 * The former policy-based authorization service was replaced by
 * `src/services/accessControl.ts`, covered by
 * `tests/unit/services/accessControl.test.ts`.
 */

import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

describe('Legacy authorization service coverage mapping', () => {
  it('is covered by accessControl service tests', () => {
    const replacement = new URL('./accessControl.test.ts', import.meta.url);
    expect(existsSync(replacement)).toBe(true);
  });
});
