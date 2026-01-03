/**
 * Taproot (P2TR) Script Type Handler
 *
 * BIP-86 for single-sig. Multisig not yet fully supported.
 * Latest Bitcoin script type with enhanced privacy and efficiency.
 */

import type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  Network,
} from '../types';

/**
 * Format a derivation path for use in descriptors (replace ' with h)
 */
function formatPathForDescriptor(path: string): string {
  return path.replace(/^m\//, '').replace(/'/g, 'h');
}

export const taprootHandler: ScriptTypeHandler = {
  id: 'taproot',
  name: 'Taproot (P2TR)',
  description: 'BIP-86 Taproot addresses starting with bc1p',
  bip: 86,
  multisigBip: 48,
  multisigScriptTypeNumber: 3,
  supportsMultisig: false, // MuSig2 multisig not yet widely supported
  aliases: ['p2tr', 'bech32m', 'tr'],

  getDerivationPath(network: Network, account: number = 0): string {
    const coinType = network === 'mainnet' ? '0' : '1';
    return `m/86'/${coinType}'/${account}'`;
  },

  getMultisigDerivationPath(network: Network, account: number = 0): string {
    // BIP48 script type 3 (proposed for taproot multisig)
    const coinType = network === 'mainnet' ? '0' : '1';
    return `m/48'/${coinType}'/${account}'/3'`;
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    const derivationPath = device.derivationPath || this.getDerivationPath(options.network);
    const formattedPath = formatPathForDescriptor(derivationPath);
    const chain = options.change ? '1' : '0';
    const keyExpression = `[${device.fingerprint}/${formattedPath}]${device.xpub}`;
    return `tr(${keyExpression}/${chain}/*)`;
  },

  // Multisig not implemented - would require MuSig2 or script path spending
  // buildMultiSigDescriptor is omitted since supportsMultisig is false

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = ['taproot', 'p2tr', 'bech32m', 'tr'];
    return deviceScriptTypes.some((type) =>
      validTypes.includes(type.toLowerCase())
    );
  },
};
