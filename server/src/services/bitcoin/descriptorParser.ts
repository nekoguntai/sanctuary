/**
 * Descriptor Parser Service
 *
 * Parses Bitcoin output descriptors and JSON configurations to extract
 * device information for wallet import functionality.
 */

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
 * Convert derivation path notation (h to ')
 */
function normalizeDerivationPath(path: string): string {
  // Add m/ prefix if missing
  let normalized = path.startsWith('m/') ? path : `m/${path}`;
  // Convert h to '
  normalized = normalized.replace(/h/g, "'");
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
 * Remove checksum from descriptor if present
 * Checksums are appended as #xxxxxxxx
 */
function removeChecksum(descriptor: string): string {
  return descriptor.replace(/#[a-zA-Z0-9]+$/, '').trim();
}

/**
 * Parse a Bitcoin output descriptor and extract all relevant information
 */
export function parseDescriptorForImport(descriptor: string): ParsedDescriptor {
  // Clean up descriptor
  let cleanDescriptor = removeChecksum(descriptor.trim());

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
 * Check if JSON is a wallet export format (has descriptor field)
 */
function isWalletExportFormat(obj: unknown): obj is WalletExportFormat {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'descriptor' in obj &&
    typeof (obj as WalletExportFormat).descriptor === 'string'
  );
}

/**
 * Attempt to parse input as either descriptor or JSON
 * Returns the parsed result or throws an error
 */
export function parseImportInput(input: string): {
  format: 'descriptor' | 'json' | 'wallet_export';
  parsed: ParsedDescriptor;
  originalDevices?: JsonImportDevice[];
  suggestedName?: string;
} {
  const trimmed = input.trim();

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

  // Try as descriptor
  return {
    format: 'descriptor',
    parsed: parseDescriptorForImport(trimmed),
  };
}
