/**
 * Devices - Accounts Router
 *
 * Device account management (multi-xpub support)
 */

import { Router, Request, Response } from 'express';
import { requireDeviceAccess } from '../../middleware/deviceAccess';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('DEVICES:ACCOUNTS');

/**
 * GET /api/v1/devices/:id/accounts
 * Get all accounts for a device (requires view access)
 */
router.get('/:id/accounts', requireDeviceAccess('view'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const accounts = await prisma.deviceAccount.findMany({
      where: { deviceId: id },
      orderBy: [
        { purpose: 'asc' },
        { scriptType: 'asc' },
      ],
    });

    res.json(accounts);
  } catch (error) {
    log.error('Get device accounts error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch device accounts',
    });
  }
});

/**
 * POST /api/v1/devices/:id/accounts
 * Add a new account to an existing device (owner only)
 *
 * This allows adding a multisig xpub to a device that was originally
 * registered with only a single-sig xpub.
 */
router.post('/:id/accounts', requireDeviceAccess('owner'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { purpose, scriptType, derivationPath, xpub } = req.body;

    // Validation
    if (!purpose || !scriptType || !derivationPath || !xpub) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'purpose, scriptType, derivationPath, and xpub are required',
      });
    }

    if (!['single_sig', 'multisig'].includes(purpose)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'purpose must be "single_sig" or "multisig"',
      });
    }

    if (!['native_segwit', 'nested_segwit', 'taproot', 'legacy'].includes(scriptType)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'scriptType must be one of: native_segwit, nested_segwit, taproot, legacy',
      });
    }

    // Check if this account type already exists
    const existingAccount = await prisma.deviceAccount.findFirst({
      where: {
        deviceId: id,
        OR: [
          { derivationPath },
          { purpose, scriptType },
        ],
      },
    });

    if (existingAccount) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'An account with this derivation path or purpose/scriptType combination already exists',
      });
    }

    const account = await prisma.deviceAccount.create({
      data: {
        deviceId: id,
        purpose,
        scriptType,
        derivationPath,
        xpub,
      },
    });

    log.info('Device account added', {
      deviceId: id,
      accountId: account.id,
      purpose,
      scriptType,
      derivationPath,
    });

    res.status(201).json(account);
  } catch (error) {
    log.error('Add device account error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to add device account',
    });
  }
});

/**
 * DELETE /api/v1/devices/:id/accounts/:accountId
 * Remove an account from a device (owner only)
 *
 * Note: Cannot delete the last account of a device
 */
router.delete('/:id/accounts/:accountId', requireDeviceAccess('owner'), async (req: Request, res: Response) => {
  try {
    const { id, accountId } = req.params;

    // Check if account exists and belongs to this device
    const account = await prisma.deviceAccount.findFirst({
      where: {
        id: accountId,
        deviceId: id,
      },
    });

    if (!account) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Account not found',
      });
    }

    // Check if this is the last account
    const accountCount = await prisma.deviceAccount.count({
      where: { deviceId: id },
    });

    if (accountCount <= 1) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot delete the last account of a device',
      });
    }

    await prisma.deviceAccount.delete({
      where: { id: accountId },
    });

    log.info('Device account deleted', {
      deviceId: id,
      accountId,
      purpose: account.purpose,
      scriptType: account.scriptType,
    });

    res.status(204).send();
  } catch (error) {
    log.error('Delete device account error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete device account',
    });
  }
});

export default router;
