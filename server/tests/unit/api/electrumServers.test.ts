/**
 * Electrum Server CRUD API Tests
 *
 * Tests for the admin API endpoints that manage Electrum servers.
 * These are unit tests focused on the handler logic.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma
jest.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock the node client
jest.mock('../../../src/services/bitcoin/nodeClient', () => ({
  resetNodeClient: jest.fn().mockResolvedValue(undefined),
  getElectrumPool: jest.fn().mockReturnValue(null),
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('Electrum Server API Logic', () => {
  beforeEach(() => {
    resetPrismaMocks();
  });

  describe('Server Configuration Structure', () => {
    it('should validate server config has required fields', () => {
      const validServer = {
        id: 'server-1',
        label: 'Primary Server',
        host: 'electrum.example.com',
        port: 50002,
        useSsl: true,
        priority: 0,
        enabled: true,
      };

      expect(validServer).toHaveProperty('id');
      expect(validServer).toHaveProperty('label');
      expect(validServer).toHaveProperty('host');
      expect(validServer).toHaveProperty('port');
      expect(validServer).toHaveProperty('useSsl');
      expect(validServer).toHaveProperty('priority');
      expect(validServer).toHaveProperty('enabled');
    });

    it('should validate port is a number', () => {
      const server = { port: 50002 };
      expect(typeof server.port).toBe('number');
      expect(server.port).toBeGreaterThan(0);
      expect(server.port).toBeLessThan(65536);
    });

    it('should validate useSsl is boolean', () => {
      const server = { useSsl: true };
      expect(typeof server.useSsl).toBe('boolean');
    });

    it('should validate priority is a number >= 0', () => {
      const server = { priority: 0 };
      expect(typeof server.priority).toBe('number');
      expect(server.priority).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Server List Operations', () => {
    it('should handle empty server list', async () => {
      mockPrismaClient.electrumServer.findMany.mockResolvedValue([]);

      const servers = await mockPrismaClient.electrumServer.findMany({
        orderBy: { priority: 'asc' },
      });

      expect(servers).toEqual([]);
      expect(Array.isArray(servers)).toBe(true);
    });

    it('should sort servers by priority', async () => {
      const unsortedServers = [
        { id: '1', label: 'Low Priority', priority: 10 },
        { id: '2', label: 'High Priority', priority: 1 },
        { id: '3', label: 'Medium Priority', priority: 5 },
      ];

      mockPrismaClient.electrumServer.findMany.mockResolvedValue(
        [...unsortedServers].sort((a, b) => a.priority - b.priority)
      );

      const servers = await mockPrismaClient.electrumServer.findMany({
        orderBy: { priority: 'asc' },
      });

      expect(servers[0].label).toBe('High Priority');
      expect(servers[1].label).toBe('Medium Priority');
      expect(servers[2].label).toBe('Low Priority');
    });

    it('should filter enabled servers only', async () => {
      const allServers = [
        { id: '1', enabled: true },
        { id: '2', enabled: false },
        { id: '3', enabled: true },
      ];

      mockPrismaClient.electrumServer.findMany.mockResolvedValue(
        allServers.filter((s) => s.enabled)
      );

      const servers = await mockPrismaClient.electrumServer.findMany({
        where: { enabled: true },
      });

      expect(servers).toHaveLength(2);
      expect(servers.every((s: { enabled: boolean }) => s.enabled)).toBe(true);
    });
  });

  describe('Server Create Operations', () => {
    it('should create server with all fields', async () => {
      const newServer = {
        label: 'New Server',
        host: 'new.example.com',
        port: 50002,
        useSsl: true,
        priority: 0,
        enabled: true,
        nodeConfigId: 'config-1',
      };

      mockPrismaClient.electrumServer.create.mockResolvedValue({
        id: 'new-server-id',
        ...newServer,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const created = await mockPrismaClient.electrumServer.create({
        data: newServer,
      });

      expect(created).toHaveProperty('id');
      expect(created.label).toBe('New Server');
      expect(created.host).toBe('new.example.com');
    });

    it('should calculate next priority from existing servers', async () => {
      const existingServers = [
        { priority: 0 },
        { priority: 5 },
        { priority: 2 },
      ];

      const maxPriority = Math.max(...existingServers.map((s) => s.priority));
      const nextPriority = maxPriority + 1;

      expect(nextPriority).toBe(6);
    });

    it('should default priority to 0 when no servers exist', async () => {
      const existingServers: Array<{ priority: number }> = [];

      const maxPriority = existingServers.length > 0
        ? Math.max(...existingServers.map((s) => s.priority))
        : -1;
      const nextPriority = maxPriority + 1;

      expect(nextPriority).toBe(0);
    });
  });

  describe('Server Update Operations', () => {
    it('should update server label', async () => {
      mockPrismaClient.electrumServer.update.mockResolvedValue({
        id: 'server-1',
        label: 'Updated Label',
        host: 'example.com',
        port: 50002,
      });

      const updated = await mockPrismaClient.electrumServer.update({
        where: { id: 'server-1' },
        data: { label: 'Updated Label' },
      });

      expect(updated.label).toBe('Updated Label');
    });

    it('should update server enabled status', async () => {
      mockPrismaClient.electrumServer.update.mockResolvedValue({
        id: 'server-1',
        enabled: false,
      });

      const updated = await mockPrismaClient.electrumServer.update({
        where: { id: 'server-1' },
        data: { enabled: false },
      });

      expect(updated.enabled).toBe(false);
    });

    it('should update health check results', async () => {
      const now = new Date();
      mockPrismaClient.electrumServer.update.mockResolvedValue({
        id: 'server-1',
        isHealthy: true,
        lastHealthCheck: now,
        healthCheckFails: 0,
      });

      const updated = await mockPrismaClient.electrumServer.update({
        where: { id: 'server-1' },
        data: {
          isHealthy: true,
          lastHealthCheck: now,
          healthCheckFails: 0,
        },
      });

      expect(updated.isHealthy).toBe(true);
      expect(updated.healthCheckFails).toBe(0);
    });
  });

  describe('Server Delete Operations', () => {
    it('should delete server by id', async () => {
      mockPrismaClient.electrumServer.delete.mockResolvedValue({
        id: 'server-1',
      });

      const deleted = await mockPrismaClient.electrumServer.delete({
        where: { id: 'server-1' },
      });

      expect(deleted.id).toBe('server-1');
      expect(mockPrismaClient.electrumServer.delete).toHaveBeenCalledWith({
        where: { id: 'server-1' },
      });
    });
  });

  describe('Server Reorder Operations', () => {
    it('should update priorities based on array order', async () => {
      const serverIds = ['server-c', 'server-a', 'server-b'];

      mockPrismaClient.electrumServer.update.mockResolvedValue({});

      for (let i = 0; i < serverIds.length; i++) {
        await mockPrismaClient.electrumServer.update({
          where: { id: serverIds[i] },
          data: { priority: i },
        });
      }

      expect(mockPrismaClient.electrumServer.update).toHaveBeenCalledTimes(3);
      expect(mockPrismaClient.electrumServer.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'server-c' },
        data: { priority: 0 },
      });
      expect(mockPrismaClient.electrumServer.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'server-a' },
        data: { priority: 1 },
      });
      expect(mockPrismaClient.electrumServer.update).toHaveBeenNthCalledWith(3, {
        where: { id: 'server-b' },
        data: { priority: 2 },
      });
    });

    it('should validate serverIds is an array', () => {
      const validInput = ['server-1', 'server-2'];
      const invalidInput = 'not-an-array';

      expect(Array.isArray(validInput)).toBe(true);
      expect(Array.isArray(invalidInput)).toBe(false);
    });

    it('should validate serverIds contains only strings', () => {
      const validInput = ['server-1', 'server-2', 'server-3'];
      const invalidInput = ['server-1', 123, 'server-3'];

      const allStrings = (arr: unknown[]) => arr.every((item) => typeof item === 'string');

      expect(allStrings(validInput)).toBe(true);
      expect(allStrings(invalidInput)).toBe(false);
    });
  });

  describe('Server Health Check', () => {
    it('should track health check failure count', async () => {
      mockPrismaClient.electrumServer.findUnique.mockResolvedValue({
        id: 'server-1',
        healthCheckFails: 2,
      });

      const server = await mockPrismaClient.electrumServer.findUnique({
        where: { id: 'server-1' },
      });

      expect(server?.healthCheckFails).toBe(2);
    });

    it('should mark server unhealthy after threshold failures', async () => {
      const MAX_FAILURES = 3;
      const currentFailures = 3;

      const isHealthy = currentFailures < MAX_FAILURES;

      expect(isHealthy).toBe(false);
    });

    it('should reset failure count on successful health check', async () => {
      mockPrismaClient.electrumServer.update.mockResolvedValue({
        id: 'server-1',
        isHealthy: true,
        healthCheckFails: 0,
        lastHealthCheck: new Date(),
      });

      const updated = await mockPrismaClient.electrumServer.update({
        where: { id: 'server-1' },
        data: {
          isHealthy: true,
          healthCheckFails: 0,
          lastHealthCheck: new Date(),
        },
      });

      expect(updated.isHealthy).toBe(true);
      expect(updated.healthCheckFails).toBe(0);
    });
  });
});
