/**
 * Nested SegWit (P2SH-P2WPKH/P2SH-P2WSH) Script Type Handler
 *
 * BIP-49 for single-sig, BIP-48 script type 1 for multisig.
 * Backwards-compatible SegWit wrapped in P2SH.
 */

import type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  MultiSigBuildOptions,
  Network,
} from '../types';

/**
 * Format a derivation path for use in descriptors (replace ' with h)
 */
function formatPathForDescriptor(path: string): string {
  return path.replace(/^m\//, '').replace(/'/g, 'h');
}

export const nestedSegwitHandler: ScriptTypeHandler = {
  id: 'nested_segwit',
  name: 'Nested SegWit (P2SH-P2WPKH)',
  description: 'BIP-49 wrapped SegWit addresses starting with 3',
  bip: 49,
  multisigBip: 48,
  multisigScriptTypeNumber: 1,
  supportsMultisig: true,
  aliases: ['p2sh-p2wpkh', 'wrapped_segwit', 'p2sh_p2wpkh'],

  getDerivationPath(network: Network, account: number = 0): string {
    const coinType = network === 'mainnet' ? '0' : '1';
    return `m/49'/${coinType}'/${account}'`;
  },

  getMultisigDerivationPath(network: Network, account: number = 0): string {
    const coinType = network === 'mainnet' ? '0' : '1';
    return `m/48'/${coinType}'/${account}'/1'`; // BIP48 script type 1
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    const derivationPath = device.derivationPath || this.getDerivationPath(options.network);
    const formattedPath = formatPathForDescriptor(derivationPath);
    const chain = options.change ? '1' : '0';
    const keyExpression = `[${device.fingerprint}/${formattedPath}]${device.xpub}`;
    return `sh(wpkh(${keyExpression}/${chain}/*))`;
  },

  buildMultiSigDescriptor(devices: DeviceKeyInfo[], options: MultiSigBuildOptions): string {
    const chain = options.change ? '1' : '0';
    const keyExpressions = devices.map((device) => {
      const derivationPath = device.derivationPath || this.getMultisigDerivationPath(options.network);
      const formattedPath = formatPathForDescriptor(derivationPath);
      return `[${device.fingerprint}/${formattedPath}]${device.xpub}/${chain}/*`;
    });
    const sortedMulti = `sortedmulti(${options.quorum},${keyExpressions.join(',')})`;
    return `sh(wsh(${sortedMulti}))`;
  },

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = ['nested_segwit', 'p2sh-p2wpkh', 'wrapped_segwit', 'segwit'];
    return deviceScriptTypes.some((type) =>
      validTypes.includes(type.toLowerCase())
    );
  },
};
