/**
 * Wallet API Routes
 *
 * API endpoints for wallet management
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireWalletAccess } from '../middleware/walletAccess';
import * as walletService from '../services/wallet';
import * as walletImport from '../services/walletImport';
import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';

const router = Router();
const log = createLogger('WALLETS');

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
    log.error('Get wallets error', { error });
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
    log.error('Create wallet error', { error });
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
router.get('/:id', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;

    const wallet = await walletService.getWalletById(walletId, userId);

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    res.json(wallet);
  } catch (error) {
    log.error('Get wallet error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallet',
    });
  }
});

/**
 * PATCH /api/v1/wallets/:id
 * Update a wallet (owner only)
 */
router.patch('/:id', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;
    const { name, descriptor } = req.body;

    const wallet = await walletService.updateWallet(walletId, userId, {
      name,
      descriptor,
    });

    res.json(wallet);
  } catch (error: any) {
    log.error('Update wallet error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update wallet',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:id
 * Delete a wallet (owner only)
 */
router.delete('/:id', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;

    await walletService.deleteWallet(walletId, userId);

    res.status(204).send();
  } catch (error: any) {
    log.error('Delete wallet error', { error });
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
router.get('/:id/stats', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;

    const stats = await walletService.getWalletStats(walletId, userId);

    res.json(stats);
  } catch (error: any) {
    log.error('Get wallet stats error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wallet stats',
    });
  }
});

/**
 * GET /api/v1/wallets/:id/export/labels
 * Export wallet labels in BIP 329 format (JSON Lines)
 * https://github.com/bitcoin/bips/blob/master/bip-0329.mediawiki
 */
router.get('/:id/export/labels', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    // Get wallet name for filename
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { name: true },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Get all transactions with labels
    const transactions = await prisma.transaction.findMany({
      where: {
        walletId,
        OR: [
          { label: { not: null } },
          { memo: { not: null } },
          { transactionLabels: { some: {} } },
        ],
      },
      include: {
        transactionLabels: {
          include: {
            label: true,
          },
        },
      },
    });

    // Get all addresses with labels
    const addresses = await prisma.address.findMany({
      where: {
        walletId,
        addressLabels: { some: {} },
      },
      include: {
        addressLabels: {
          include: {
            label: true,
          },
        },
      },
    });

    // Build BIP 329 JSON Lines
    const lines: string[] = [];

    // Transaction labels
    for (const tx of transactions) {
      // Combine label, memo, and tag labels
      const labelParts: string[] = [];
      if (tx.label) labelParts.push(tx.label);
      if (tx.memo) labelParts.push(tx.memo);
      for (const tl of tx.transactionLabels) {
        if (tl.label.name) labelParts.push(tl.label.name);
      }

      if (labelParts.length > 0) {
        lines.push(JSON.stringify({
          type: 'tx',
          ref: tx.txid,
          label: labelParts.join(', '),
        }));
      }
    }

    // Address labels
    for (const addr of addresses) {
      const labelParts: string[] = [];
      for (const al of addr.addressLabels) {
        if (al.label.name) labelParts.push(al.label.name);
      }

      if (labelParts.length > 0) {
        lines.push(JSON.stringify({
          type: 'addr',
          ref: addr.address,
          label: labelParts.join(', '),
          origin: addr.derivationPath || undefined,
        }));
      }
    }

    // Set response headers for file download
    const filename = `${wallet.name.replace(/[^a-zA-Z0-9]/g, '_')}_labels_bip329.jsonl`;
    res.setHeader('Content-Type', 'application/jsonl');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Send as newline-separated JSON
    res.send(lines.join('\n'));
  } catch (error: any) {
    log.error('Export labels error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to export labels',
    });
  }
});

/**
 * GET /api/v1/wallets/:id/export
 * Export wallet in Sparrow-compatible JSON format
 */
router.get('/:id/export', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    // Get wallet with all related data
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
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
    log.error('Export wallet error', { error });
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
    'coldcardmk4': 'COLDCARD',
    'coldcard_mk4': 'COLDCARD',
    'coldcard_q': 'COLDCARD',
    'ledger': 'LEDGER_NANO_S',
    'ledger_nano': 'LEDGER_NANO_S',
    'ledger_nano_s': 'LEDGER_NANO_S',
    'ledger_nano_x': 'LEDGER_NANO_X',
    'ledger_stax': 'LEDGER_STAX',
    'ledger_flex': 'LEDGER_FLEX',
    'ledger_gen_5': 'LEDGER_FLEX', // Gen 5 uses same protocol as Flex
    'trezor': 'TREZOR_1',
    'trezor_one': 'TREZOR_1',
    'trezor_model_t': 'TREZOR_T',
    'trezor_safe_3': 'TREZOR_SAFE_3',
    'trezor_safe_7': 'TREZOR_SAFE_5', // Safe 7 uses Safe 5 protocol
    'bitbox02': 'BITBOX_02',
    'bitbox': 'BITBOX_02',
    'foundation_passport': 'PASSPORT',
    'passport': 'PASSPORT',
    'blockstream_jade': 'JADE',
    'jade': 'JADE',
    'keystone': 'KEYSTONE',
    'generic': 'AIRGAPPED',
    'generic_sd': 'AIRGAPPED',
  };

  const normalized = deviceType.toLowerCase().replace(/\s+/g, '_');
  // Return mapped value or uppercase device type (never SPARROW for hardware wallets)
  return typeMap[normalized] || deviceType.toUpperCase().replace(/\s+/g, '_');
}

/**
 * POST /api/v1/wallets/:id/addresses
 * Generate a new receiving address (edit access - signer or owner)
 */
router.post('/:id/addresses', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;

    const address = await walletService.generateAddress(walletId, userId);

    res.status(201).json({ address });
  } catch (error: any) {
    log.error('Generate address error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate address',
    });
  }
});

/**
 * POST /api/v1/wallets/:id/devices
 * Add a device to wallet (edit access - signer or owner)
 */
router.post('/:id/devices', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;
    const { deviceId, signerIndex } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'deviceId is required',
      });
    }

    await walletService.addDeviceToWallet(walletId, deviceId, userId, signerIndex);

    res.status(201).json({ message: 'Device added to wallet' });
  } catch (error: any) {
    log.error('Add device error', { error });
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
    log.error('Validate xpub error', { error });
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
 * Share wallet with a group (owner only)
 */
router.post('/:id/share/group', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const walletId = req.walletId!;
    const { groupId, role = 'viewer' } = req.body;

    // Validate role
    if (role && !['viewer', 'signer'].includes(role)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid role. Must be viewer or signer',
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

    // Update wallet's group and role
    const wallet = await prisma.wallet.update({
      where: { id: walletId },
      data: {
        groupId: groupId || null,
        groupRole: groupId ? role : 'viewer', // Reset to default if removing group
      },
      include: {
        group: true,
      },
    });

    res.json({
      success: true,
      groupId: wallet.groupId,
      groupName: wallet.group?.name || null,
      groupRole: wallet.groupRole,
    });
  } catch (error: any) {
    log.error('Share with group error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to share wallet with group',
    });
  }
});

/**
 * POST /api/v1/wallets/:id/share/user
 * Share wallet with a specific user (owner only)
 */
router.post('/:id/share/user', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
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
        walletId,
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
        walletId,
        userId: targetUserId,
        role,
      },
    });

    res.status(201).json({
      success: true,
      message: 'User added to wallet',
    });
  } catch (error: any) {
    log.error('Share with user error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to share wallet with user',
    });
  }
});

/**
 * DELETE /api/v1/wallets/:id/share/user/:targetUserId
 * Remove a user's access to wallet (owner only)
 */
router.delete('/:id/share/user/:targetUserId', requireWalletAccess('owner'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { targetUserId } = req.params;

    // Can't remove the owner
    const targetWalletUser = await prisma.walletUser.findFirst({
      where: {
        walletId,
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
    log.error('Remove user error', { error });
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
router.get('/:id/share', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;

    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
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
        role: wallet.groupRole,
      } : null,
      users: wallet.users.map((wu: { user: { id: string; username: string }; role: string }) => ({
        id: wu.user.id,
        username: wu.user.username,
        role: wu.role,
      })),
    });
  } catch (error: any) {
    log.error('Get share info error', { error });
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
    log.error('Import validate error', { error });
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
    log.error('Import wallet error', { error });

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

// ============================================================================
// TELEGRAM NOTIFICATIONS (Per-Wallet Settings)
// ============================================================================

/**
 * GET /api/v1/wallets/:id/telegram
 * Get Telegram notification settings for a specific wallet
 */
router.get('/:id/telegram', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const userId = req.user!.userId;

    const { getWalletTelegramSettings } = await import('../services/telegram/telegramService');
    const settings = await getWalletTelegramSettings(userId, walletId);

    res.json({
      settings: settings || {
        enabled: false,
        notifyReceived: true,
        notifySent: true,
        notifyConsolidation: false,
        notifyDraft: true,
      },
    });
  } catch (error) {
    log.error('Get Telegram settings error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get Telegram settings',
    });
  }
});

/**
 * PATCH /api/v1/wallets/:id/telegram
 * Update Telegram notification settings for a specific wallet
 */
router.patch('/:id/telegram', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const userId = req.user!.userId;
    const { enabled, notifyReceived, notifySent, notifyConsolidation, notifyDraft } = req.body;

    const { updateWalletTelegramSettings } = await import('../services/telegram/telegramService');
    await updateWalletTelegramSettings(userId, walletId, {
      enabled: enabled ?? false,
      notifyReceived: notifyReceived ?? true,
      notifySent: notifySent ?? true,
      notifyConsolidation: notifyConsolidation ?? false,
      notifyDraft: notifyDraft ?? true,
    });

    res.json({
      success: true,
      message: 'Telegram settings updated',
    });
  } catch (error) {
    log.error('Update Telegram settings error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update Telegram settings',
    });
  }
});

export default router;
