/**
 * Docker Container Management Tests
 *
 * Tests for Docker container management functions for Ollama and Tor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock fetch
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import {
  getOllamaStatus,
  createOllamaContainer,
  startOllama,
  stopOllama,
  isDockerProxyAvailable,
  getTorStatus,
  createTorContainer,
  startTor,
  stopTor,
} from '../../../src/utils/docker';

describe('Docker Container Management', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.DOCKER_PROXY_URL = 'http://docker-proxy:2375';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isDockerProxyAvailable', () => {
    it('should return true when Docker proxy responds', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const available = await isDockerProxyAvailable();

      expect(available).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/containers/json?limit=1'),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return false when Docker proxy is unavailable', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const available = await isDockerProxyAvailable();

      expect(available).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const available = await isDockerProxyAvailable();

      expect(available).toBe(false);
    });
  });

  describe('getOllamaStatus', () => {
    it('should return running status when ollama container is running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
            Status: 'Up 5 minutes',
          },
        ],
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(true);
      expect(status.running).toBe(true);
      expect(status.status).toBe('running');
      expect(status.containerId).toBe('abc123');
    });

    it('should return stopped status when ollama container exists but stopped', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'def456',
            Names: ['/myproject-ollama-1'],
            State: 'exited',
            Status: 'Exited (0) 10 minutes ago',
          },
        ],
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(true);
      expect(status.running).toBe(false);
      expect(status.status).toBe('exited');
    });

    it('should return not_created when ollama container does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'other123',
            Names: ['/sanctuary-backend-1'],
            State: 'running',
          },
        ],
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(false);
      expect(status.running).toBe(false);
      expect(status.status).toBe('not_created');
    });

    it('should handle empty container list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(false);
      expect(status.status).toBe('not_created');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const status = await getOllamaStatus();

      expect(status.exists).toBe(false);
      expect(status.status).toBe('not_created');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const status = await getOllamaStatus();

      // findOllamaContainer catches its own errors and returns null
      // getOllamaStatus then returns 'not_created' for null container
      expect(status.exists).toBe(false);
      expect(status.status).toBe('not_created');
    });
  });

  describe('startOllama', () => {
    it('should return success when already running', async () => {
      // Mock getOllamaStatus -> running
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
          },
        ],
      });

      const result = await startOllama();

      expect(result.success).toBe(true);
      expect(result.message).toContain('already running');
    });

    it('should start stopped container', async () => {
      // Mock getOllamaStatus -> stopped
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      // Mock start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await startOllama();

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should create container if does not exist', async () => {
      // Mock getOllamaStatus -> not exists
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // createOllamaContainer will be called next
      // Mock its status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Mock pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'Pulling...',
      });

      // Mock list containers for project name
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Mock create container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'newcontainer123' }),
      });

      // Mock start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await startOllama();

      expect(result.success).toBe(true);
    });

    it('should handle start failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        status: 500,
        text: async () => 'Container start failed',
      });

      const result = await startOllama();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed');
    });
  });

  describe('stopOllama', () => {
    it('should stop running container', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
          },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await stopOllama();

      expect(result.success).toBe(true);
      expect(result.message).toContain('stopped successfully');
    });

    it('should return success if already stopped', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      const result = await stopOllama();

      expect(result.success).toBe(true);
      expect(result.message).toContain('already stopped');
    });

    it('should return success if container does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await stopOllama();

      expect(result.success).toBe(true);
      expect(result.message).toContain('does not exist');
    });

    it('should handle stop failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
          },
        ],
      });

      mockFetch.mockResolvedValueOnce({
        status: 500,
        text: async () => 'Cannot stop container',
      });

      const result = await stopOllama();

      expect(result.success).toBe(false);
    });
  });

  describe('createOllamaContainer', () => {
    it('should return success if already running', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'running',
          },
        ],
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(true);
      expect(result.message).toContain('already running');
    });

    it('should start existing stopped container', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      // startOllama will be called
      // getOllamaStatus again
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'abc123',
            Names: ['/sanctuary-ollama-1'],
            State: 'exited',
          },
        ],
      });

      // Start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(true);
    });

    it('should handle image pull failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Cannot pull image',
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain('pull');
    });

    it('should use project name from existing containers', async () => {
      // Status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      // Pull image
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => 'Done',
      });

      // List containers - includes existing sanctuary containers
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            Id: 'backend123',
            Names: ['/myapp-backend-1'],
            State: 'running',
          },
        ],
      });

      // Create container
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: 'newollama123' }),
      });

      // Start container
      mockFetch.mockResolvedValueOnce({
        status: 204,
      });

      const result = await createOllamaContainer();

      expect(result.success).toBe(true);
      // Verify create was called with project name
      const createCall = mockFetch.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('containers/create')
      );
      expect(createCall[0]).toContain('myapp-ollama-1');
    });
  });

  describe('Tor Container Management', () => {
    describe('getTorStatus', () => {
      it('should return running status for tor container', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor-1'],
              State: 'running',
            },
          ],
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(true);
        expect(status.running).toBe(true);
      });

      it('should match tor container without number suffix', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor456',
              Names: ['/sanctuary-tor'],
              State: 'running',
            },
          ],
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(true);
      });

      it('should return not_created when tor container missing', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        });

        const status = await getTorStatus();

        expect(status.exists).toBe(false);
        expect(status.status).toBe('not_created');
      });
    });

    describe('startTor', () => {
      it('should return success when already running', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'running',
            },
          ],
        });

        const result = await startTor();

        expect(result.success).toBe(true);
        expect(result.message).toContain('already running');
      });

      it('should start stopped container', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'exited',
            },
          ],
        });

        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await startTor();

        expect(result.success).toBe(true);
      });
    });

    describe('stopTor', () => {
      it('should stop running container', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'running',
            },
          ],
        });

        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await stopTor();

        expect(result.success).toBe(true);
      });

      it('should return success if already stopped', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'exited',
            },
          ],
        });

        const result = await stopTor();

        expect(result.success).toBe(true);
        expect(result.message).toContain('already stopped');
      });
    });

    describe('createTorContainer', () => {
      it('should return success if already running', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              Id: 'tor123',
              Names: ['/sanctuary-tor'],
              State: 'running',
            },
          ],
        });

        const result = await createTorContainer();

        expect(result.success).toBe(true);
        expect(result.message).toContain('already running');
      });

      it('should create new container', async () => {
        // Status check
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        });

        // Pull image
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: async () => 'Done',
        });

        // List containers
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        });

        // Create container
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ Id: 'newtor123' }),
        });

        // Start container
        mockFetch.mockResolvedValueOnce({
          status: 204,
        });

        const result = await createTorContainer();

        expect(result.success).toBe(true);
        expect(result.message).toContain('created and started');
      });
    });
  });

  describe('error handling', () => {
    it('should handle network errors in createOllamaContainer', async () => {
      // First call (getOllamaStatus -> findOllamaContainer) - returns not_created (error caught internally)
      mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));
      // Second call (pull image) - this one throws and is caught by outer try-catch
      mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

      const result = await createOllamaContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Network unreachable');
    });

    it('should handle network errors in stopOllama', async () => {
      // When findOllamaContainer catches network error, it returns null
      // getOllamaStatus returns { exists: false }, so stopOllama returns success
      // because "container doesn't exist" is considered successful for stop
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await stopOllama();

      // This is actually success: true because the code treats "can't find container" as "doesn't exist"
      expect(result.success).toBe(true);
      expect(result.message).toContain('does not exist');
    });

    it('should handle network errors in startTor', async () => {
      // When findTorContainer catches network error, it returns null
      // getTorStatus returns { exists: false }, so startTor calls createTorContainer
      // First call (getTorStatus -> findTorContainer) - error caught internally
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));
      // Second call in createTorContainer (getTorStatus again) - error caught internally
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));
      // Third call (pull image) - this one throws and is caught by outer try-catch
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));

      const result = await startTor();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Timeout');
    });

    it('should handle network errors in createTorContainer', async () => {
      // First call (getTorStatus -> findTorContainer) - error caught internally
      mockFetch.mockRejectedValueOnce(new Error('DNS lookup failed'));
      // Second call (pull image) - this one throws and is caught by outer try-catch
      mockFetch.mockRejectedValueOnce(new Error('DNS lookup failed'));

      const result = await createTorContainer();

      expect(result.success).toBe(false);
      expect(result.message).toContain('DNS lookup failed');
    });
  });
});
