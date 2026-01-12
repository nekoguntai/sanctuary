/**
 * Bitcoin - Address Router
 *
 * Address validation, lookup, and sync operations
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import * as blockchain from '../../services/bitcoin/blockchain';
import * as utils from '../../services/bitcoin/utils';
import prisma from '../../models/prisma';
import { createLogger } from '../../utils/logger';

const router = Router();
const log = createLogger('BITCOIN:ADDRESS');

/**
 * POST /api/v1/bitcoin/address/validate
 * Validate a Bitcoin address
 */
router.post('/address/validate', async (req: Request, res: Response) => {
  try {
    const { address, network = 'mainnet' } = req.body;

    if (!address) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'address is required',
      });
    }

    const result = await blockchain.checkAddress(address, network);

    res.json(result);
  } catch (error) {
    log.error('Validate address error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to validate address',
    });
  }
});

/**
 * GET /api/v1/bitcoin/address/:address
 * Get address information from blockchain
 */
router.get('/address/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const networkParam = req.query.network as string | undefined;
    const network: 'mainnet' | 'testnet' | 'regtest' =
      networkParam === 'testnet' ? 'testnet' :
      networkParam === 'regtest' ? 'regtest' : 'mainnet';

    const result = await blockchain.checkAddress(address, network);

    if (!result.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: result.error || 'Invalid address',
      });
    }

    res.json({
      address,
      balance: result.balance || 0,
      transactionCount: result.transactionCount || 0,
      type: utils.getAddressType(address),
    });
  } catch (error) {
    log.error('Get address error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch address info',
    });
  }
});

/**
 * POST /api/v1/bitcoin/address/:addressId/sync
 * Sync single address with blockchain
 */
router.post('/address/:addressId/sync', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { addressId } = req.params;

    // Check user has access to address's wallet
    const address = await prisma.address.findFirst({
      where: {
        id: addressId,
        wallet: {
          OR: [
            { users: { some: { userId } } },
            { group: { members: { some: { userId } } } },
          ],
        },
      },
    });

    if (!address) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Address not found',
      });
    }

    const result = await blockchain.syncAddress(addressId);

    res.json({
      message: 'Address synced successfully',
      ...result,
    });
  } catch (error) {
    log.error('Sync address error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to sync address',
    });
  }
});

/**
 * POST /api/v1/bitcoin/address-lookup
 * Look up which wallets own given addresses (for internal wallet detection in send flow)
 */
router.post('/address-lookup', authenticate, async (req: Request, res: Response) => {
  try {
    const { addresses } = req.body;

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'addresses must be a non-empty array',
      });
    }

    // Limit the number of addresses to prevent abuse
    if (addresses.length > 100) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Maximum 100 addresses per request',
      });
    }

    const userId = (req as any).user?.id;

    // Find addresses that belong to wallets the user has access to
    const addressRecords = await prisma.address.findMany({
      where: {
        address: { in: addresses },
        wallet: {
          users: {
            some: {
              userId,
            },
          },
        },
      },
      select: {
        address: true,
        wallet: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Build lookup map: address -> { walletId, walletName }
    const lookup: Record<string, { walletId: string; walletName: string }> = {};
    for (const record of addressRecords) {
      lookup[record.address] = {
        walletId: record.wallet.id,
        walletName: record.wallet.name,
      };
    }

    res.json({ lookup });
  } catch (error) {
    log.error('Address lookup error', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to look up addresses',
    });
  }
});

export default router;
