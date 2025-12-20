/**
 * Wallet Service
 *
 * Business logic for wallet management operations
 */

import prisma from '../models/prisma';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import * as bip32 from 'bip32';
import * as descriptorBuilder from './bitcoin/descriptorBuilder';
import * as addressDerivation from './bitcoin/addressDerivation';
import { createLogger } from '../utils/logger';
import { INITIAL_ADDRESS_COUNT } from '../constants';

const log = createLogger('WALLET');

// Roles that can edit wallet data (labels, etc.)
const EDIT_ROLES = ['owner', 'signer'];

/**
 * Result of checking wallet access with edit permission
 */
export interface WalletAccessCheckResult {
  hasAccess: boolean;
  canEdit: boolean;
  role: WalletRole;
}

// ========================================
// WALLET ACCESS HELPERS
// ========================================

export type WalletRole = 'owner' | 'signer' | 'viewer' | null;

/**
 * Get user's role for a specific wallet
 * Returns the highest privilege role if user has multiple access paths
 */
export async function getUserWalletRole(walletId: string, userId: string): Promise<WalletRole> {
  // Check direct user access first
  const walletUser = await prisma.walletUser.findFirst({
    where: { walletId, userId },
  });

  if (walletUser) {
    return walletUser.role as WalletRole;
  }

  // Check group access
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      group: { members: { some: { userId } } },
    },
    select: { groupRole: true },
  });

  if (wallet) {
    return wallet.groupRole as WalletRole;
  }

  return null;
}

/**
 * Check if user has any access to wallet (for read operations)
 */
export async function checkWalletAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role !== null;
}

/**
 * Check if user has edit access to wallet (owner or signer roles)
 * Use this for operations that modify labels, memos, etc.
 */
export async function checkWalletEditAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role !== null && EDIT_ROLES.includes(role);
}

/**
 * Check if user is wallet owner
 * Use this for operations like sharing, deleting wallet
 */
export async function checkWalletOwnerAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role === 'owner';
}

/**
 * Check wallet access and edit permission in a single query
 * Use this to avoid N+1 queries when checking both access and edit permission
 *
 * Returns: { hasAccess, canEdit, role }
 * - hasAccess: true if user can view the wallet
 * - canEdit: true if user can modify the wallet (owner or signer)
 * - role: the user's role ('owner' | 'signer' | 'viewer' | null)
 */
export async function checkWalletAccessWithRole(walletId: string, userId: string): Promise<WalletAccessCheckResult> {
  const role = await getUserWalletRole(walletId, userId);
  return {
    hasAccess: role !== null,
    canEdit: role !== null && EDIT_ROLES.includes(role),
    role,
  };
}

interface CreateWalletInput {
  name: string;
  type: 'single_sig' | 'multi_sig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  network?: 'mainnet' | 'testnet' | 'regtest';
  quorum?: number;
  totalSigners?: number;
  descriptor?: string;
  fingerprint?: string;
  groupId?: string;
  deviceIds?: string[]; // New: array of device IDs to include
}

interface WalletWithBalance {
  id: string;
  name: string;
  type: string;
  scriptType: string;
  network: string;
  quorum?: number | null;
  totalSigners?: number | null;
  descriptor?: string | null;
  fingerprint?: string | null;
  createdAt: Date;
  balance: number;
  deviceCount: number;
  addressCount: number;
  // Sync metadata
  lastSyncedAt?: Date | null;
  lastSyncStatus?: string | null;
  syncInProgress?: boolean;
  // Sharing info
  isShared: boolean;
  sharedWith?: {
    groupName?: string | null;
    userCount: number;
  };
  // User's role for this wallet (owner, signer, viewer)
  userRole?: WalletRole;
  // Whether user can edit (owner or signer)
  canEdit?: boolean;
}

/**
 * Create a new wallet
 */
export async function createWallet(
  userId: string,
  input: CreateWalletInput
): Promise<WalletWithBalance> {
  // Validate multi-sig parameters
  if (input.type === 'multi_sig') {
    if (!input.quorum || !input.totalSigners) {
      throw new Error('Quorum and totalSigners required for multi-sig wallets');
    }
    if (input.quorum > input.totalSigners) {
      throw new Error('Quorum cannot exceed total signers');
    }
  }

  let descriptor = input.descriptor;
  let fingerprint = input.fingerprint;

  // If device IDs provided, fetch devices and generate descriptor
  if (input.deviceIds && input.deviceIds.length > 0) {
    // Fetch devices belonging to the user
    const devices = await prisma.device.findMany({
      where: {
        id: { in: input.deviceIds },
        userId,
      },
    });

    if (devices.length !== input.deviceIds.length) {
      throw new Error('One or more devices not found or not owned by user');
    }

    // Validate device count for wallet type
    if (input.type === 'single_sig' && devices.length !== 1) {
      throw new Error('Single-sig wallet requires exactly 1 device');
    }
    if (input.type === 'multi_sig' && devices.length < 2) {
      throw new Error('Multi-sig wallet requires at least 2 devices');
    }

    // Build descriptor from devices
    const deviceInfos = devices.map(d => ({
      fingerprint: d.fingerprint,
      xpub: d.xpub,
      derivationPath: d.derivationPath || undefined,
    }));

    const descriptorResult = descriptorBuilder.buildDescriptorFromDevices(
      deviceInfos,
      {
        type: input.type,
        scriptType: input.scriptType,
        network: input.network || 'mainnet',
        quorum: input.quorum,
      }
    );

    descriptor = descriptorResult.descriptor;
    fingerprint = descriptorResult.fingerprint;
  }

  // Create wallet in database with transaction to ensure device linking
  const wallet = await prisma.$transaction(async (tx) => {
    // Create the wallet
    const newWallet = await tx.wallet.create({
      data: {
        name: input.name,
        type: input.type,
        scriptType: input.scriptType,
        network: input.network || 'mainnet',
        quorum: input.quorum,
        totalSigners: input.totalSigners,
        descriptor,
        fingerprint,
        groupId: input.groupId,
        users: {
          create: {
            userId,
            role: 'owner',
          },
        },
      },
    });

    // Link devices to wallet if provided
    if (input.deviceIds && input.deviceIds.length > 0) {
      await tx.walletDevice.createMany({
        data: input.deviceIds.map((deviceId, index) => ({
          walletId: newWallet.id,
          deviceId,
          signerIndex: index,
        })),
      });
    }

    // Fetch complete wallet with relations
    return tx.wallet.findUnique({
      where: { id: newWallet.id },
      include: {
        devices: true,
        addresses: true,
      },
    });
  });

  if (!wallet) {
    throw new Error('Failed to create wallet');
  }

  // Generate initial addresses if wallet has a descriptor
  if (descriptor) {
    try {
      const addressesToCreate = [];
      const network = (input.network || 'mainnet') as 'mainnet' | 'testnet' | 'regtest';

      // Generate receive addresses (change = false)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          descriptor,
          i,
          { network, change: false }
        );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      // Generate change addresses (change = true)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          descriptor,
          i,
          { network, change: true }
        );
        addressesToCreate.push({
          walletId: wallet.id,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      // Bulk insert addresses
      await prisma.address.createMany({
        data: addressesToCreate,
      });
    } catch (err) {
      log.error('Failed to generate initial addresses', { error: err });
      // Don't fail wallet creation if address generation fails
    }
  }

  // Re-fetch wallet with addresses
  const walletWithAddresses = await prisma.wallet.findUnique({
    where: { id: wallet.id },
    include: {
      devices: true,
      addresses: true,
    },
  });

  return {
    ...wallet,
    balance: 0,
    deviceCount: wallet.devices.length,
    addressCount: walletWithAddresses?.addresses.length || 0,
    isShared: false,
  };
}

/**
 * Get all wallets for a user
 * OPTIMIZED: Uses aggregate queries for balance instead of loading all UTXOs
 */
export async function getUserWallets(userId: string): Promise<WalletWithBalance[]> {
  // First, get wallet IDs and basic info
  const wallets = await prisma.wallet.findMany({
    where: {
      OR: [
        { users: { some: { userId } } },
        { group: { members: { some: { userId } } } },
      ],
    },
    include: {
      devices: { select: { id: true } },
      addresses: { select: { id: true } },
      // Include sharing info
      group: {
        select: { name: true },
      },
      users: {
        select: { userId: true, role: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (wallets.length === 0) {
    return [];
  }

  // Fetch balances using aggregate query (single query for all wallets)
  const walletIds = wallets.map(w => w.id);
  const balances = await prisma.uTXO.groupBy({
    by: ['walletId'],
    where: {
      walletId: { in: walletIds },
      spent: false,
    },
    _sum: { amount: true },
  });

  // Create balance lookup map
  const balanceMap = new Map(
    balances.map(b => [b.walletId, Number(b._sum.amount || 0)])
  );

  return wallets.map((wallet) => {
    // Get balance from aggregate query
    const balance = balanceMap.get(wallet.id) || 0;

    // Determine if wallet is shared (has group or multiple users)
    const userCount = wallet.users.length;
    const hasGroup = !!wallet.group;
    const isShared = hasGroup || userCount > 1;

    // Determine user's role for this wallet
    // Check direct user access first, then group access
    const directAccess = wallet.users.find(u => u.userId === userId);
    let userRole: WalletRole = null;
    if (directAccess) {
      userRole = directAccess.role as WalletRole;
    } else if (hasGroup) {
      // User has access via group, use the wallet's groupRole
      userRole = (wallet as any).groupRole as WalletRole || 'viewer';
    }

    const canEdit = userRole === 'owner' || userRole === 'signer';

    return {
      id: wallet.id,
      name: wallet.name,
      type: wallet.type,
      scriptType: wallet.scriptType,
      network: wallet.network,
      quorum: wallet.quorum,
      totalSigners: wallet.totalSigners,
      descriptor: wallet.descriptor,
      fingerprint: wallet.fingerprint,
      createdAt: wallet.createdAt,
      balance,
      deviceCount: wallet.devices.length,
      addressCount: wallet.addresses.length,
      // Sync metadata
      lastSyncedAt: wallet.lastSyncedAt,
      lastSyncStatus: wallet.lastSyncStatus,
      syncInProgress: wallet.syncInProgress,
      // Sharing info
      isShared,
      sharedWith: isShared ? {
        groupName: wallet.group?.name || null,
        userCount,
      } : undefined,
      // User permissions
      userRole,
      canEdit,
    };
  });
}

/**
 * Get a single wallet by ID
 */
export async function getWalletById(
  walletId: string,
  userId: string
): Promise<WalletWithBalance | null> {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      OR: [
        { users: { some: { userId } } },
        { group: { members: { some: { userId } } } },
      ],
    },
    include: {
      users: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      },
      devices: {
        include: {
          device: true,
        },
      },
      addresses: {
        orderBy: { index: 'asc' },
      },
      utxos: {
        where: { spent: false },
      },
      group: {
        include: {
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!wallet) return null;

  const balance = wallet.utxos.reduce(
    (sum, utxo) => sum + Number(utxo.amount),
    0
  );

  // Determine if wallet is shared
  const userCount = wallet.users.length;
  const hasGroup = !!wallet.group;
  const isShared = hasGroup || userCount > 1;

  // Determine user's role for this wallet
  const directAccess = wallet.users.find(wu => wu.userId === userId);
  let userRole: WalletRole = null;

  if (directAccess) {
    // Direct wallet access takes precedence
    userRole = directAccess.role as WalletRole;
  } else if (wallet.group) {
    // Group-based access uses the wallet's groupRole
    userRole = wallet.groupRole as WalletRole;
  }

  const canEdit = userRole !== null && EDIT_ROLES.includes(userRole);

  return {
    id: wallet.id,
    name: wallet.name,
    type: wallet.type,
    scriptType: wallet.scriptType,
    network: wallet.network,
    quorum: wallet.quorum,
    totalSigners: wallet.totalSigners,
    descriptor: wallet.descriptor,
    fingerprint: wallet.fingerprint,
    createdAt: wallet.createdAt,
    balance,
    deviceCount: wallet.devices.length,
    addressCount: wallet.addresses.length,
    // Sync metadata
    lastSyncedAt: wallet.lastSyncedAt,
    lastSyncStatus: wallet.lastSyncStatus,
    syncInProgress: wallet.syncInProgress,
    // Sharing info
    isShared,
    sharedWith: isShared ? {
      groupName: wallet.group?.name || null,
      userCount,
    } : undefined,
    // User permissions
    userRole,
    canEdit,
  };
}

/**
 * Update wallet
 */
export async function updateWallet(
  walletId: string,
  userId: string,
  updates: Partial<{ name: string; descriptor: string }>
): Promise<WalletWithBalance> {
  // Check user has owner role
  const walletUser = await prisma.walletUser.findFirst({
    where: {
      walletId,
      userId,
      role: 'owner',
    },
  });

  if (!walletUser) {
    throw new Error('Only wallet owners can update wallet');
  }

  const wallet = await prisma.wallet.update({
    where: { id: walletId },
    data: updates,
    include: {
      devices: true,
      addresses: true,
      utxos: {
        where: { spent: false },
      },
      group: {
        select: { name: true },
      },
      users: {
        select: { userId: true },
      },
    },
  });

  const balance = wallet.utxos.reduce(
    (sum, utxo) => sum + Number(utxo.amount),
    0
  );

  // Determine if wallet is shared
  const userCount = wallet.users.length;
  const hasGroup = !!wallet.group;
  const isShared = hasGroup || userCount > 1;

  return {
    ...wallet,
    balance,
    deviceCount: wallet.devices.length,
    addressCount: wallet.addresses.length,
    isShared,
    sharedWith: isShared ? {
      groupName: wallet.group?.name || null,
      userCount,
    } : undefined,
  };
}

/**
 * Delete wallet
 */
export async function deleteWallet(walletId: string, userId: string): Promise<void> {
  // Check user has owner role
  const walletUser = await prisma.walletUser.findFirst({
    where: {
      walletId,
      userId,
      role: 'owner',
    },
  });

  if (!walletUser) {
    throw new Error('Only wallet owners can delete wallet');
  }

  // Unsubscribe from address notifications to prevent memory leak
  const { getSyncService } = await import('./syncService');
  const syncService = getSyncService();
  await syncService.unsubscribeWalletAddresses(walletId);

  // Also clean up notification service subscriptions
  const { notificationService } = await import('../websocket/notifications');
  await notificationService.unsubscribeWalletAddresses(walletId);

  await prisma.wallet.delete({
    where: { id: walletId },
  });
}

/**
 * Add device to wallet
 */
export async function addDeviceToWallet(
  walletId: string,
  deviceId: string,
  userId: string,
  signerIndex?: number
): Promise<void> {
  // Check user has access to wallet
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: { some: { userId } },
    },
  });

  if (!wallet) {
    throw new Error('Wallet not found or access denied');
  }

  // Check device belongs to user
  const device = await prisma.device.findFirst({
    where: {
      id: deviceId,
      userId,
    },
  });

  if (!device) {
    throw new Error('Device not found');
  }

  // Add device to wallet
  await prisma.walletDevice.create({
    data: {
      walletId,
      deviceId,
      signerIndex,
    },
  });
}

/**
 * Generate new receiving address for wallet
 */
export async function generateAddress(
  walletId: string,
  userId: string
): Promise<string> {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: { some: { userId } },
    },
    include: {
      addresses: {
        orderBy: { index: 'desc' },
        take: 1,
      },
    },
  });

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  // Get next index
  const nextIndex = wallet.addresses.length > 0 ? wallet.addresses[0].index + 1 : 0;

  // Check if wallet has descriptor or xpub
  if (!wallet.descriptor) {
    throw new Error(
      'Wallet does not have a descriptor. Cannot derive addresses. ' +
      'Please import wallet with xpub or descriptor.'
    );
  }

  // Derive address from descriptor
  const addressDerivation = await import('./bitcoin/addressDerivation');
  const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
    wallet.descriptor,
    nextIndex,
    {
      network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
      change: false, // External/receive address
    }
  );

  // Save to database
  await prisma.address.create({
    data: {
      walletId,
      address,
      derivationPath,
      index: nextIndex,
      used: false,
    },
  });

  return address;
}

/**
 * Get wallet statistics
 */
export async function getWalletStats(walletId: string, userId: string) {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      OR: [
        { users: { some: { userId } } },
        { group: { members: { some: { userId } } } },
      ],
    },
    include: {
      transactions: true,
      utxos: { where: { spent: false } },
      addresses: true,
    },
  });

  if (!wallet) {
    throw new Error('Wallet not found');
  }

  const balance = wallet.utxos.reduce(
    (sum, utxo) => sum + Number(utxo.amount),
    0
  );

  const received = wallet.transactions
    .filter((tx) => tx.type === 'received')
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const sent = wallet.transactions
    .filter((tx) => tx.type === 'sent')
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  return {
    balance,
    received,
    sent,
    transactionCount: wallet.transactions.length,
    utxoCount: wallet.utxos.length,
    addressCount: wallet.addresses.length,
  };
}
