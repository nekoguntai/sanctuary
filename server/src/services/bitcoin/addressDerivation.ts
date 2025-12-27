/**
 * Address Derivation Service
 *
 * Handles proper address derivation from xpubs and descriptors
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import bs58check from 'bs58check';

const bip32 = BIP32Factory(ecc);

/**
 * Version bytes for different extended key formats (SLIP-132)
 * These are the 4-byte prefixes that determine the key format
 */
const XPUB_VERSIONS: Record<string, { prefix: string; targetPrefix: string; targetVersion: Buffer }> = {
  // Mainnet
  'xpub': { prefix: 'xpub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) },
  'ypub': { prefix: 'ypub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) }, // BIP49 nested segwit
  'zpub': { prefix: 'zpub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) }, // BIP84 native segwit
  'Ypub': { prefix: 'Ypub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) }, // Multisig nested segwit
  'Zpub': { prefix: 'Zpub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) }, // Multisig native segwit
  // Testnet
  'tpub': { prefix: 'tpub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) },
  'upub': { prefix: 'upub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) }, // BIP49 nested segwit
  'vpub': { prefix: 'vpub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) }, // BIP84 native segwit
  'Upub': { prefix: 'Upub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) }, // Multisig nested segwit
  'Vpub': { prefix: 'Vpub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) }, // Multisig native segwit
};

/**
 * Convert extended public key to standard xpub/tpub format
 * This handles zpub, ypub, Zpub, Ypub, vpub, upub, Vpub, Upub formats
 * which use different version bytes but contain the same key material
 */
export function convertToStandardXpub(extendedKey: string): string {
  // Detect the prefix (first 4 characters)
  const prefix = extendedKey.slice(0, 4);
  const versionInfo = XPUB_VERSIONS[prefix];

  // If already standard format or unknown, return as-is
  if (!versionInfo || prefix === versionInfo.targetPrefix) {
    return extendedKey;
  }

  try {
    // Decode the base58check encoded key
    const decoded = bs58check.decode(extendedKey);

    // Replace the version bytes (first 4 bytes) with target version
    const converted = Buffer.concat([
      versionInfo.targetVersion,
      decoded.slice(4)
    ]);

    // Re-encode with base58check
    return bs58check.encode(converted);
  } catch (error) {
    // If conversion fails, return original and let downstream handle the error
    return extendedKey;
  }
}

/**
 * Multisig key info extracted from descriptor
 */
export interface MultisigKeyInfo {
  fingerprint: string;
  accountPath: string;
  xpub: string;
  derivationPath: string;
}

/**
 * Parsed descriptor result
 */
export interface ParsedDescriptor {
  type: 'wpkh' | 'sh-wpkh' | 'tr' | 'pkh' | 'wsh-sortedmulti' | 'sh-wsh-sortedmulti';
  xpub?: string;
  path?: string;
  fingerprint?: string;
  accountPath?: string;
  // Multisig specific
  quorum?: number;
  keys?: MultisigKeyInfo[];
}

/**
 * Parse output descriptor to extract xpub and derivation info
 * Supports various descriptor formats:
 * - wpkh([fingerprint/84'/0'/0']xpub.../0/*)
 * - sh(wpkh([fingerprint/49'/0'/0']xpub.../0/*))
 * - tr([fingerprint/86'/0'/0']xpub.../0/*)
 * - wsh(sortedmulti(M,[fp/path]xpub/0/*,[fp/path]xpub/0/*,...))
 * - sh(wsh(sortedmulti(...)))
 */
export function parseDescriptor(descriptor: string): ParsedDescriptor {
  // Remove whitespace
  descriptor = descriptor.trim();

  // Detect script type
  let type: ParsedDescriptor['type'];

  // Check for multisig first
  if (descriptor.startsWith('wsh(sortedmulti(') || descriptor.startsWith('wsh(multi(')) {
    return parseMultisigDescriptor(descriptor, 'wsh-sortedmulti');
  } else if (descriptor.startsWith('sh(wsh(sortedmulti(') || descriptor.startsWith('sh(wsh(multi(')) {
    return parseMultisigDescriptor(descriptor, 'sh-wsh-sortedmulti');
  } else if (descriptor.startsWith('wpkh(')) {
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
 * Parse multisig descriptor to extract all keys and quorum
 */
function parseMultisigDescriptor(
  descriptor: string,
  type: 'wsh-sortedmulti' | 'sh-wsh-sortedmulti'
): ParsedDescriptor {
  // Extract quorum (the M in M-of-N)
  const quorumMatch = descriptor.match(/(?:sorted)?multi\((\d+),/);
  if (!quorumMatch) {
    throw new Error('Could not parse quorum from multisig descriptor');
  }
  const quorum = parseInt(quorumMatch[1], 10);

  // Extract all key expressions: [fingerprint/path]xpub/derivation
  const keyRegex = /\[([a-f0-9]{8})\/([^\]]+)\]([xyztuvYZTUV]pub[a-zA-Z0-9]+)(?:\/([0-9/*]+))?/g;
  const keys: MultisigKeyInfo[] = [];

  let match;
  while ((match = keyRegex.exec(descriptor)) !== null) {
    keys.push({
      fingerprint: match[1],
      accountPath: match[2],
      xpub: match[3],
      derivationPath: match[4] || '0/*',
    });
  }

  if (keys.length === 0) {
    throw new Error('Could not parse keys from multisig descriptor');
  }

  return {
    type,
    quorum,
    keys,
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

  // Convert zpub/ypub/etc to standard xpub format for parsing
  const standardXpub = convertToStandardXpub(xpub);

  // Parse xpub
  const node = bip32.fromBase58(standardXpub, networkObj);

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

  // Handle multisig descriptors
  if (parsed.type === 'wsh-sortedmulti' || parsed.type === 'sh-wsh-sortedmulti') {
    return deriveMultisigAddress(parsed, index, { network, change });
  }

  // Map descriptor type to script type for single-sig
  const scriptTypeMap: Record<'wpkh' | 'sh-wpkh' | 'tr' | 'pkh', 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy'> = {
    wpkh: 'native_segwit',
    'sh-wpkh': 'nested_segwit',
    tr: 'taproot',
    pkh: 'legacy',
  };

  const scriptType = scriptTypeMap[parsed.type as 'wpkh' | 'sh-wpkh' | 'tr' | 'pkh'];

  if (!parsed.xpub) {
    throw new Error('No xpub found in descriptor');
  }

  return deriveAddress(parsed.xpub, index, {
    scriptType,
    network,
    change,
  });
}

/**
 * Derive multisig address from parsed descriptor
 */
function deriveMultisigAddress(
  parsed: ParsedDescriptor,
  index: number,
  options: {
    network: 'mainnet' | 'testnet' | 'regtest';
    change: boolean;
  }
): {
  address: string;
  derivationPath: string;
  publicKey: Buffer;
} {
  const { network, change } = options;
  const networkObj = getNetwork(network);

  if (!parsed.keys || parsed.keys.length === 0) {
    throw new Error('No keys found in multisig descriptor');
  }
  if (parsed.quorum === undefined) {
    throw new Error('No quorum found in multisig descriptor');
  }

  const changeIndex = change ? 1 : 0;

  // Derive public keys from each xpub at the given index
  const pubkeys: Buffer[] = [];
  for (const keyInfo of parsed.keys) {
    // Convert zpub/ypub/Zpub/Ypub to standard xpub format for parsing
    const standardXpub = convertToStandardXpub(keyInfo.xpub);
    const node = bip32.fromBase58(standardXpub, networkObj);
    // Derivation path after xpub is typically <0;1>/* or 0/* (external/internal)
    // Handle both formats:
    // - "0/*" -> derive at 0/index (receive only)
    // - "<0;1>/*" -> derive at changeIndex/index (both receive and change)
    // - "/*" -> derive at changeIndex/index (assumes change prefix needed)
    let pathStr = keyInfo.derivationPath;

    // Replace <0;1> with the appropriate change index
    if (pathStr.includes('<0;1>')) {
      pathStr = pathStr.replace('<0;1>', String(changeIndex));
    } else if (pathStr.startsWith('0/') || pathStr.startsWith('1/')) {
      // Path already has explicit change index, replace the first number with our change index
      pathStr = String(changeIndex) + pathStr.slice(1);
    } else if (pathStr === '*' || pathStr === '/*') {
      // No change prefix, add it
      pathStr = `${changeIndex}/${index}`;
    }

    // Replace * with index
    pathStr = pathStr.replace('*', String(index));

    const pathParts = pathStr.split('/');
    let derived = node;
    for (const part of pathParts) {
      if (part === '') continue;
      const idx = parseInt(part, 10);
      if (!isNaN(idx)) {
        derived = derived.derive(idx);
      }
    }
    if (!derived.publicKey) {
      throw new Error('Failed to derive public key from xpub');
    }
    pubkeys.push(derived.publicKey);
  }

  // Sort public keys for sortedmulti (lexicographic order)
  pubkeys.sort((a, b) => a.compare(b));

  // Create the multisig redeem script (p2ms)
  const p2ms = bitcoin.payments.p2ms({
    m: parsed.quorum,
    pubkeys,
    network: networkObj,
  });

  let address: string;

  if (parsed.type === 'wsh-sortedmulti') {
    // P2WSH (native segwit multisig)
    const p2wsh = bitcoin.payments.p2wsh({
      redeem: p2ms,
      network: networkObj,
    });
    if (!p2wsh.address) throw new Error('Failed to generate P2WSH address');
    address = p2wsh.address;
  } else {
    // P2SH-P2WSH (nested segwit multisig)
    const p2wsh = bitcoin.payments.p2wsh({
      redeem: p2ms,
      network: networkObj,
    });
    const p2sh = bitcoin.payments.p2sh({
      redeem: p2wsh,
      network: networkObj,
    });
    if (!p2sh.address) throw new Error('Failed to generate P2SH-P2WSH address');
    address = p2sh.address;
  }

  // Build derivation path string (use first key's path as reference)
  const firstKey = parsed.keys[0];
  const derivationPath = `m/${firstKey.accountPath}/${changeIndex}/${index}`;

  return {
    address,
    derivationPath,
    publicKey: pubkeys[0], // Return first sorted pubkey as reference
  };
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
    // xpub can be used for any script type - use scriptType to determine path
    if (scriptType === 'native_segwit') {
      return `m/84'/${coinType}'/0'`; // BIP84 - native segwit
    } else if (scriptType === 'nested_segwit') {
      return `m/49'/${coinType}'/0'`; // BIP49
    } else if (scriptType === 'taproot') {
      return `m/86'/${coinType}'/0'`; // BIP86
    } else {
      return `m/44'/${coinType}'/0'`; // BIP44 - legacy
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

    // Convert zpub/ypub/etc to standard xpub format for validation
    const standardXpub = convertToStandardXpub(xpub);
    bip32.fromBase58(standardXpub, networkObj);

    // Detect script type from original prefix
    let scriptType: 'native_segwit' | 'nested_segwit' | 'legacy' = 'native_segwit';
    if (xpub.startsWith('ypub') || xpub.startsWith('Ypub') || xpub.startsWith('upub') || xpub.startsWith('Upub')) {
      scriptType = 'nested_segwit';
    } else if (xpub.startsWith('xpub') || xpub.startsWith('tpub')) {
      scriptType = 'legacy'; // Could be either, but default to legacy
    } else if (xpub.startsWith('zpub') || xpub.startsWith('Zpub') || xpub.startsWith('vpub') || xpub.startsWith('Vpub')) {
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

/**
 * Derive multiple addresses from descriptor at once
 */
export function deriveAddressesFromDescriptor(
  descriptor: string,
  startIndex: number,
  count: number,
  options: {
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
    const { address, derivationPath } = deriveAddressFromDescriptor(descriptor, index, options);
    addresses.push({ address, derivationPath, index });
  }

  return addresses;
}
