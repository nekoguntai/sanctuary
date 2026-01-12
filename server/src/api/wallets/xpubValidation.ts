/**
 * Wallets - XPUB Validation Router
 *
 * Utility endpoint for validating xpubs and generating descriptors
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

const router = Router();
const log = createLogger('WALLETS:XPUB');

/**
 * Helper to get default account path based on script type and network
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
    const addressDerivation = await import('../../services/bitcoin/addressDerivation');
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
  } catch (error) {
    log.error('Validate xpub error', { error });
    res.status(400).json({
      error: 'Bad Request',
      message: getErrorMessage(error, 'Failed to validate xpub'),
    });
  }
});

export default router;
