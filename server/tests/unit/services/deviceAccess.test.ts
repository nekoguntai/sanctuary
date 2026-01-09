import { vi } from 'vitest';
/**
 * Device Access Service Tests
 *
 * Tests for device access control and sharing functions.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import {
  checkDeviceAccess,
  checkDeviceOwnerAccess,
  getUserDeviceRole,
  getDeviceShareInfo,
  shareDeviceWithUser,
  removeUserFromDevice,
  shareDeviceWithGroup,
} from '../../../src/services/deviceAccess';

describe('Device Access Service', () => {
  const deviceId = 'device-123';
  const userId = 'user-123';
  const targetUserId = 'user-456';
  const groupId = 'group-123';

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('checkDeviceAccess', () => {
    it('should return true when user is owner via DeviceUser', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      const result = await checkDeviceAccess(deviceId, userId);

      expect(result).toBe(true);
      expect(mockPrismaClient.deviceUser.findFirst).toHaveBeenCalledWith({
        where: { deviceId, userId },
      });
    });

    it('should return true when user is viewer via DeviceUser', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'viewer',
      });

      const result = await checkDeviceAccess(deviceId, userId);

      expect(result).toBe(true);
    });

    it('should return true when user has access via group', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue({
        id: deviceId,
        groupId,
        group: {
          members: [{ userId }],
        },
      });

      const result = await checkDeviceAccess(deviceId, userId);

      expect(result).toBe(true);
    });

    it('should return false when user has no access', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue(null);

      const result = await checkDeviceAccess(deviceId, userId);

      expect(result).toBe(false);
    });
  });

  describe('checkDeviceOwnerAccess', () => {
    it('should return true when user is owner', async () => {
      // checkDeviceOwnerAccess calls getUserDeviceRole which checks the role
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      const result = await checkDeviceOwnerAccess(deviceId, userId);

      expect(result).toBe(true);
      // It queries without role filter, then checks role === 'owner' in code
      expect(mockPrismaClient.deviceUser.findFirst).toHaveBeenCalledWith({
        where: { deviceId, userId },
      });
    });

    it('should return false when user is viewer', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'viewer', // Not owner
      });

      const result = await checkDeviceOwnerAccess(deviceId, userId);

      expect(result).toBe(false);
    });

    it('should return false when user has no access', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);

      const result = await checkDeviceOwnerAccess(deviceId, userId);

      expect(result).toBe(false);
    });
  });

  describe('getUserDeviceRole', () => {
    it('should return owner when user is owner', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBe('owner');
    });

    it('should return viewer when user is viewer via DeviceUser', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'viewer',
      });

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBe('viewer');
    });

    it('should return viewer when user has group access', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue({
        id: deviceId,
        groupId,
        groupRole: 'viewer',
        group: {
          members: [{ userId }],
        },
      });

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBe('viewer');
    });

    it('should return null when user has no access', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue(null);

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBeNull();
    });
  });

  describe('getDeviceShareInfo', () => {
    it('should return share info with group and users', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: deviceId,
        groupId,
        group: { id: groupId, name: 'Test Group' },
        users: [
          { userId, role: 'owner', user: { id: userId, username: 'owner' } },
          { userId: targetUserId, role: 'viewer', user: { id: targetUserId, username: 'viewer' } },
        ],
      });

      const result = await getDeviceShareInfo(deviceId);

      expect(result.group).toEqual({ id: groupId, name: 'Test Group' });
      expect(result.users).toHaveLength(2);
    });

    it('should return null group when device is not shared with group', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: deviceId,
        groupId: null,
        group: null,
        users: [
          { userId, role: 'owner', user: { id: userId, username: 'owner' } },
        ],
      });

      const result = await getDeviceShareInfo(deviceId);

      expect(result.group).toBeNull();
      expect(result.users).toHaveLength(1);
    });
  });

  describe('shareDeviceWithUser', () => {
    it('should share device when owner makes the request', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst
        .mockResolvedValueOnce({ id: 'du-1', deviceId, userId, role: 'owner' }) // checkDeviceOwnerAccess
        .mockResolvedValueOnce(null); // Check if already shared

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: targetUserId,
        username: 'target',
      });

      mockPrismaClient.deviceUser.create.mockResolvedValue({
        id: 'du-new',
        deviceId,
        userId: targetUserId,
        role: 'viewer',
      });

      const result = await shareDeviceWithUser(deviceId, targetUserId, userId);

      expect(result.success).toBe(true);
      expect(mockPrismaClient.deviceUser.create).toHaveBeenCalled();
    });

    it('should reject share when non-owner makes the request', async () => {
      // Mock owner check fails
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);

      const result = await shareDeviceWithUser(deviceId, targetUserId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('owner');
    });

    it('should return success when device already shared', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst
        .mockResolvedValueOnce({ id: 'du-1', deviceId, userId, role: 'owner' }) // checkDeviceOwnerAccess
        .mockResolvedValueOnce({ id: 'du-existing', deviceId, userId: targetUserId, role: 'viewer' }); // Already shared

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: targetUserId,
        username: 'target',
      });

      const result = await shareDeviceWithUser(deviceId, targetUserId, userId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('already shared');
    });
  });

  describe('removeUserFromDevice', () => {
    it('should remove user access when owner makes the request', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst
        .mockResolvedValueOnce({ id: 'du-1', deviceId, userId, role: 'owner' }) // checkDeviceOwnerAccess
        .mockResolvedValueOnce({ id: 'du-target', deviceId, userId: targetUserId, role: 'viewer' }); // Find access record

      mockPrismaClient.deviceUser.delete.mockResolvedValue({});

      const result = await removeUserFromDevice(deviceId, targetUserId, userId);

      expect(result.success).toBe(true);
      expect(mockPrismaClient.deviceUser.delete).toHaveBeenCalled();
    });

    it('should reject remove when non-owner makes the request', async () => {
      // Mock owner check fails
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);

      const result = await removeUserFromDevice(deviceId, targetUserId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('owner');
    });

    it('should not allow removing owner', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst
        .mockResolvedValueOnce({ id: 'du-1', deviceId, userId, role: 'owner' }) // checkDeviceOwnerAccess
        .mockResolvedValueOnce({ id: 'du-owner', deviceId, userId: targetUserId, role: 'owner' }); // Target is owner

      const result = await removeUserFromDevice(deviceId, targetUserId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot remove device owner');
    });
  });

  describe('shareDeviceWithGroup', () => {
    it('should share device with group when owner makes the request', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      mockPrismaClient.group.findUnique.mockResolvedValue({
        id: groupId,
        name: 'Test Group',
      });

      mockPrismaClient.device.update.mockResolvedValue({
        id: deviceId,
        groupId,
        groupRole: 'viewer',
      });

      const result = await shareDeviceWithGroup(deviceId, groupId, userId);

      expect(result.success).toBe(true);
      expect(result.groupName).toBe('Test Group');
      expect(mockPrismaClient.device.update).toHaveBeenCalled();
    });

    it('should reject share when non-owner makes the request', async () => {
      // Mock owner check fails
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);

      const result = await shareDeviceWithGroup(deviceId, groupId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('owner');
    });

    it('should remove group when groupId is null', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      mockPrismaClient.device.update.mockResolvedValue({
        id: deviceId,
        groupId: null,
        groupRole: 'viewer',
      });

      const result = await shareDeviceWithGroup(deviceId, null, userId);

      expect(result.success).toBe(true);
      expect(result.groupName).toBeNull();
    });
  });
});
