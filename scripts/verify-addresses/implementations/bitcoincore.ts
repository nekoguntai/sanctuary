/**
 * Bitcoin Core Implementation Wrapper
 *
 * Uses Bitcoin Core's JSON-RPC interface to derive addresses.
 * This is THE reference implementation for Bitcoin.
 *
 * Requires Bitcoin Core running in regtest mode (see docker-compose.yml)
 */

import type { AddressDeriver, ScriptType, MultisigScriptType, Network } from '../types.js';

// Default to existing lncm/bitcoind container (beacon-bitcoind) if running
// Can override with environment variables
const RPC_URL = process.env.BITCOIN_RPC_URL || 'http://127.0.0.1:18443';
const RPC_USER = process.env.BITCOIN_RPC_USER || 'beacon';
const RPC_PASS = process.env.BITCOIN_RPC_PASS || 'beacon';

interface RPCResponse<T> {
  result: T;
  error: { code: number; message: string } | null;
  id: string;
}

async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64'),
    },
    body: JSON.stringify({
      jsonrpc: '1.0',
      id: 'verify',
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as RPCResponse<T>;

  if (data.error) {
    throw new Error(`RPC error: ${data.error.message} (code: ${data.error.code})`);
  }

  return data.result;
}

/**
 * Build a descriptor for single-sig address
 */
function buildSingleSigDescriptor(
  xpub: string,
  index: number,
  scriptType: ScriptType,
  change: boolean
): string {
  const changeNum = change ? 1 : 0;
  const path = `${changeNum}/${index}`;

  switch (scriptType) {
    case 'legacy':
      return `pkh(${xpub}/${path})`;
    case 'nested_segwit':
      return `sh(wpkh(${xpub}/${path}))`;
    case 'native_segwit':
      return `wpkh(${xpub}/${path})`;
    case 'taproot':
      return `tr(${xpub}/${path})`;
    default:
      throw new Error(`Unknown script type: ${scriptType}`);
  }
}

/**
 * Build a descriptor for multisig address
 */
function buildMultisigDescriptor(
  xpubs: string[],
  threshold: number,
  index: number,
  scriptType: MultisigScriptType,
  change: boolean
): string {
  const changeNum = change ? 1 : 0;

  // Build key expressions with derivation path
  const keyExprs = xpubs.map(xpub => `${xpub}/${changeNum}/${index}`);

  // sortedmulti ensures consistent key ordering
  const multisig = `sortedmulti(${threshold},${keyExprs.join(',')})`;

  switch (scriptType) {
    case 'p2sh':
      return `sh(${multisig})`;
    case 'p2sh_p2wsh':
      return `sh(wsh(${multisig}))`;
    case 'p2wsh':
      return `wsh(${multisig})`;
    default:
      throw new Error(`Unknown multisig script type: ${scriptType}`);
  }
}

/**
 * Get descriptor info and add checksum if missing
 */
async function getDescriptorWithChecksum(descriptor: string): Promise<string> {
  // If descriptor already has checksum, use it
  if (descriptor.includes('#')) {
    return descriptor;
  }

  // Get checksum from Bitcoin Core
  const info = await rpcCall<{ descriptor: string; checksum: string; isrange: boolean }>(
    'getdescriptorinfo',
    [descriptor]
  );

  return info.descriptor;
}

export const bitcoinCore: AddressDeriver = {
  name: 'Bitcoin Core',
  version: '27.0', // Will be updated by isAvailable()

  async deriveSingleSig(
    xpub: string,
    index: number,
    scriptType: ScriptType,
    change: boolean,
    network: Network
  ): Promise<string> {
    // Build descriptor
    const rawDescriptor = buildSingleSigDescriptor(xpub, index, scriptType, change);

    // Get descriptor with checksum
    const descriptor = await getDescriptorWithChecksum(rawDescriptor);

    // Derive address (returns array, we want index 0)
    // Note: deriveaddresses takes a range, but we're deriving a specific index
    // so we just get the first (and only) result
    const addresses = await rpcCall<string[]>('deriveaddresses', [descriptor]);

    if (!addresses || addresses.length === 0) {
      throw new Error(`No address derived for descriptor: ${descriptor}`);
    }

    return addresses[0];
  },

  async deriveMultisig(
    xpubs: string[],
    threshold: number,
    index: number,
    scriptType: MultisigScriptType,
    change: boolean,
    _network: Network
  ): Promise<string> {
    // Build descriptor
    const rawDescriptor = buildMultisigDescriptor(xpubs, threshold, index, scriptType, change);

    // Get descriptor with checksum
    const descriptor = await getDescriptorWithChecksum(rawDescriptor);

    // Derive address
    const addresses = await rpcCall<string[]>('deriveaddresses', [descriptor]);

    if (!addresses || addresses.length === 0) {
      throw new Error(`No address derived for descriptor: ${descriptor}`);
    }

    return addresses[0];
  },

  async isAvailable(): Promise<boolean> {
    try {
      const info = await rpcCall<{ version: number; subversion: string }>('getnetworkinfo');

      // Update version string
      // Bitcoin Core version is encoded as MMNNPP (Major Minor Patch)
      // e.g., 270000 = 27.0.0
      const major = Math.floor(info.version / 10000);
      const minor = Math.floor((info.version % 10000) / 100);
      const patch = info.version % 100;
      this.version = `${major}.${minor}.${patch}`;

      return true;
    } catch {
      return false;
    }
  },
};
