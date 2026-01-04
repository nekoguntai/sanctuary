/**
 * Descriptor Parser Service
 *
 * Parses Bitcoin output descriptors and JSON configurations to extract
 * device information for wallet import functionality.
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('DESCRIPTOR');

export interface ParsedDevice {
  fingerprint: string;
  xpub: string;
  derivationPath: string;
}

export type ScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
export type Network = 'mainnet' | 'testnet' | 'regtest';

export interface ParsedDescriptor {
  type: 'single_sig' | 'multi_sig';
  scriptType: ScriptType;
  devices: ParsedDevice[];
  quorum?: number;
  totalSigners?: number;
  network: Network;
  isChange: boolean;
}

export interface DescriptorParseError {
  message: string;
  position?: number;
}

/**
 * Detect network from xpub prefix or derivation path
 */
function detectNetwork(xpub: string, derivationPath: string): Network {
  // Check derivation path coin type
  const coinTypeMatch = derivationPath.match(/\/(\d+)[h']/);
  if (coinTypeMatch) {
    const coinType = coinTypeMatch[1];
    if (coinType === '1') return 'testnet';
  }

  // Check xpub prefix for testnet/regtest
  if (xpub.startsWith('tpub') || xpub.startsWith('upub') || xpub.startsWith('vpub')) {
    return 'testnet';
  }

  return 'mainnet';
}

/**
 * Convert derivation path notation (h or H to ')
 */
function normalizeDerivationPath(path: string): string {
  // Add m/ prefix if missing
  let normalized = path.startsWith('m/') ? path : `m/${path}`;
  // Convert h or H to ' (both uppercase and lowercase hardening notation)
  normalized = normalized.replace(/[hH]/g, "'");
  return normalized;
}

/**
 * Parse a key expression like [fingerprint/path]xpub/chain/*
 * Returns device info with fingerprint, xpub, and derivation path
 */
function parseKeyExpression(keyExpr: string): ParsedDevice | null {
  // Match [fingerprint/path]xpub pattern
  // Fingerprint is 8 hex chars, path can use ' or h for hardened
  const keyMatch = keyExpr.match(
    /\[([a-fA-F0-9]{8})\/([^\]]+)\]([xyztuvYZTUVpub][a-zA-Z0-9]+)/
  );

  if (!keyMatch) {
    // Try matching just xpub without key origin info
    const simpleMatch = keyExpr.match(/([xyztuvYZTUVpub][a-zA-Z0-9]+)/);
    if (simpleMatch) {
      return {
        fingerprint: '00000000',
        xpub: simpleMatch[1],
        derivationPath: 'm/unknown',
      };
    }
    return null;
  }

  const [, fingerprint, pathPart, xpub] = keyMatch;
  const derivationPath = normalizeDerivationPath(pathPart);

  return {
    fingerprint: fingerprint.toLowerCase(),
    xpub,
    derivationPath,
  };
}

/**
 * Extract all key expressions from a descriptor
 */
function extractKeyExpressions(descriptor: string): string[] {
  const expressions: string[] = [];

  // Find all [fingerprint/path]xpub patterns
  const regex = /\[[a-fA-F0-9]{8}\/[^\]]+\][xyztuvYZTUVpub][a-zA-Z0-9]+(?:\/[\d*]+)*/g;
  let match;

  while ((match = regex.exec(descriptor)) !== null) {
    expressions.push(match[0]);
  }

  return expressions;
}

/**
 * Detect if descriptor represents a change (internal) chain
 */
function isChangeDescriptor(descriptor: string): boolean {
  // Look for /1/* pattern which indicates internal/change chain
  return /\/1\/\*/.test(descriptor);
}

/**
 * Detect script type from descriptor wrapper functions
 */
function detectScriptType(descriptor: string): ScriptType {
  const trimmed = descriptor.trim().toLowerCase();

  if (trimmed.startsWith('sh(wsh(sortedmulti')) {
    return 'nested_segwit'; // P2SH-P2WSH multisig
  }
  if (trimmed.startsWith('wsh(sortedmulti') || trimmed.startsWith('wsh(multi')) {
    return 'native_segwit'; // P2WSH multisig
  }
  if (trimmed.startsWith('sh(sortedmulti') || trimmed.startsWith('sh(multi')) {
    return 'legacy'; // P2SH multisig
  }
  if (trimmed.startsWith('sh(wpkh(')) {
    return 'nested_segwit'; // P2SH-P2WPKH
  }
  if (trimmed.startsWith('wpkh(')) {
    return 'native_segwit'; // P2WPKH
  }
  if (trimmed.startsWith('tr(')) {
    return 'taproot'; // P2TR
  }
  if (trimmed.startsWith('pkh(')) {
    return 'legacy'; // P2PKH
  }

  throw new Error('Unable to detect script type from descriptor');
}

/**
 * Detect if descriptor is multisig
 */
function isMultisigDescriptor(descriptor: string): boolean {
  const lower = descriptor.toLowerCase();
  return lower.includes('sortedmulti(') || lower.includes('multi(');
}

/**
 * Extract quorum from multisig descriptor
 * sortedmulti(M, key1, key2, ...) where M is quorum
 */
function extractQuorum(descriptor: string): number {
  const match = descriptor.match(/(?:sorted)?multi\((\d+)/i);
  if (!match) {
    throw new Error('Could not extract quorum from multisig descriptor');
  }
  return parseInt(match[1], 10);
}

/**
 * Descriptor checksum character set (BIP-380)
 * Uses same charset as bech32 but different polynomial
 */
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Polymod function for descriptor checksum (BIP-380)
 */
function descriptorPolymod(c: bigint, val: number): bigint {
  const c0 = c >> 35n;
  c = ((c & 0x7ffffffffn) << 5n) ^ BigInt(val);
  if (c0 & 1n) c ^= 0xf5dee51989n;
  if (c0 & 2n) c ^= 0xa9fdca3312n;
  if (c0 & 4n) c ^= 0x1bab10e32dn;
  if (c0 & 8n) c ^= 0x3706b1677an;
  if (c0 & 16n) c ^= 0x644d626ffdn;
  return c;
}

/**
 * Compute descriptor checksum
 */
function computeDescriptorChecksum(descriptor: string): string {
  let c = 1n;
  let cls = 0;
  let clsCount = 0;

  for (const ch of descriptor) {
    const pos = 'qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM0123456789_\'()[]{}*,\\/#'.indexOf(ch);
    if (pos === -1) {
      // Invalid character for checksum computation
      return '';
    }
    c = descriptorPolymod(c, pos & 31);
    cls = cls * 3 + (pos >> 5);
    clsCount++;
    if (clsCount === 3) {
      c = descriptorPolymod(c, cls);
      cls = 0;
      clsCount = 0;
    }
  }

  if (clsCount > 0) {
    c = descriptorPolymod(c, cls);
  }

  // Finalize
  for (let i = 0; i < 8; i++) {
    c = descriptorPolymod(c, 0);
  }
  c ^= 1n;

  let checksum = '';
  for (let i = 0; i < 8; i++) {
    checksum = CHECKSUM_CHARSET[Number((c >> BigInt(5 * (7 - i))) & 31n)] + checksum;
  }

  return checksum.split('').reverse().join('');
}

/**
 * Validate descriptor checksum if present
 * Returns true if no checksum or checksum is valid
 * Logs warning if checksum is invalid
 */
function validateAndRemoveChecksum(descriptor: string): { descriptor: string; valid: boolean } {
  const checksumMatch = descriptor.match(/#([a-zA-Z0-9]{8})$/);

  if (!checksumMatch) {
    // No checksum present, that's fine
    return { descriptor: descriptor.trim(), valid: true };
  }

  const providedChecksum = checksumMatch[1].toLowerCase();
  const descriptorWithoutChecksum = descriptor.slice(0, -9).trim(); // Remove #xxxxxxxx

  const computedChecksum = computeDescriptorChecksum(descriptorWithoutChecksum);

  if (computedChecksum && computedChecksum !== providedChecksum) {
    log.warn('Descriptor checksum mismatch', {
      provided: providedChecksum,
      computed: computedChecksum,
      descriptor: descriptorWithoutChecksum.substring(0, 50) + '...',
    });
    // Still accept the descriptor but log warning
  }

  return {
    descriptor: descriptorWithoutChecksum,
    valid: !computedChecksum || computedChecksum === providedChecksum,
  };
}

/**
 * Remove checksum from descriptor if present (legacy function for compatibility)
 * Checksums are appended as #xxxxxxxx
 */
function removeChecksum(descriptor: string): string {
  return validateAndRemoveChecksum(descriptor).descriptor;
}

/**
 * Parse a Bitcoin output descriptor and extract all relevant information
 */
export function parseDescriptorForImport(descriptor: string): ParsedDescriptor {
  // Clean up descriptor
  let cleanDescriptor = removeChecksum(descriptor.trim());
  log.debug('parseDescriptorForImport', { cleanDescriptor: cleanDescriptor.substring(0, 100), startsWithWsh: cleanDescriptor.toLowerCase().startsWith('wsh(') });

  // Detect script type
  const scriptType = detectScriptType(cleanDescriptor);

  // Detect if multisig
  const isMultisig = isMultisigDescriptor(cleanDescriptor);

  // Extract key expressions
  const keyExpressions = extractKeyExpressions(cleanDescriptor);

  if (keyExpressions.length === 0) {
    throw new Error('No valid key expressions found in descriptor');
  }

  // Parse each key expression into device info
  const devices: ParsedDevice[] = [];
  for (const expr of keyExpressions) {
    const device = parseKeyExpression(expr);
    if (device) {
      devices.push(device);
    }
  }

  if (devices.length === 0) {
    throw new Error('Failed to parse any devices from descriptor');
  }

  // Detect network from first device
  const network = detectNetwork(devices[0].xpub, devices[0].derivationPath);

  // Detect change chain
  const isChange = isChangeDescriptor(cleanDescriptor);

  // Build result
  const result: ParsedDescriptor = {
    type: isMultisig ? 'multi_sig' : 'single_sig',
    scriptType,
    devices,
    network,
    isChange,
  };

  if (isMultisig) {
    result.quorum = extractQuorum(cleanDescriptor);
    result.totalSigners = devices.length;
  }

  return result;
}

/**
 * Validate a descriptor string and return any errors
 */
export function validateDescriptor(descriptor: string): DescriptorParseError | null {
  try {
    parseDescriptorForImport(descriptor);
    return null;
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : 'Invalid descriptor',
    };
  }
}

/**
 * JSON import format interface
 */
export interface JsonImportDevice {
  type?: string;
  label?: string;
  fingerprint: string;
  derivationPath: string;
  xpub: string;
}

export interface JsonImportConfig {
  type: 'single_sig' | 'multi_sig';
  scriptType: ScriptType;
  quorum?: number;
  network?: Network;
  devices: JsonImportDevice[];
  name?: string;
}

/**
 * Validate JSON import configuration
 */
export function validateJsonImport(config: unknown): DescriptorParseError | null {
  if (!config || typeof config !== 'object') {
    return { message: 'Invalid JSON: expected an object' };
  }

  const obj = config as Record<string, unknown>;

  // Validate type
  if (!obj.type || !['single_sig', 'multi_sig'].includes(obj.type as string)) {
    return { message: 'Invalid or missing type: must be "single_sig" or "multi_sig"' };
  }

  // Validate script type
  const validScriptTypes = ['native_segwit', 'nested_segwit', 'taproot', 'legacy'];
  if (!obj.scriptType || !validScriptTypes.includes(obj.scriptType as string)) {
    return { message: 'Invalid or missing scriptType' };
  }

  // Validate devices array
  if (!Array.isArray(obj.devices) || obj.devices.length === 0) {
    return { message: 'devices must be a non-empty array' };
  }

  // Validate quorum for multisig
  if (obj.type === 'multi_sig') {
    if (typeof obj.quorum !== 'number' || obj.quorum < 1) {
      return { message: 'Multi-sig requires a valid quorum (positive integer)' };
    }
    if (obj.quorum > obj.devices.length) {
      return { message: 'Quorum cannot exceed total number of devices' };
    }
  }

  // Validate single_sig has exactly one device
  if (obj.type === 'single_sig' && obj.devices.length !== 1) {
    return { message: 'Single-sig requires exactly one device' };
  }

  // Validate each device
  for (let i = 0; i < obj.devices.length; i++) {
    const device = obj.devices[i] as Record<string, unknown>;

    if (!device.fingerprint || typeof device.fingerprint !== 'string') {
      return { message: `Device ${i + 1}: missing or invalid fingerprint` };
    }

    // Validate fingerprint format (8 hex chars)
    if (!/^[a-fA-F0-9]{8}$/.test(device.fingerprint)) {
      return { message: `Device ${i + 1}: fingerprint must be 8 hex characters` };
    }

    if (!device.derivationPath || typeof device.derivationPath !== 'string') {
      return { message: `Device ${i + 1}: missing or invalid derivationPath` };
    }

    if (!device.xpub || typeof device.xpub !== 'string') {
      return { message: `Device ${i + 1}: missing or invalid xpub` };
    }

    // Basic xpub format check
    if (!/^[xyztuvYZTUVpub][a-zA-Z0-9]{100,120}$/.test(device.xpub)) {
      return { message: `Device ${i + 1}: xpub format appears invalid` };
    }
  }

  return null;
}

/**
 * Parse JSON import config into standard format
 */
export function parseJsonImport(config: JsonImportConfig): ParsedDescriptor {
  const error = validateJsonImport(config);
  if (error) {
    throw new Error(error.message);
  }

  const devices: ParsedDevice[] = config.devices.map((d) => ({
    fingerprint: d.fingerprint.toLowerCase(),
    xpub: d.xpub,
    derivationPath: normalizeDerivationPath(d.derivationPath),
  }));

  // Detect network from first device if not specified
  const network = config.network || detectNetwork(devices[0].xpub, devices[0].derivationPath);

  const result: ParsedDescriptor = {
    type: config.type,
    scriptType: config.scriptType,
    devices,
    network,
    isChange: false,
  };

  if (config.type === 'multi_sig') {
    result.quorum = config.quorum;
    result.totalSigners = devices.length;
  }

  return result;
}

/**
 * Wallet export format (from Sparrow, Specter, etc.)
 * Contains a descriptor string inside JSON
 */
export interface WalletExportFormat {
  label?: string;
  name?: string;
  descriptor: string;
  blockheight?: number;
}

/**
 * Coldcard JSON export format
 * Contains xfp (fingerprint) and multiple derivation paths (bip44, bip49, bip84, bip48)
 *
 * Two export formats exist:
 * 1. Nested format (standard single-sig export): bip44/bip49/bip84/bip48_1/bip48_2 objects
 * 2. Flat format (generic multisig export): p2sh/p2sh_p2wsh/p2wsh with separate _deriv keys
 */
export interface ColdcardJsonExport {
  chain?: string;
  xfp: string;
  xpub?: string;
  account?: number | string;
  // Nested format (standard export)
  bip44?: {
    xpub: string;
    deriv: string;
    name?: string;
    first?: string;
  };
  bip49?: {
    xpub: string;
    deriv: string;
    name?: string;
    first?: string;
    _pub?: string;
  };
  bip84?: {
    xpub: string;
    deriv: string;
    name?: string;
    first?: string;
    _pub?: string;
  };
  bip48_1?: {
    xpub: string;
    deriv: string;
    name?: string;
  };
  bip48_2?: {
    xpub: string;
    deriv: string;
    name?: string;
  };
  // Flat format (generic multisig export from Coldcard)
  p2sh?: string;        // Legacy multisig xpub
  p2sh_deriv?: string;  // e.g., "m/45'"
  p2sh_p2wsh?: string;  // Nested segwit multisig Ypub
  p2sh_p2wsh_deriv?: string; // e.g., "m/48'/0'/0'/1'"
  p2wsh?: string;       // Native segwit multisig Zpub
  p2wsh_deriv?: string; // e.g., "m/48'/0'/0'/2'"
}

/**
 * BlueWallet multisig text format parser
 *
 * Format example:
 * # BlueWallet Multisig setup file
 * Name: MyWallet
 * Policy: 2 of 3
 * Derivation: m/48'/0'/0'/2'
 * Format: P2WSH
 *
 * # derivation: m/48'/0'/0'/2'
 * 7E839592: xpub6EGS...
 */
export interface BlueWalletTextFormat {
  name?: string;
  policy?: { quorum: number; total: number };
  derivation?: string;
  format?: string;
  devices: Array<{
    fingerprint: string;
    xpub: string;
    derivationPath?: string;
  }>;
}

/**
 * Check if input looks like BlueWallet text format
 */
export function isBlueWalletTextFormat(input: string): boolean {
  const lines = input.split('\n');
  let hasPolicy = false;
  let hasDeviceLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^Policy:\s*\d+\s+of\s+\d+$/i)) {
      hasPolicy = true;
    }
    // Device line: fingerprint: xpub (8 hex chars followed by colon and xpub)
    if (trimmed.match(/^[a-fA-F0-9]{8}:\s*[xyztuvYZTUVpub]/)) {
      hasDeviceLine = true;
    }
  }

  return hasPolicy && hasDeviceLine;
}

/**
 * Parse BlueWallet text format
 */
export function parseBlueWalletText(input: string): BlueWalletTextFormat {
  const lines = input.split('\n');
  const result: BlueWalletTextFormat = {
    devices: [],
  };

  let currentDerivation: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Parse Name: value
    const nameMatch = trimmed.match(/^Name:\s*(.+)$/i);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
      continue;
    }

    // Parse Policy: M of N
    const policyMatch = trimmed.match(/^Policy:\s*(\d+)\s+of\s+(\d+)$/i);
    if (policyMatch) {
      result.policy = {
        quorum: parseInt(policyMatch[1], 10),
        total: parseInt(policyMatch[2], 10),
      };
      continue;
    }

    // Parse Derivation: m/48'/0'/0'/2'
    const derivationMatch = trimmed.match(/^Derivation:\s*(.+)$/i);
    if (derivationMatch) {
      result.derivation = derivationMatch[1].trim();
      continue;
    }

    // Parse Format: P2WSH
    const formatMatch = trimmed.match(/^Format:\s*(.+)$/i);
    if (formatMatch) {
      result.format = formatMatch[1].trim().toUpperCase();
      continue;
    }

    // Parse comment with derivation path: # derivation: m/48'/0'/0'/2'
    const commentDerivationMatch = trimmed.match(/^#\s*derivation:\s*(.+)$/i);
    if (commentDerivationMatch) {
      currentDerivation = commentDerivationMatch[1].trim();
      continue;
    }

    // Skip other comments
    if (trimmed.startsWith('#')) continue;

    // Parse device line: fingerprint: xpub
    const deviceMatch = trimmed.match(/^([a-fA-F0-9]{8}):\s*([xyztuvYZTUVpub][a-zA-Z0-9]+)$/);
    if (deviceMatch) {
      result.devices.push({
        fingerprint: deviceMatch[1].toLowerCase(),
        xpub: deviceMatch[2],
        derivationPath: currentDerivation || result.derivation,
      });
      currentDerivation = undefined; // Reset for next device
      continue;
    }
  }

  return result;
}

/**
 * Convert BlueWallet format string to script type
 */
function blueWalletFormatToScriptType(format: string | undefined): ScriptType {
  if (!format) return 'native_segwit';

  const upper = format.toUpperCase();
  switch (upper) {
    case 'P2WSH':
      return 'native_segwit';
    case 'P2SH-P2WSH':
    case 'P2WSH-P2SH': // Coldcard uses inner-outer notation (P2WSH wrapped in P2SH)
      return 'nested_segwit';
    case 'P2SH':
      return 'legacy';
    case 'P2TR':
      return 'taproot';
    case 'P2SH-P2TR':
    case 'P2TR-P2SH': // Nested taproot (rare but possible)
      return 'taproot'; // Note: Actually nested, but we map to taproot as closest match
    case 'P2WPKH':
      return 'native_segwit';
    case 'P2SH-P2WPKH':
    case 'P2WPKH-P2SH': // Coldcard uses inner-outer notation
      return 'nested_segwit';
    case 'P2PKH':
      return 'legacy';
    default:
      return 'native_segwit';
  }
}

/**
 * Parse BlueWallet text format into standard ParsedDescriptor
 */
export function parseBlueWalletTextImport(input: string): ParsedDescriptor {
  const parsed = parseBlueWalletText(input);

  if (parsed.devices.length === 0) {
    throw new Error('No devices found in BlueWallet text file');
  }

  // Map devices to standard format
  const devices: ParsedDevice[] = parsed.devices.map((d) => ({
    fingerprint: d.fingerprint,
    xpub: d.xpub,
    derivationPath: normalizeDerivationPath(d.derivationPath || parsed.derivation || "m/48'/0'/0'/2'"),
  }));

  // Detect network from first device
  const network = detectNetwork(devices[0].xpub, devices[0].derivationPath);

  // Determine wallet type
  const isMultisig = parsed.policy && parsed.policy.total > 1;

  const result: ParsedDescriptor = {
    type: isMultisig ? 'multi_sig' : 'single_sig',
    scriptType: blueWalletFormatToScriptType(parsed.format),
    devices,
    network,
    isChange: false,
  };

  if (isMultisig && parsed.policy) {
    result.quorum = parsed.policy.quorum;
    result.totalSigners = parsed.policy.total;
  }

  return result;
}

/**
 * Check if JSON is a wallet export format (has descriptor field)
 */
export function isWalletExportFormat(obj: unknown): obj is WalletExportFormat {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'descriptor' in obj &&
    typeof (obj as WalletExportFormat).descriptor === 'string'
  );
}

/**
 * Check if JSON is a Coldcard export format (has xfp and bip paths)
 * Supports both nested format (bip44/bip49/bip84) and flat format (p2sh/p2wsh/p2sh_p2wsh)
 */
export function isColdcardExportFormat(obj: unknown): obj is ColdcardJsonExport {
  if (typeof obj !== 'object' || obj === null) return false;
  const cc = obj as ColdcardJsonExport;
  // Coldcard exports have xfp (fingerprint) - 8 hex characters
  if (typeof cc.xfp !== 'string' || cc.xfp.length !== 8) return false;

  // Check for nested format (standard single-sig export)
  const hasNestedFormat =
    cc.bip44 !== undefined || cc.bip49 !== undefined || cc.bip84 !== undefined ||
    cc.bip48_1 !== undefined || cc.bip48_2 !== undefined;

  // Check for flat format (generic multisig export)
  const hasFlatFormat =
    cc.p2sh !== undefined || cc.p2sh_p2wsh !== undefined || cc.p2wsh !== undefined;

  return hasNestedFormat || hasFlatFormat;
}

/**
 * Parse Coldcard JSON export into ParsedDescriptor
 * Coldcard exports contain multiple derivation paths - we need to pick one based on priority
 * Priority: bip84/p2wsh (native segwit) > bip49/p2sh_p2wsh (nested segwit) > bip44/p2sh (legacy)
 *
 * Supports both:
 * - Nested format: bip44/bip49/bip84/bip48_1/bip48_2 objects
 * - Flat format: p2sh/p2sh_p2wsh/p2wsh with separate _deriv keys (generic multisig export)
 */
export function parseColdcardExport(cc: ColdcardJsonExport): { parsed: ParsedDescriptor; availablePaths: Array<{ scriptType: ScriptType; path: string }> } {
  const fingerprint = cc.xfp.toLowerCase();
  const availablePaths: Array<{ scriptType: ScriptType; path: string }> = [];

  // Check if this is the flat format (generic multisig export)
  const isFlatFormat = cc.p2wsh !== undefined || cc.p2sh_p2wsh !== undefined || cc.p2sh !== undefined;

  if (isFlatFormat) {
    // Handle flat format (generic multisig export from Coldcard)
    // Collect all available paths
    if (cc.p2wsh && cc.p2wsh_deriv) {
      availablePaths.push({ scriptType: 'native_segwit', path: cc.p2wsh_deriv });
    }
    if (cc.p2sh_p2wsh && cc.p2sh_p2wsh_deriv) {
      availablePaths.push({ scriptType: 'nested_segwit', path: cc.p2sh_p2wsh_deriv });
    }
    if (cc.p2sh && cc.p2sh_deriv) {
      availablePaths.push({ scriptType: 'legacy', path: cc.p2sh_deriv });
    }

    // Pick the best available path (prefer native segwit)
    let selectedPath: { xpub: string; deriv: string; scriptType: ScriptType };

    if (cc.p2wsh && cc.p2wsh_deriv) {
      selectedPath = { xpub: cc.p2wsh, deriv: cc.p2wsh_deriv, scriptType: 'native_segwit' };
    } else if (cc.p2sh_p2wsh && cc.p2sh_p2wsh_deriv) {
      selectedPath = { xpub: cc.p2sh_p2wsh, deriv: cc.p2sh_p2wsh_deriv, scriptType: 'nested_segwit' };
    } else if (cc.p2sh && cc.p2sh_deriv) {
      selectedPath = { xpub: cc.p2sh, deriv: cc.p2sh_deriv, scriptType: 'legacy' };
    } else {
      throw new Error('Coldcard export does not contain any recognized derivation paths with xpubs');
    }

    const device: ParsedDevice = {
      fingerprint,
      xpub: selectedPath.xpub,
      derivationPath: normalizeDerivationPath(selectedPath.deriv),
    };

    const network = detectNetwork(device.xpub, device.derivationPath);

    return {
      parsed: {
        type: 'single_sig',
        scriptType: selectedPath.scriptType,
        devices: [device],
        network,
        isChange: false,
      },
      availablePaths,
    };
  }

  // Handle nested format (standard Coldcard export)
  // Collect all available paths
  if (cc.bip84) {
    availablePaths.push({ scriptType: 'native_segwit', path: cc.bip84.deriv });
  }
  if (cc.bip49) {
    availablePaths.push({ scriptType: 'nested_segwit', path: cc.bip49.deriv });
  }
  if (cc.bip44) {
    availablePaths.push({ scriptType: 'legacy', path: cc.bip44.deriv });
  }

  // Pick the best available path (prefer native segwit)
  let selectedPath: { xpub: string; deriv: string; scriptType: ScriptType };

  if (cc.bip84) {
    selectedPath = { xpub: cc.bip84.xpub, deriv: cc.bip84.deriv, scriptType: 'native_segwit' };
  } else if (cc.bip49) {
    selectedPath = { xpub: cc.bip49.xpub, deriv: cc.bip49.deriv, scriptType: 'nested_segwit' };
  } else if (cc.bip44) {
    selectedPath = { xpub: cc.bip44.xpub, deriv: cc.bip44.deriv, scriptType: 'legacy' };
  } else if (cc.bip48_2) {
    // P2WSH multisig derivation - but for single sig import we treat it as single sig
    selectedPath = { xpub: cc.bip48_2.xpub, deriv: cc.bip48_2.deriv, scriptType: 'native_segwit' };
  } else if (cc.bip48_1) {
    // P2SH-P2WSH multisig derivation
    selectedPath = { xpub: cc.bip48_1.xpub, deriv: cc.bip48_1.deriv, scriptType: 'nested_segwit' };
  } else {
    throw new Error('Coldcard export does not contain any recognized BIP derivation paths');
  }

  const device: ParsedDevice = {
    fingerprint,
    xpub: selectedPath.xpub,
    derivationPath: normalizeDerivationPath(selectedPath.deriv),
  };

  const network = detectNetwork(device.xpub, device.derivationPath);

  return {
    parsed: {
      type: 'single_sig',
      scriptType: selectedPath.scriptType,
      devices: [device],
      network,
      isChange: false,
    },
    availablePaths,
  };
}

/**
 * Extract descriptor from text that may contain comments
 * Returns the first valid descriptor line found
 */
export function extractDescriptorFromText(input: string): string | null {
  const lines = input.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check if line looks like a descriptor (starts with script type wrapper)
    if (
      trimmed.startsWith('wsh(') ||
      trimmed.startsWith('wpkh(') ||
      trimmed.startsWith('sh(') ||
      trimmed.startsWith('pkh(') ||
      trimmed.startsWith('tr(')
    ) {
      return trimmed;
    }
  }

  return null;
}

/**
 * Check if input is a text file with descriptors and comments
 */
export function isDescriptorTextFormat(input: string): boolean {
  const lines = input.split('\n');
  let hasComment = false;
  let hasDescriptor = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) hasComment = true;
    if (
      trimmed.startsWith('wsh(') ||
      trimmed.startsWith('wpkh(') ||
      trimmed.startsWith('sh(') ||
      trimmed.startsWith('pkh(') ||
      trimmed.startsWith('tr(')
    ) {
      hasDescriptor = true;
    }
  }

  return hasComment && hasDescriptor;
}

/**
 * Attempt to parse input as descriptor, JSON, or BlueWallet text format
 * Returns the parsed result or throws an error
 */
export function parseImportInput(input: string): {
  format: 'descriptor' | 'json' | 'wallet_export' | 'bluewallet_text' | 'coldcard';
  parsed: ParsedDescriptor;
  originalDevices?: JsonImportDevice[];
  suggestedName?: string;
  availablePaths?: Array<{ scriptType: ScriptType; path: string }>;
} {
  const trimmed = input.trim();
  log.debug('parseImportInput called', { inputLength: trimmed.length, startsWithHash: trimmed.startsWith('#'), first50: trimmed.substring(0, 50) });

  // Try to detect if it's JSON
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);

      // Check if it's a wallet export format (has descriptor field)
      if (isWalletExportFormat(json)) {
        const parsed = parseDescriptorForImport(json.descriptor);
        return {
          format: 'wallet_export',
          parsed,
          suggestedName: json.label || json.name,
        };
      }

      // Check if it's a Coldcard JSON export (has xfp and bip paths)
      if (isColdcardExportFormat(json)) {
        const { parsed, availablePaths } = parseColdcardExport(json);
        return {
          format: 'coldcard',
          parsed,
          availablePaths,
        };
      }

      // Otherwise treat as our JSON config format
      const config = json as JsonImportConfig;
      return {
        format: 'json',
        parsed: parseJsonImport(config),
        originalDevices: config.devices,
      };
    } catch (e) {
      // If JSON parsing fails, try as descriptor
      if (e instanceof SyntaxError) {
        throw new Error('Invalid JSON format');
      }
      throw e;
    }
  }

  // Check if it's BlueWallet/Coldcard text format (has Policy: M of N)
  if (isBlueWalletTextFormat(trimmed)) {
    const blueWalletParsed = parseBlueWalletText(trimmed);
    return {
      format: 'bluewallet_text',
      parsed: parseBlueWalletTextImport(trimmed),
      suggestedName: blueWalletParsed.name,
    };
  }

  // Check if it's a text file with descriptors and comments (e.g., Sparrow export)
  const isTextFormat = isDescriptorTextFormat(trimmed);
  log.debug('Checking text format', { isTextFormat });
  if (isTextFormat) {
    const descriptor = extractDescriptorFromText(trimmed);
    log.debug('Extracted descriptor from text', { descriptor: descriptor?.substring(0, 100) });
    if (descriptor) {
      return {
        format: 'descriptor',
        parsed: parseDescriptorForImport(descriptor),
      };
    }
  }

  // Try as plain descriptor
  log.debug('Trying as plain descriptor', { first100: trimmed.substring(0, 100) });
  return {
    format: 'descriptor',
    parsed: parseDescriptorForImport(trimmed),
  };
}
