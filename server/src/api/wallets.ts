/**
 * Wallet API Routes
 *
 * API endpoints for wallet management
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import * as walletService from '../services/wallet';
import * as walletImport from '../services/walletImport';
import prisma from '../models/prisma';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/wallets
 * Get all wallets for authenticated user
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const wallets = await walletService.getUserWallets(userId);

    res.json(wallets);
  } catch (error) {
    console.error('[WALLETS] Get wallets error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallets',
    });
  }
});

/**
 * POST /api/v1/wallets
 * Create a new wallet
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const {
      name,
      type,
      scriptType,
      network,
      quorum,
      totalSigners,
      descriptor,
      fingerprint,
      groupId,
      deviceIds,
    } = req.body;

    // Validation
    if (!name || !type || !scriptType) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name, type, and scriptType are required',
      });
    }

    if (!['single_sig', 'multi_sig'].includes(type)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'type must be single_sig or multi_sig',
      });
    }

    if (!['native_segwit', 'nested_segwit', 'taproot', 'legacy'].includes(scriptType)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid scriptType',
      });
    }

    const wallet = await walletService.createWallet(userId, {
      name,
      type,
      scriptType,
      network,
      quorum,
      totalSigners,
      descriptor,
      fingerprint,
      groupId,
      deviceIds,
    });

    res.status(201).json(wallet);
  } catch (error: any) {
    console.error('[WALLETS] Create wallet error:', error);
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to create wallet',
    });
  }
});

/**
 * GET /api/v1/wallets/:id
 * Get a specific wallet by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const wallet = await walletService.getWalletById(id, userId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    res.json(wallet);
  } catch (error) {
    console.error('[WALLETS] Get wallet error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallet',
    });
  }
});

/**
 * PATCH /api/v1/wallets/:id
 * Update a wallet
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { name, descriptor } = req.body;

    const wallet = await walletService.updateWallet(id, userId, {
      name,
      descriptor,
    });

    res.json(wallet);
  } catch (error: any) {
    console.error('[WALLETS] Update wallet error:', error);

    if (error.message.includes('owner')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update wallet',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:id
 * Delete a wallet
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    await walletService.deleteWallet(id, userId);

    res.status(204).send();
  } catch (error: any) {
    console.error('[WALLETS] Delete wallet error:', error);

    if (error.message.includes('owner')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete wallet',
    });
  }
});

/**
 * GET /api/v1/wallets/:id/stats
 * Get wallet statistics
 */
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const stats = await walletService.getWalletStats(id, userId);

    res.json(stats);
  } catch (error: any) {
    console.error('[WALLETS] Get wallet stats error:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallet stats',
    });
  }
});

/**
 * GET /api/v1/wallets/:id/export
 * Export wallet in Sparrow-compatible JSON format
 */
router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    // Get wallet with all related data
    const wallet = await prisma.wallet.findFirst({
      where: {
        id,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
      include: {
        devices: {
          include: {
            device: true,
          },
          orderBy: { signerIndex: 'asc' },
        },
      },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Map script type to Sparrow format
    const scriptTypeMap: Record<string, string> = {
      'native_segwit': 'P2WPKH',
      'nested_segwit': 'P2SH_P2WPKH',
      'taproot': 'P2TR',
      'legacy': 'P2PKH',
    };

    // For multisig, use P2WSH (native) or P2SH_P2WSH (nested)
    const getScriptType = () => {
      if (wallet.type === 'multi_sig') {
        if (wallet.scriptType === 'native_segwit') return 'P2WSH';
        if (wallet.scriptType === 'nested_segwit') return 'P2SH_P2WSH';
      }
      return scriptTypeMap[wallet.scriptType] || 'P2WPKH';
    };

    // Build keystores array from devices
    const keystores = wallet.devices.map((wd, index) => {
      const device = wd.device;

      // Parse derivation path to extract fingerprint and path
      // Format: m/84'/0'/0' or just the path
      const derivationPath = device.derivationPath || "m/84'/0'/0'";

      return {
        label: device.label || `Keystore ${index + 1}`,
        source: 'HW_USB', // Hardware wallet
        walletModel: mapDeviceTypeToWalletModel(device.type),
        keyDerivation: {
          masterFingerprint: device.fingerprint,
          derivationPath: derivationPath,
        },
        extendedPublicKey: device.xpub,
      };
    });

    // Build policy for multisig
    const getDefaultPolicy = () => {
      if (wallet.type === 'multi_sig' && wallet.quorum && wallet.totalSigners) {
        return {
          name: 'Multi Signature',
          miniscript: `thresh(${wallet.quorum},${keystores.map((_, i) => `pk(${String.fromCharCode(65 + i)})`).join(',')})`,
        };
      }
      return {
        name: 'Single Signature',
        miniscript: 'pk(A)',
      };
    };

    // Build Sparrow-compatible export format
    const exportData = {
      // Core wallet info
      label: wallet.name,
      name: wallet.name,

      // Policy and script type (Sparrow format)
      policyType: wallet.type === 'multi_sig' ? 'MULTI' : 'SINGLE',
      scriptType: getScriptType(),

      // Multisig threshold
      ...(wallet.type === 'multi_sig' && {
        defaultPolicy: getDefaultPolicy(),
      }),

      // Keystores (signing devices)
      keystores,

      // Network
      network: wallet.network?.toUpperCase() || 'MAINNET',

      // Descriptor (for direct import)
      descriptor: wallet.descriptor,

      // Gap limit (standard)
      gapLimit: 20,

      // Export metadata
      exportedAt: new Date().toISOString(),
      exportedFrom: 'Sanctuary',
      version: '1.0',
    };

    res.json(exportData);
  } catch (error: any) {
    console.error('[WALLETS] Export wallet error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to export wallet',
    });
  }
});

/**
 * Map device type to Sparrow wallet model
 */
function mapDeviceTypeToWalletModel(deviceType: string): string {
  const typeMap: Record<string, string> = {
    'coldcard': 'COLDCARD',
    'coldcard_mk4': 'COLDCARD',
    'coldcard_q': 'COLDCARD',
    'ledger': 'LEDGER_NANO_S',
    'ledger_nano_s': 'LEDGER_NANO_S',
    'ledger_nano_x': 'LEDGER_NANO_X',
    'ledger_stax': 'LEDGER_STAX',
    'ledger_flex': 'LEDGER_FLEX',
    'trezor': 'TREZOR_1',
    'trezor_one': 'TREZOR_1',
    'trezor_model_t': 'TREZOR_T',
    'trezor_safe_3': 'TREZOR_SAFE_3',
    'bitbox02': 'BITBOX_02',
    'bitbox': 'BITBOX_02',
    'foundation_passport': 'PASSPORT',
    'passport': 'PASSPORT',
    'blockstream_jade': 'JADE',
    'jade': 'JADE',
    'keystone': 'KEYSTONE',
  };

  const normalized = deviceType.toLowerCase().replace(/\s+/g, '_');
  return typeMap[normalized] || 'SPARROW';
}

/**
 * POST /api/v1/wallets/:id/addresses
 * Generate a new receiving address
 */
router.post('/:id/addresses', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const address = await walletService.generateAddress(id, userId);

    res.status(201).json({ address });
  } catch (error: any) {
    console.error('[WALLETS] Generate address error:', error);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate address',
    });
  }
});

/**
 * POST /api/v1/wallets/:id/devices
 * Add a device to wallet
 */
router.post('/:id/devices', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { deviceId, signerIndex } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'deviceId is required',
      });
    }

    await walletService.addDeviceToWallet(id, deviceId, userId, signerIndex);

    res.status(201).json({ message: 'Device added to wallet' });
  } catch (error: any) {
    console.error('[WALLETS] Add device error:', error);

    if (error.message.includes('not found') || error.message.includes('denied')) {
      return res.status(404).json({
        error: 'Not Found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add device to wallet',
    });
  }
});

/**
 * POST /api/v1/wallets/validate-xpub
 * Validate an xpub and generate descriptor
 */
router.post('/validate-xpub', async (req: Request, res: Response) => {
  try {
    const { xpub, scriptType, network = 'mainnet', fingerprint, accountPath } = req.body;

    if (!xpub) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'xpub is required',
      });
    }

    // Validate xpub
    const addressDerivation = await import('../services/bitcoin/addressDerivation');
    const validation = addressDerivation.validateXpub(xpub, network);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: validation.error || 'Invalid xpub',
      });
    }

    // Determine script type
    const detectedScriptType = scriptType || validation.scriptType || 'native_segwit';

    // Generate descriptor
    let descriptor: string;
    const fingerprintStr = fingerprint || '00000000';
    const accountPathStr = accountPath || getDefaultAccountPath(detectedScriptType, network);

    switch (detectedScriptType) {
      case 'native_segwit':
        descriptor = `wpkh([${fingerprintStr}/${accountPathStr}]${xpub}/0/*)`;
        break;
      case 'nested_segwit':
        descriptor = `sh(wpkh([${fingerprintStr}/${accountPathStr}]${xpub}/0/*))`;
        break;
      case 'taproot':
        descriptor = `tr([${fingerprintStr}/${accountPathStr}]${xpub}/0/*)`;
        break;
      case 'legacy':
        descriptor = `pkh([${fingerprintStr}/${accountPathStr}]${xpub}/0/*)`;
        break;
      default:
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid script type',
        });
    }

    // Derive first address as example
    const { address } = addressDerivation.deriveAddress(xpub, 0, {
      scriptType: detectedScriptType,
      network,
      change: false,
    });

    res.json({
      valid: true,
      descriptor,
      scriptType: detectedScriptType,
      firstAddress: address,
      xpub,
      fingerprint: fingerprintStr,
      accountPath: accountPathStr,
    });
  } catch (error: any) {
    console.error('[WALLETS] Validate xpub error:', error);
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to validate xpub',
    });
  }
});

/**
 * Helper to get default account path
 */
function getDefaultAccountPath(scriptType: string, network: string): string {
  const coinType = network === 'mainnet' ? "0'" : "1'";

  switch (scriptType) {
    case 'legacy':
      return `44'/${coinType}/0'`;
    case 'nested_segwit':
      return `49'/${coinType}/0'`;
    case 'native_segwit':
      return `84'/${coinType}/0'`;
    case 'taproot':
      return `86'/${coinType}/0'`;
    default:
      return `84'/${coinType}/0'`;
  }
}

/**
 * POST /api/v1/wallets/:id/share/group
 * Share wallet with a group
 */
router.post('/:id/share/group', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { groupId } = req.body;

    // Verify user is owner of the wallet
    const walletUser = await prisma.walletUser.findFirst({
      where: {
        walletId: id,
        userId,
        role: 'owner',
      },
    });

    if (!walletUser) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only wallet owners can share wallets',
      });
    }

    // If groupId provided, verify user is member of that group
    if (groupId) {
      const groupMember = await prisma.groupMember.findFirst({
        where: {
          groupId,
          userId,
        },
      });

      if (!groupMember) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You must be a member of the group to share with it',
        });
      }
    }

    // Update wallet's group
    const wallet = await prisma.wallet.update({
      where: { id },
      data: { groupId: groupId || null },
      include: {
        group: true,
      },
    });

    res.json({
      success: true,
      groupId: wallet.groupId,
      groupName: wallet.group?.name || null,
    });
  } catch (error: any) {
    console.error('[WALLETS] Share with group error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to share wallet with group',
    });
  }
});

/**
 * POST /api/v1/wallets/:id/share/user
 * Share wallet with a specific user
 */
router.post('/:id/share/user', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { targetUserId, role = 'viewer' } = req.body;

    if (!targetUserId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'targetUserId is required',
      });
    }

    if (!['viewer', 'signer'].includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'role must be viewer or signer',
      });
    }

    // Verify user is owner of the wallet
    const walletUser = await prisma.walletUser.findFirst({
      where: {
        walletId: id,
        userId,
        role: 'owner',
      },
    });

    if (!walletUser) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only wallet owners can share wallets',
      });
    }

    // Verify target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    // Check if user already has access
    const existingAccess = await prisma.walletUser.findFirst({
      where: {
        walletId: id,
        userId: targetUserId,
      },
    });

    if (existingAccess) {
      // Update role if different
      if (existingAccess.role !== role && existingAccess.role !== 'owner') {
        await prisma.walletUser.update({
          where: { id: existingAccess.id },
          data: { role },
        });
      }
      return res.json({
        success: true,
        message: 'User access updated',
      });
    }

    // Add user to wallet
    await prisma.walletUser.create({
      data: {
        walletId: id,
        userId: targetUserId,
        role,
      },
    });

    res.status(201).json({
      success: true,
      message: 'User added to wallet',
    });
  } catch (error: any) {
    console.error('[WALLETS] Share with user error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to share wallet with user',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:id/share/user/:targetUserId
 * Remove a user's access to wallet
 */
router.delete('/:id/share/user/:targetUserId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id, targetUserId } = req.params;

    // Verify user is owner of the wallet
    const walletUser = await prisma.walletUser.findFirst({
      where: {
        walletId: id,
        userId,
        role: 'owner',
      },
    });

    if (!walletUser) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only wallet owners can remove users',
      });
    }

    // Can't remove the owner
    const targetWalletUser = await prisma.walletUser.findFirst({
      where: {
        walletId: id,
        userId: targetUserId,
      },
    });

    if (!targetWalletUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User does not have access to this wallet',
      });
    }

    if (targetWalletUser.role === 'owner') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot remove the owner from the wallet',
      });
    }

    await prisma.walletUser.delete({
      where: { id: targetWalletUser.id },
    });

    res.json({
      success: true,
      message: 'User removed from wallet',
    });
  } catch (error: any) {
    console.error('[WALLETS] Remove user error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to remove user from wallet',
    });
  }
});

/**
 * GET /api/v1/wallets/:id/share
 * Get wallet sharing info (group and users)
 */
router.get('/:id/share', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    // Verify user has access to wallet
    const wallet = await prisma.wallet.findFirst({
      where: {
        id,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
      include: {
        group: true,
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
      },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    res.json({
      group: wallet.group ? {
        id: wallet.group.id,
        name: wallet.group.name,
      } : null,
      users: wallet.users.map((wu: { user: { id: string; username: string }; role: string }) => ({
        id: wu.user.id,
        username: wu.user.username,
        role: wu.role,
      })),
    });
  } catch (error: any) {
    console.error('[WALLETS] Get share info error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get sharing info',
    });
  }
});

/**
 * POST /api/v1/wallets/import/validate
 * Validate import data and preview what will happen
 */
router.post('/import/validate', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { descriptor, json } = req.body;

    if (!descriptor && !json) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Either descriptor or json is required',
      });
    }

    const result = await walletImport.validateImport(userId, {
      descriptor,
      json,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[WALLETS] Import validate error:', error);
    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to validate import data',
    });
  }
});

/**
 * POST /api/v1/wallets/import
 * Import a wallet from descriptor or JSON
 */
router.post('/import', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { data, name, network, deviceLabels } = req.body;

    if (!data) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'data (descriptor or JSON) is required',
      });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name is required',
      });
    }

    const result = await walletImport.importWallet(userId, {
      data,
      name: name.trim(),
      network,
      deviceLabels,
    });

    res.status(201).json(result);
  } catch (error: any) {
    console.error('[WALLETS] Import wallet error:', error);

    // Check for unique constraint violation (duplicate fingerprint)
    if (error.code === 'P2002' && error.meta?.target?.includes('fingerprint')) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'A device with this fingerprint already exists for another user',
      });
    }

    res.status(400).json({
      error: 'Bad Request',
      message: error.message || 'Failed to import wallet',
    });
  }
});

export default router;
