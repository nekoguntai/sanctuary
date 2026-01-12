/**
 * Transactions - Address Router
 *
 * Endpoints for listing and generating wallet addresses
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import prisma from '../../models/prisma';
import * as addressDerivation from '../../services/bitcoin/addressDerivation';
import { createLogger } from '../../utils/logger';
import { INITIAL_ADDRESS_COUNT } from '../../constants';

const router = Router();
const log = createLogger('TX:ADDRESSES');

/**
 * GET /api/v1/wallets/:walletId/addresses
 * Get all addresses for a wallet
 * Auto-generates addresses if wallet has descriptor but no addresses
 */
router.get('/wallets/:walletId/addresses', requireWalletAccess('view'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { used } = req.query;

    // Get wallet for descriptor
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { descriptor: true, network: true },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    // Check if addresses exist
    let addresses = await prisma.address.findMany({
      where: {
        walletId,
        ...(used !== undefined && { used: used === 'true' }),
      },
      include: {
        addressLabels: {
          include: {
            label: true,
          },
        },
      },
      orderBy: { index: 'asc' },
    });

    // Auto-generate addresses if none exist and wallet has a descriptor
    if (addresses.length === 0 && wallet.descriptor && used === undefined) {
      try {
        const addressesToCreate = [];

        // Generate receive addresses (change = 0)
        for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
          const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
            wallet.descriptor,
            i,
            {
              network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
              change: false, // External/receive addresses
            }
          );
          addressesToCreate.push({
            walletId,
            address,
            derivationPath,
            index: i,
            used: false,
          });
        }

        // Generate change addresses (change = 1)
        for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
          const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
            wallet.descriptor,
            i,
            {
              network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
              change: true, // Internal/change addresses
            }
          );
          addressesToCreate.push({
            walletId,
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

        // Re-fetch the created addresses
        addresses = await prisma.address.findMany({
          where: { walletId },
          include: {
            addressLabels: {
              include: {
                label: true,
              },
            },
          },
          orderBy: { index: 'asc' },
        });
      } catch (err) {
        log.error('Failed to auto-generate addresses', { error: err });
        // Return empty array if generation fails
      }
    }

    // Get balances for each address from UTXOs
    const utxos = await prisma.uTXO.findMany({
      where: {
        walletId,
        spent: false,
      },
      select: {
        address: true,
        amount: true,
      },
    });

    // Sum balances by address
    const addressBalances = new Map<string, number>();
    for (const utxo of utxos) {
      const current = addressBalances.get(utxo.address) || 0;
      addressBalances.set(utxo.address, current + Number(utxo.amount));
    }

    // Add balance, labels, and isChange flag to each address
    const addressesWithBalance = addresses.map(addr => {
      // Determine if this is a change address from derivation path
      // Change addresses have /1/ before the final index, receive addresses have /0/
      // e.g., m/84'/0'/0'/1/5 is change, m/84'/0'/0'/0/5 is receive
      const pathParts = addr.derivationPath.split('/');
      const isChange = pathParts.length >= 2 && pathParts[pathParts.length - 2] === '1';

      return {
        ...addr,
        balance: addressBalances.get(addr.address) || 0,
        labels: addr.addressLabels.map(al => al.label),
        isChange,
        addressLabels: undefined, // Remove the raw join data
      };
    });

    res.json(addressesWithBalance);
  } catch (error) {
    log.error('Get addresses error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch addresses',
    });
  }
});

/**
 * POST /api/v1/wallets/:walletId/addresses/generate
 * Generate more addresses for a wallet (requires edit access: owner or signer)
 */
router.post('/wallets/:walletId/addresses/generate', requireWalletAccess('edit'), async (req: Request, res: Response) => {
  try {
    const walletId = req.walletId!;
    const { count = 10 } = req.body;

    // Fetch wallet data
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Wallet not found',
      });
    }

    if (!wallet.descriptor) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Wallet does not have a descriptor',
      });
    }

    // Get current max index for receive and change addresses
    const existingAddresses = await prisma.address.findMany({
      where: { walletId },
      select: { derivationPath: true, index: true },
    });

    // Parse existing addresses to find max indices
    let maxReceiveIndex = -1;
    let maxChangeIndex = -1;

    for (const addr of existingAddresses) {
      const parts = addr.derivationPath.split('/');
      if (parts.length >= 2) {
        const changeIndicator = parts[parts.length - 2];
        const index = parseInt(parts[parts.length - 1], 10);
        if (changeIndicator === '0' && index > maxReceiveIndex) {
          maxReceiveIndex = index;
        } else if (changeIndicator === '1' && index > maxChangeIndex) {
          maxChangeIndex = index;
        }
      }
    }

    const addressesToCreate = [];

    // Generate more receive addresses
    for (let i = maxReceiveIndex + 1; i < maxReceiveIndex + 1 + count; i++) {
      try {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          {
            network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
            change: false,
          }
        );
        addressesToCreate.push({
          walletId,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      } catch (err) {
        log.error(`Failed to derive receive address ${i}`, { error: err });
      }
    }

    // Generate more change addresses
    for (let i = maxChangeIndex + 1; i < maxChangeIndex + 1 + count; i++) {
      try {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          {
            network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
            change: true,
          }
        );
        addressesToCreate.push({
          walletId,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      } catch (err) {
        log.error(`Failed to derive change address ${i}`, { error: err });
      }
    }

    // Bulk insert addresses (skip duplicates)
    if (addressesToCreate.length > 0) {
      await prisma.address.createMany({
        data: addressesToCreate,
        skipDuplicates: true,
      });
    }

    res.json({
      generated: addressesToCreate.length,
      receiveAddresses: count,
      changeAddresses: count,
    });
  } catch (error) {
    log.error('Generate addresses error', { error });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to generate addresses',
    });
  }
});

export default router;
