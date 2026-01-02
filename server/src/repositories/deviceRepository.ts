/**
 * Device Repository
 *
 * Abstracts database operations for devices and device-user associations.
 */

import prisma from '../models/prisma';
import type { Device, DeviceUser, WalletDevice } from '@prisma/client';

/**
 * Device with user associations
 */
export interface DeviceWithUsers extends Device {
  users: DeviceUser[];
}

/**
 * Device with full associations
 */
export interface DeviceWithAssociations extends Device {
  users: DeviceUser[];
  wallets: WalletDevice[];
}

/**
 * Create device input
 */
export interface CreateDeviceInput {
  userId: string;
  label: string;
  type: string;
  fingerprint: string;
  xpub: string;
  derivationPath?: string | null;
  modelId?: string | null;
  groupId?: string | null;
  groupRole?: string;
}

/**
 * Find device by ID
 */
export async function findById(deviceId: string): Promise<Device | null> {
  return prisma.device.findUnique({
    where: { id: deviceId },
  });
}

/**
 * Find device by ID with user associations
 */
export async function findByIdWithUsers(
  deviceId: string
): Promise<DeviceWithUsers | null> {
  return prisma.device.findUnique({
    where: { id: deviceId },
    include: { users: true },
  });
}

/**
 * Find device by ID with full associations
 */
export async function findByIdWithAssociations(
  deviceId: string
): Promise<DeviceWithAssociations | null> {
  return prisma.device.findUnique({
    where: { id: deviceId },
    include: { users: true, wallets: true },
  });
}

/**
 * Find device by fingerprint
 */
export async function findByFingerprint(
  fingerprint: string
): Promise<Device | null> {
  return prisma.device.findUnique({
    where: { fingerprint },
  });
}

/**
 * Find all devices for a user (owner or shared)
 */
export async function findByUserId(userId: string): Promise<Device[]> {
  return prisma.device.findMany({
    where: {
      OR: [
        { userId },
        { users: { some: { userId } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all devices for a user with associations
 */
export async function findByUserIdWithAssociations(
  userId: string
): Promise<DeviceWithAssociations[]> {
  return prisma.device.findMany({
    where: {
      OR: [
        { userId },
        { users: { some: { userId } } },
      ],
    },
    include: { users: true, wallets: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all devices associated with a wallet
 */
export async function findByWalletId(walletId: string): Promise<Device[]> {
  return prisma.device.findMany({
    where: { wallets: { some: { walletId } } },
  });
}

/**
 * Check if user has access to a device (owner or shared)
 */
export async function hasUserAccess(
  deviceId: string,
  userId: string
): Promise<boolean> {
  const device = await prisma.device.findFirst({
    where: {
      id: deviceId,
      OR: [
        { userId },
        { users: { some: { userId } } },
      ],
    },
  });
  return device !== null;
}

/**
 * Check if device is shared (has users in DeviceUser table)
 */
export async function isShared(deviceId: string): Promise<boolean> {
  const count = await prisma.deviceUser.count({
    where: { deviceId },
  });
  return count > 0;
}

/**
 * Create a new device
 */
export async function create(input: CreateDeviceInput): Promise<Device> {
  return prisma.device.create({
    data: {
      userId: input.userId,
      label: input.label,
      type: input.type,
      fingerprint: input.fingerprint,
      xpub: input.xpub,
      derivationPath: input.derivationPath,
      modelId: input.modelId,
      groupId: input.groupId,
      groupRole: input.groupRole || 'viewer',
    },
  });
}

/**
 * Update a device
 */
export async function update(
  deviceId: string,
  data: Partial<Pick<Device, 'label' | 'derivationPath' | 'groupId' | 'groupRole'>>
): Promise<Device> {
  return prisma.device.update({
    where: { id: deviceId },
    data,
  });
}

/**
 * Delete a device
 */
export async function deleteDevice(deviceId: string): Promise<void> {
  await prisma.device.delete({
    where: { id: deviceId },
  });
}

/**
 * Add a user to a device (share access)
 */
export async function addUser(
  deviceId: string,
  userId: string
): Promise<DeviceUser> {
  return prisma.deviceUser.create({
    data: { deviceId, userId },
  });
}

/**
 * Remove a user from a device
 */
export async function removeUser(
  deviceId: string,
  userId: string
): Promise<void> {
  await prisma.deviceUser.deleteMany({
    where: { deviceId, userId },
  });
}

/**
 * Get user count for a device (shared users, not including owner)
 */
export async function getSharedUserCount(deviceId: string): Promise<number> {
  return prisma.deviceUser.count({
    where: { deviceId },
  });
}

// Export as namespace
export const deviceRepository = {
  findById,
  findByIdWithUsers,
  findByIdWithAssociations,
  findByFingerprint,
  findByUserId,
  findByUserIdWithAssociations,
  findByWalletId,
  hasUserAccess,
  isShared,
  create,
  update,
  delete: deleteDevice,
  addUser,
  removeUser,
  getSharedUserCount,
};

export default deviceRepository;
