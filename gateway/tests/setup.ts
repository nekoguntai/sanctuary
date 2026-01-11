/**
 * Gateway Test Setup
 *
 * Configures the test environment for gateway tests.
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-chars-long';
process.env.GATEWAY_SECRET = 'test-gateway-secret-minimum-32-chars';
process.env.BACKEND_URL = 'http://localhost:3000';
process.env.BACKEND_WS_URL = 'ws://localhost:3000';
process.env.GATEWAY_PORT = '4000';

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
