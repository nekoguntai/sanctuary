/**
 * Devices - CRUD Router
 *
 * Core device lifecycle operations (list, create, get, update, delete)
 */

import { Router, Request, Response } from 'express';
import { requireDeviceAccess } from '../../middleware/deviceAccess';
import prisma from '../../models/prisma';
import { getUserAccessibleDevices } from '../../services/deviceAccess';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('DEVICES:CRUD');

/**
 * Account type for multi-account device registration
 */
export interface DeviceAccountInput {
  purpose: 'single_sig' | 'multisig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  derivationPath: string;
  xpub: string;
}

/**
 * Compare incoming accounts with existing accounts
 * Returns categorized accounts: new, matching, and conflicting
 */
function compareAccounts(
  existingAccounts: Array<{ derivationPath: string; xpub: string; purpose: string; scriptType: string }>,
  incomingAccounts: DeviceAccountInput[]
): {
  newAccounts: DeviceAccountInput[];
  matchingAccounts: DeviceAccountInput[];
  conflictingAccounts: Array<{ incoming: DeviceAccountInput; existing: { derivationPath: string; xpub: string } }>;
} {
  const newAccounts: DeviceAccountInput[] = [];
  const matchingAccounts: DeviceAccountInput[] = [];
  const conflictingAccounts: Array<{ incoming: DeviceAccountInput; existing: { derivationPath: string; xpub: string } }> = [];

  for (const incoming of incomingAccounts) {
    const existing = existingAccounts.find(e => e.derivationPath === incoming.derivationPath);
    if (!existing) {
      // New account - path doesn't exist
      newAccounts.push(incoming);
    } else if (existing.xpub === incoming.xpub) {
      // Matching account - same path and xpub
      matchingAccounts.push(incoming);
    } else {
      // Conflicting account - same path but different xpub
      conflictingAccounts.push({
        incoming,
        existing: { derivationPath: existing.derivationPath, xpub: existing.xpub },
      });
    }
  }

  return { newAccounts, matchingAccounts, conflictingAccounts };
}

/**
 * GET /api/v1/devices
 * Get all devices accessible by authenticated user (owned + shared)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get all devices user has access to (owned + shared via user + shared via group)
    const devices = await getUserAccessibleDevices(userId);

    res.json(devices);
  } catch (error) {
    log.error('Get devices error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch devices',
    });
  }
});

/**
 * POST /api/v1/devices
 * Register a new hardware device
 *
 * Supports multiple modes:
 * 1. Legacy mode: single derivationPath + xpub (backward compatible)
 * 2. Multi-account mode: accounts[] array with multiple xpubs for different wallet types
 * 3. Merge mode: merge=true to add accounts to existing device (same fingerprint)
 *
 * When a device with the same fingerprint exists:
 * - Without merge flag: Returns 409 with existing device info and account comparison
 * - With merge=true: Adds new accounts to the existing device
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { type, label, fingerprint: rawFingerprint, derivationPath, xpub, modelSlug, accounts, merge } = req.body;

    // Validation - require fingerprint and label always
    if (!type || !label || !rawFingerprint) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'type, label, and fingerprint are required',
      });
    }

    // Normalize fingerprint to lowercase for consistent storage and comparison
    // This prevents duplicate devices due to case differences (e.g., 'ABC12345' vs 'abc12345')
    const fingerprint = rawFingerprint.toLowerCase();

    // Must have either xpub (legacy) or accounts (multi-account)
    if (!xpub && (!accounts || accounts.length === 0)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Either xpub or accounts array is required',
      });
    }

    // Normalize incoming accounts
    let incomingAccounts: DeviceAccountInput[] = [];
    if (accounts && accounts.length > 0) {
      for (const account of accounts as DeviceAccountInput[]) {
        if (!account.purpose || !account.scriptType || !account.derivationPath || !account.xpub) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Each account must have purpose, scriptType, derivationPath, and xpub',
          });
        }
        if (!['single_sig', 'multisig'].includes(account.purpose)) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Account purpose must be "single_sig" or "multisig"',
          });
        }
        if (!['native_segwit', 'nested_segwit', 'taproot', 'legacy'].includes(account.scriptType)) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Account scriptType must be one of: native_segwit, nested_segwit, taproot, legacy',
          });
        }
        incomingAccounts.push(account);
      }
    } else if (xpub && derivationPath) {
      // Convert legacy single account to accounts array format
      const purpose = derivationPath.startsWith("m/48'") ? 'multisig' : 'single_sig';
      let scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy' = 'native_segwit';
      if (derivationPath.startsWith("m/86'")) scriptType = 'taproot';
      else if (derivationPath.startsWith("m/49'")) scriptType = 'nested_segwit';
      else if (derivationPath.startsWith("m/44'")) scriptType = 'legacy';

      incomingAccounts = [{ purpose, scriptType, derivationPath, xpub }];
    }

    // Check if device already exists
    const existingDevice = await prisma.device.findUnique({
      where: { fingerprint },
      include: {
        accounts: true,
        model: true,
      },
    });

    if (existingDevice) {
      // Compare accounts
      const comparison = compareAccounts(existingDevice.accounts, incomingAccounts);

      // If merge mode is requested
      if (merge === true) {
        // Check for conflicts - cannot merge if there are conflicting xpubs
        if (comparison.conflictingAccounts.length > 0) {
          return res.status(409).json({
            error: 'Conflict',
            message: 'Cannot merge: some accounts have conflicting xpubs for the same derivation path',
            existingDevice: {
              id: existingDevice.id,
              label: existingDevice.label,
              fingerprint: existingDevice.fingerprint,
            },
            conflictingAccounts: comparison.conflictingAccounts,
          });
        }

        // Check if there are any new accounts to add
        if (comparison.newAccounts.length === 0) {
          return res.status(200).json({
            message: 'Device already has all these accounts',
            device: existingDevice,
            added: 0,
          });
        }

        // Add new accounts
        const addedAccounts = await prisma.$transaction(async (tx) => {
          const created = [];
          for (const account of comparison.newAccounts) {
            const newAccount = await tx.deviceAccount.create({
              data: {
                deviceId: existingDevice.id,
                purpose: account.purpose,
                scriptType: account.scriptType,
                derivationPath: account.derivationPath,
                xpub: account.xpub,
              },
            });
            created.push(newAccount);
          }
          return created;
        });

        log.info('Merged accounts into existing device', {
          deviceId: existingDevice.id,
          fingerprint,
          addedCount: addedAccounts.length,
          paths: comparison.newAccounts.map(a => a.derivationPath),
        });

        // Return updated device
        const updatedDevice = await prisma.device.findUnique({
          where: { id: existingDevice.id },
          include: { model: true, accounts: true },
        });

        return res.status(200).json({
          message: `Added ${addedAccounts.length} new account(s) to existing device`,
          device: updatedDevice,
          added: addedAccounts.length,
        });
      }

      // Not merge mode - return conflict with comparison info
      return res.status(409).json({
        error: 'Conflict',
        message: 'Device with this fingerprint already exists',
        existingDevice: {
          id: existingDevice.id,
          label: existingDevice.label,
          fingerprint: existingDevice.fingerprint,
          type: existingDevice.type,
          model: existingDevice.model,
          accounts: existingDevice.accounts,
        },
        comparison: {
          newAccounts: comparison.newAccounts,
          matchingAccounts: comparison.matchingAccounts,
          conflictingAccounts: comparison.conflictingAccounts,
        },
      });
    }

    // Find the model ID if a slug was provided
    let modelId: string | undefined;
    if (modelSlug) {
      const model = await prisma.hardwareDeviceModel.findUnique({
        where: { slug: modelSlug },
      });
      if (model) {
        modelId = model.id;
      }
    }

    // Determine primary xpub (for legacy field) - prefer single_sig native_segwit
    const primaryAccount = incomingAccounts.find(
      a => a.purpose === 'single_sig' && a.scriptType === 'native_segwit'
    ) || incomingAccounts[0];
    const primaryXpub = primaryAccount?.xpub;
    const primaryPath = primaryAccount?.derivationPath;

    // Create device, owner record, and accounts in a transaction
    const device = await prisma.$transaction(async (tx) => {
      const newDevice = await tx.device.create({
        data: {
          userId,
          type,
          label,
          fingerprint,
          derivationPath: primaryPath,
          xpub: primaryXpub,
          modelId,
        },
        include: {
          model: true,
        },
      });

      // Create owner record in DeviceUser
      await tx.deviceUser.create({
        data: {
          deviceId: newDevice.id,
          userId,
          role: 'owner',
        },
      });

      // Create DeviceAccount records
      for (const account of incomingAccounts) {
        await tx.deviceAccount.create({
          data: {
            deviceId: newDevice.id,
            purpose: account.purpose,
            scriptType: account.scriptType,
            derivationPath: account.derivationPath,
            xpub: account.xpub,
          },
        });
      }

      log.info('Device registered', {
        deviceId: newDevice.id,
        fingerprint,
        accountCount: incomingAccounts.length,
        purposes: incomingAccounts.map(a => a.purpose),
      });

      return newDevice;
    });

    // Fetch the complete device with accounts for response
    const deviceWithAccounts = await prisma.device.findUnique({
      where: { id: device.id },
      include: {
        model: true,
        accounts: true,
      },
    });

    res.status(201).json(deviceWithAccounts);
  } catch (error) {
    log.error('Create device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register device',
    });
  }
});

/**
 * GET /api/v1/devices/:id
 * Get a specific device by ID (requires view access)
 */
router.get('/:id', requireDeviceAccess('view'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deviceRole = req.deviceRole;

    const device = await prisma.device.findUnique({
      where: { id },
      include: {
        model: true,
        accounts: true, // Include all device accounts
        wallets: {
          include: {
            wallet: {
              select: {
                id: true,
                name: true,
                type: true,
                scriptType: true,
              },
            },
          },
        },
        user: {
          select: { username: true },
        },
      },
    });

    if (!device) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Device not found',
      });
    }

    // Add access info to response
    const isOwner = deviceRole === 'owner';
    res.json({
      ...device,
      isOwner,
      userRole: deviceRole,
      sharedBy: isOwner ? undefined : device.user.username,
    });
  } catch (error) {
    log.error('Get device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch device',
    });
  }
});

/**
 * PATCH /api/v1/devices/:id
 * Update a device (label, derivationPath, type, or model) - owner only
 */
router.patch('/:id', requireDeviceAccess('owner'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { label, derivationPath, type, modelSlug } = req.body;

    // Build update data
    const updateData: any = {};
    if (label !== undefined) updateData.label = label;
    if (derivationPath !== undefined) updateData.derivationPath = derivationPath;
    if (type !== undefined) updateData.type = type;

    // If modelSlug provided, look up the model ID
    if (modelSlug) {
      const model = await prisma.hardwareDeviceModel.findUnique({
        where: { slug: modelSlug },
      });
      if (model) {
        updateData.modelId = model.id;
        // Also update the type to match the model's type
        updateData.type = model.slug;
      } else {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid device model slug',
        });
      }
    }

    const updatedDevice = await prisma.device.update({
      where: { id },
      data: updateData,
      include: {
        model: true,
      },
    });

    log.info('Device updated', { deviceId: id, userId, updates: Object.keys(updateData) });

    res.json(updatedDevice);
  } catch (error) {
    log.error('Update device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update device',
    });
  }
});

/**
 * DELETE /api/v1/devices/:id
 * Remove a device (owner only, and only if not in use by any wallet)
 */
router.delete('/:id', requireDeviceAccess('owner'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const device = await prisma.device.findUnique({
      where: { id },
      include: {
        wallets: {
          include: {
            wallet: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!device) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Device not found',
      });
    }

    // Check if device is in use by any wallet
    if (device.wallets && device.wallets.length > 0) {
      const walletNames = device.wallets.map(w => w.wallet.name).join(', ');
      return res.status(409).json({
        error: 'Conflict',
        message: `Cannot delete device. It is in use by wallet(s): ${walletNames}`,
        wallets: device.wallets.map(w => ({
          id: w.wallet.id,
          name: w.wallet.name,
        })),
      });
    }

    await prisma.device.delete({
      where: { id },
    });

    log.info('Device deleted', { deviceId: id, userId });

    res.status(204).send();
  } catch (error) {
    log.error('Delete device error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete device',
    });
  }
});

export default router;
