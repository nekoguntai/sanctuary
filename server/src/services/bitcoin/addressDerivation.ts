/**
 * Address Derivation Service
 *
 * Handles proper address derivation from xpubs and descriptors
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

const bip32 = BIP32Factory(ecc);

/**
 * Parse output descriptor to extract xpub and derivation info
 * Supports various descriptor formats:
 * - wpkh([fingerprint/84'/0'/0']xpub.../0/*)
 * - sh(wpkh([fingerprint/49'/0'/0']xpub.../0/*))
 * - tr([fingerprint/86'/0'/0']xpub.../0/*)
 */
export function parseDescriptor(descriptor: string): {
  type: 'wpkh' | 'sh-wpkh' | 'tr' | 'pkh';
  xpub: string;
  path: string;
  fingerprint?: string;
  accountPath?: string;
} {
  // Remove whitespace
  descriptor = descriptor.trim();

  // Detect script type
  let type: 'wpkh' | 'sh-wpkh' | 'tr' | 'pkh';
  if (descriptor.startsWith('wpkh(')) {
    type = 'wpkh';
  } else if (descriptor.startsWith('sh(wpkh(')) {
    type = 'sh-wpkh';
  } else if (descriptor.startsWith('tr(')) {
    type = 'tr';
  } else if (descriptor.startsWith('pkh(')) {
    type = 'pkh';
  } else {
    throw new Error('Unsupported descriptor format');
  }

  // Extract the key expression [fingerprint/path]xpub
  const keyExpressionMatch = descriptor.match(/\[([a-f0-9]{8})\/([^\]]+)\]([xyztuvYZTUV]pub[a-zA-Z0-9]+)/);

  if (!keyExpressionMatch) {
    // Try without fingerprint
    const simpleMatch = descriptor.match(/([xyztuvYZTUV]pub[a-zA-Z0-9]+)/);
    if (!simpleMatch) {
      throw new Error('Could not parse xpub from descriptor');
    }

    return {
      type,
      xpub: simpleMatch[1],
      path: '0/*', // Default to external chain
    };
  }

  const [, fingerprint, accountPath, xpub] = keyExpressionMatch;

  // Extract the derivation path after xpub (e.g., /0/*)
  const pathMatch = descriptor.match(/[xyztuvYZTUV]pub[a-zA-Z0-9]+\/([0-9/*]+)/);
  const path = pathMatch ? pathMatch[1] : '0/*';

  return {
    type,
    xpub,
    path,
    fingerprint,
    accountPath,
  };
}

/**
 * Derive an address from xpub at a specific index
 */
export function deriveAddress(
  xpub: string,
  index: number,
  options: {
    scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
    network?: 'mainnet' | 'testnet' | 'regtest';
    change?: boolean; // false = external (receive), true = internal (change)
  } = {}
): {
  address: string;
  derivationPath: string;
  publicKey: Buffer;
} {
  const {
    scriptType = 'native_segwit',
    network = 'mainnet',
    change = false,
  } = options;

  const networkObj = getNetwork(network);

  // Parse xpub
  const node = bip32.fromBase58(xpub, networkObj);

  // Derive address: m/<change>/<index>
  const changeIndex = change ? 1 : 0;
  const derived = node.derive(changeIndex).derive(index);

  if (!derived.publicKey) {
    throw new Error('Failed to derive public key');
  }

  let address: string;
  let derivationPath: string;

  // Get account path from xpub (standard paths)
  const accountPath = getAccountPath(xpub, scriptType, network);
  derivationPath = `${accountPath}/${changeIndex}/${index}`;

  // Generate address based on script type
  switch (scriptType) {
    case 'native_segwit': {
      // P2WPKH (bech32)
      const payment = bitcoin.payments.p2wpkh({
        pubkey: derived.publicKey,
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    case 'nested_segwit': {
      // P2SH-P2WPKH (starts with 3)
      const payment = bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wpkh({
          pubkey: derived.publicKey,
          network: networkObj,
        }),
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    case 'taproot': {
      // P2TR (bech32m)
      const payment = bitcoin.payments.p2tr({
        internalPubkey: derived.publicKey.slice(1, 33), // Remove 0x02/0x03 prefix
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    case 'legacy': {
      // P2PKH (starts with 1)
      const payment = bitcoin.payments.p2pkh({
        pubkey: derived.publicKey,
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    default:
      throw new Error(`Unsupported script type: ${scriptType}`);
  }

  return {
    address,
    derivationPath,
    publicKey: derived.publicKey,
  };
}

/**
 * Derive address from descriptor
 */
export function deriveAddressFromDescriptor(
  descriptor: string,
  index: number,
  options: {
    network?: 'mainnet' | 'testnet' | 'regtest';
    change?: boolean;
  } = {}
): {
  address: string;
  derivationPath: string;
  publicKey: Buffer;
} {
  const parsed = parseDescriptor(descriptor);
  const { network = 'mainnet', change = false } = options;

  // Map descriptor type to script type
  const scriptTypeMap: Record<typeof parsed.type, 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy'> = {
    wpkh: 'native_segwit',
    'sh-wpkh': 'nested_segwit',
    tr: 'taproot',
    pkh: 'legacy',
  };

  const scriptType = scriptTypeMap[parsed.type];

  return deriveAddress(parsed.xpub, index, {
    scriptType,
    network,
    change,
  });
}

/**
 * Get network object from network string
 */
function getNetwork(network: 'mainnet' | 'testnet' | 'regtest'): bitcoin.Network {
  switch (network) {
    case 'testnet':
      return bitcoin.networks.testnet;
    case 'regtest':
      return bitcoin.networks.regtest;
    default:
      return bitcoin.networks.bitcoin;
  }
}

/**
 * Get standard account path for xpub
 */
function getAccountPath(
  xpub: string,
  scriptType: string,
  network: 'mainnet' | 'testnet' | 'regtest'
): string {
  // Standard BIP44/49/84/86 paths
  const coinType = network === 'mainnet' ? '0' : '1';

  // Try to detect from xpub prefix
  if (xpub.startsWith('xpub')) {
    // Could be legacy or nested segwit
    if (scriptType === 'nested_segwit') {
      return `m/49'/${coinType}'/0'`; // BIP49
    } else {
      return `m/44'/${coinType}'/0'`; // BIP44
    }
  } else if (xpub.startsWith('ypub')) {
    return `m/49'/${coinType}'/0'`; // BIP49 - nested segwit
  } else if (xpub.startsWith('zpub')) {
    return `m/84'/${coinType}'/0'`; // BIP84 - native segwit
  } else if (xpub.startsWith('Zpub') || xpub.startsWith('Ypub')) {
    // Multisig versions
    if (scriptType === 'nested_segwit') {
      return `m/49'/${coinType}'/0'`;
    } else {
      return `m/84'/${coinType}'/0'`;
    }
  }

  // Default to native segwit path
  return `m/84'/${coinType}'/0'`;
}

/**
 * Validate xpub format
 */
export function validateXpub(xpub: string, network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'): {
  valid: boolean;
  error?: string;
  scriptType?: 'native_segwit' | 'nested_segwit' | 'legacy';
} {
  try {
    const networkObj = getNetwork(network);
    bip32.fromBase58(xpub, networkObj);

    // Detect script type from prefix
    let scriptType: 'native_segwit' | 'nested_segwit' | 'legacy' = 'native_segwit';
    if (xpub.startsWith('ypub') || xpub.startsWith('Ypub')) {
      scriptType = 'nested_segwit';
    } else if (xpub.startsWith('xpub')) {
      scriptType = 'legacy'; // Could be either, but default to legacy
    } else if (xpub.startsWith('zpub') || xpub.startsWith('Zpub')) {
      scriptType = 'native_segwit';
    }

    return { valid: true, scriptType };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Invalid xpub format',
    };
  }
}

/**
 * Derive multiple addresses at once
 */
export function deriveAddresses(
  xpub: string,
  startIndex: number,
  count: number,
  options: {
    scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
    network?: 'mainnet' | 'testnet' | 'regtest';
    change?: boolean;
  } = {}
): Array<{
  address: string;
  derivationPath: string;
  index: number;
}> {
  const addresses: Array<{
    address: string;
    derivationPath: string;
    index: number;
  }> = [];

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const { address, derivationPath } = deriveAddress(xpub, index, options);
    addresses.push({ address, derivationPath, index });
  }

  return addresses;
}
