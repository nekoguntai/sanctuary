/**
 * Mock Logger for Gateway Tests
 */

import { vi } from 'vitest';

export const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

export const createLogger = vi.fn(() => mockLogger);

// Mock the requestLogger security event functions
export const logSecurityEvent = vi.fn();
export const logAuditEvent = vi.fn();
