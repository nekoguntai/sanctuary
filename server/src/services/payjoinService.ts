/**
 * Payjoin Service (BIP78)
 *
 * Implements Payjoin protocol for enhanced transaction privacy:
 * - Receive: Process incoming Payjoin requests and add our input
 * - Send: Detect pj= URIs and attempt Payjoin with receiver
 *
 * Payjoin breaks the "common input ownership" heuristic by having
 * both sender and receiver contribute inputs to the transaction.
 */

import * as bitcoin from 'bitcoinjs-lib';
import dns from 'dns';
import { promisify } from 'util';
import prisma from '../models/prisma';
import { createLogger } from '../utils/logger';
import {
  parsePsbt,
  validatePsbtStructure,
  validatePayjoinProposal,
  getPsbtOutputs,
  getPsbtInputs,
  calculateFeeRate,
  clonePsbt,
} from './bitcoin/psbtValidation';
import { getNetwork } from './bitcoin/utils';

const log = createLogger('PAYJOIN');

const dnsLookup = promisify(dns.lookup);

/**
 * Check if an IP address is private/internal (SSRF protection)
 */
function isPrivateIP(ip: string): boolean {
  // Handle IPv4-mapped IPv6 addresses
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  // IPv6 localhost
  if (ip === '::1') return true;

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) {
    // Not a valid IPv4, could be IPv6 - block to be safe
    return !ip.includes('.'); // Block non-IPv4 except public IPv6
  }

  return (
    // Localhost
    parts[0] === 127 ||
    // Private Class A (10.0.0.0/8)
    parts[0] === 10 ||
    // Private Class B (172.16.0.0/12)
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    // Private Class C (192.168.0.0/16)
    (parts[0] === 192 && parts[1] === 168) ||
    // Link-local (169.254.0.0/16)
    (parts[0] === 169 && parts[1] === 254) ||
    // Cloud metadata endpoints
    (parts[0] === 169 && parts[1] === 254 && parts[2] === 169 && parts[3] === 254) ||
    // Broadcast
    parts[0] === 0 ||
    parts[0] === 255
  );
}

/**
 * Validate a Payjoin URL to prevent SSRF attacks
 */
async function validatePayjoinUrl(urlString: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const url = new URL(urlString);

    // Only allow HTTPS for security
    if (url.protocol !== 'https:') {
      return { valid: false, error: 'Payjoin URL must use HTTPS' };
    }

    // Block localhost and common internal hostnames
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'internal', 'local'];
    if (blockedHosts.some(h => url.hostname.toLowerCase() === h || url.hostname.toLowerCase().endsWith('.' + h))) {
      return { valid: false, error: 'Payjoin URL cannot point to localhost or internal hosts' };
    }

    // Resolve hostname and check for private IPs
    try {
      const { address } = await dnsLookup(url.hostname);
      if (isPrivateIP(address)) {
        log.warn('Payjoin URL resolved to private IP', { hostname: url.hostname, ip: address });
        return { valid: false, error: 'Payjoin URL resolved to a private IP address' };
      }
    } catch (dnsError) {
      log.warn('Failed to resolve Payjoin URL hostname', { hostname: url.hostname, error: String(dnsError) });
      return { valid: false, error: 'Could not resolve Payjoin URL hostname' };
    }

    return { valid: true };
  } catch (parseError) {
    return { valid: false, error: 'Invalid Payjoin URL format' };
  }
}

// BIP78 error codes
export const PayjoinErrors = {
  VERSION_UNSUPPORTED: 'version-unsupported',
  UNAVAILABLE: 'unavailable',
  NOT_ENOUGH_MONEY: 'not-enough-money',
  ORIGINAL_PSBT_REJECTED: 'original-psbt-rejected',
  RECEIVER_ERROR: 'receiver-error',
} as const;

export type PayjoinErrorCode = typeof PayjoinErrors[keyof typeof PayjoinErrors];

export interface PayjoinResult {
  success: boolean;
  proposalPsbt?: string;
  error?: PayjoinErrorCode;
  errorMessage?: string;
}

export interface PayjoinValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Process an incoming Payjoin request (we're the receiver)
 *
 * Steps:
 * 1. Validate the original PSBT
 * 2. Find the output paying to our address
 * 3. Select a UTXO to contribute
 * 4. Add our input to the PSBT
 * 5. Increase our output by our contribution amount
 * 6. Sign our input (if hot wallet)
 * 7. Return the modified PSBT
 */
export async function processPayjoinRequest(
  addressId: string,
  originalPsbtBase64: string,
  minFeeRate: number = 1
): Promise<PayjoinResult> {
  try {
    // Get address and wallet info
    const address = await prisma.address.findUnique({
      where: { id: addressId },
      include: {
        wallet: {
          select: {
            id: true,
            network: true,
            type: true,
            scriptType: true,
          },
        },
      },
    });

    if (!address) {
      log.warn('Payjoin request for unknown address', { addressId });
      return {
        success: false,
        error: PayjoinErrors.UNAVAILABLE,
        errorMessage: 'Address not found',
      };
    }

    const network = getNetwork(address.wallet.network as 'mainnet' | 'testnet' | 'regtest' || 'mainnet');

    // Validate original PSBT structure
    const structureValidation = validatePsbtStructure(originalPsbtBase64);
    if (!structureValidation.valid) {
      log.warn('Invalid original PSBT structure', { errors: structureValidation.errors });
      return {
        success: false,
        error: PayjoinErrors.ORIGINAL_PSBT_REJECTED,
        errorMessage: structureValidation.errors.join(', '),
      };
    }

    const originalPsbt = parsePsbt(originalPsbtBase64, network);
    const originalOutputs = getPsbtOutputs(originalPsbt, network);

    // Find the output paying to our address
    const ourOutputIndex = originalOutputs.findIndex(o => o.address === address.address);
    if (ourOutputIndex === -1) {
      log.warn('No output to our address found', { address: address.address });
      return {
        success: false,
        error: PayjoinErrors.ORIGINAL_PSBT_REJECTED,
        errorMessage: 'No output to the receiving address',
      };
    }

    const paymentAmount = originalOutputs[ourOutputIndex].value;

    // Select a UTXO to contribute
    const contributionUtxo = await selectContributionUtxo(
      address.wallet.id,
      paymentAmount
    );

    if (!contributionUtxo) {
      log.info('No suitable UTXO for Payjoin contribution', { walletId: address.wallet.id });
      return {
        success: false,
        error: PayjoinErrors.NOT_ENOUGH_MONEY,
        errorMessage: 'No suitable UTXOs available for contribution',
      };
    }

    // Check fee rate meets minimum
    const originalFeeRate = calculateFeeRate(originalPsbt);
    if (originalFeeRate < minFeeRate) {
      log.warn('Original fee rate below minimum', { originalFeeRate, minFeeRate });
      return {
        success: false,
        error: PayjoinErrors.ORIGINAL_PSBT_REJECTED,
        errorMessage: `Fee rate ${originalFeeRate.toFixed(2)} below minimum ${minFeeRate}`,
      };
    }

    // Build proposal PSBT
    const proposalPsbt = clonePsbt(originalPsbt);

    // Add our input
    const contributionAmount = Number(contributionUtxo.amount);
    proposalPsbt.addInput({
      hash: contributionUtxo.txid,
      index: contributionUtxo.vout,
      sequence: 0xfffffffd, // RBF enabled
      // For P2WPKH, we need to add witnessUtxo
      witnessUtxo: {
        script: Buffer.from(contributionUtxo.scriptPubKey, 'hex'),
        value: contributionAmount,
      },
    });

    // Increase our output by contribution amount
    // The output value needs to be updated
    const newOutputValue = paymentAmount + contributionAmount;
    proposalPsbt.txOutputs[ourOutputIndex].value = newOutputValue;

    // Note: In a full implementation, we would sign our input here
    // For now, we return the unsigned proposal
    // The receiver would need to sign with their key

    log.info('Payjoin proposal created', {
      addressId,
      paymentAmount,
      contributionAmount,
      newOutputValue,
    });

    return {
      success: true,
      proposalPsbt: proposalPsbt.toBase64(),
    };
  } catch (error) {
    log.error('Error processing Payjoin request', { error: String(error) });
    return {
      success: false,
      error: PayjoinErrors.RECEIVER_ERROR,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Select a UTXO to contribute to a Payjoin transaction
 *
 * Selection criteria:
 * - Prefer similar amount to payment (privacy)
 * - Avoid dust
 * - Require confirmations
 * - Not frozen or locked
 */
async function selectContributionUtxo(
  walletId: string,
  paymentAmount: number
): Promise<{
  id: string;
  txid: string;
  vout: number;
  amount: bigint;
  scriptPubKey: string;
} | null> {
  // Get available UTXOs
  const utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
      confirmations: { gt: 0 },
      draftLock: null, // Not locked by a draft
    },
    select: {
      id: true,
      txid: true,
      vout: true,
      amount: true,
      scriptPubKey: true,
    },
    orderBy: { amount: 'asc' },
  });

  if (utxos.length === 0) return null;

  // Prefer UTXO closest in size to payment amount (within 2x)
  // This improves privacy by making it unclear which output is payment/change
  const targetMin = paymentAmount / 2;
  const targetMax = paymentAmount * 2;

  const candidates = utxos.filter(u => {
    const amount = Number(u.amount);
    return amount >= targetMin && amount <= targetMax && amount > 1000; // Avoid dust
  });

  if (candidates.length > 0) {
    // Sort by closest to payment amount
    candidates.sort((a, b) => {
      const diffA = Math.abs(Number(a.amount) - paymentAmount);
      const diffB = Math.abs(Number(b.amount) - paymentAmount);
      return diffA - diffB;
    });
    return candidates[0];
  }

  // Fallback: use largest UTXO that's not dust
  const nonDust = utxos.filter(u => Number(u.amount) > 1000);
  if (nonDust.length > 0) {
    return nonDust[nonDust.length - 1]; // Largest
  }

  return null;
}

/**
 * Attempt to send a Payjoin transaction
 *
 * Steps:
 * 1. Build original PSBT
 * 2. POST to receiver's Payjoin endpoint
 * 3. Validate the proposal
 * 4. Return proposal for signing
 */
export async function attemptPayjoinSend(
  originalPsbtBase64: string,
  payjoinUrl: string,
  senderInputIndices: number[],
  network: bitcoin.Network = bitcoin.networks.bitcoin
): Promise<{
  success: boolean;
  proposalPsbt?: string;
  isPayjoin: boolean;
  error?: string;
}> {
  try {
    log.info('Attempting Payjoin send', { payjoinUrl });

    // Validate the Payjoin URL (SSRF protection)
    const urlValidation = await validatePayjoinUrl(payjoinUrl);
    if (!urlValidation.valid) {
      log.warn('Payjoin URL validation failed', { payjoinUrl, error: urlValidation.error });
      return {
        success: false,
        isPayjoin: false,
        error: urlValidation.error || 'Invalid Payjoin URL',
      };
    }

    // POST original PSBT to receiver
    const response = await fetch(payjoinUrl + '?v=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: originalPsbtBase64,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.warn('Payjoin endpoint returned error', { status: response.status, error: errorText });
      return {
        success: false,
        isPayjoin: false,
        error: `Payjoin endpoint error: ${errorText}`,
      };
    }

    const proposalBase64 = await response.text();

    // Validate the proposal
    const validation = validatePayjoinProposal(
      originalPsbtBase64,
      proposalBase64,
      senderInputIndices,
      network
    );

    if (!validation.valid) {
      log.warn('Payjoin proposal validation failed', { errors: validation.errors });
      return {
        success: false,
        isPayjoin: false,
        error: `Invalid proposal: ${validation.errors.join(', ')}`,
      };
    }

    if (validation.warnings.length > 0) {
      log.info('Payjoin proposal warnings', { warnings: validation.warnings });
    }

    log.info('Payjoin proposal received and validated');

    return {
      success: true,
      proposalPsbt: proposalBase64,
      isPayjoin: true,
    };
  } catch (error) {
    log.error('Payjoin send attempt failed', { error: String(error) });
    return {
      success: false,
      isPayjoin: false,
      error: error instanceof Error ? error.message : 'Payjoin failed',
    };
  }
}

/**
 * Parse a BIP21 URI and extract Payjoin URL if present
 */
export function parseBip21Uri(uri: string): {
  address: string;
  amount?: number;
  label?: string;
  message?: string;
  payjoinUrl?: string;
} {
  // Handle bitcoin: prefix
  let cleanUri = uri;
  if (cleanUri.toLowerCase().startsWith('bitcoin:')) {
    cleanUri = cleanUri.substring(8);
  }

  // Split address and params
  const [addressPart, paramsPart] = cleanUri.split('?');
  const address = addressPart;

  const result: ReturnType<typeof parseBip21Uri> = { address };

  if (paramsPart) {
    const params = new URLSearchParams(paramsPart);

    if (params.has('amount')) {
      result.amount = parseFloat(params.get('amount')!) * 100_000_000; // BTC to sats
    }
    if (params.has('label')) {
      result.label = decodeURIComponent(params.get('label')!);
    }
    if (params.has('message')) {
      result.message = decodeURIComponent(params.get('message')!);
    }
    if (params.has('pj')) {
      result.payjoinUrl = decodeURIComponent(params.get('pj')!);
    }
  }

  return result;
}

/**
 * Generate a BIP21 URI with optional Payjoin endpoint
 */
export function generateBip21Uri(
  address: string,
  options?: {
    amount?: number; // in satoshis
    label?: string;
    message?: string;
    payjoinUrl?: string;
  }
): string {
  let uri = `bitcoin:${address}`;
  const params: string[] = [];

  if (options?.amount) {
    params.push(`amount=${(options.amount / 100_000_000).toFixed(8)}`);
  }
  if (options?.label) {
    params.push(`label=${encodeURIComponent(options.label)}`);
  }
  if (options?.message) {
    params.push(`message=${encodeURIComponent(options.message)}`);
  }
  if (options?.payjoinUrl) {
    params.push(`pj=${encodeURIComponent(options.payjoinUrl)}`);
  }

  if (params.length > 0) {
    uri += '?' + params.join('&');
  }

  return uri;
}
