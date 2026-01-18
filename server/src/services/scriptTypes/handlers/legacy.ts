/**
 * Legacy (P2PKH/P2SH) Script Type Handler
 *
 * BIP-44 for single-sig, BIP-45 for multisig.
 * Original Bitcoin script types - less efficient but universally supported.
 */

import type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  MultiSigBuildOptions,
  Network,
} from '../types';
import { formatPathForDescriptor } from '../../../../../shared/utils/bitcoin';

export const legacyHandler: ScriptTypeHandler = {
  id: 'legacy',
  name: 'Legacy (P2PKH)',
  description: 'BIP-44 legacy addresses starting with 1',
  bip: 44,
  multisigBip: 45,
  supportsMultisig: true,
  aliases: ['p2pkh', 'pkh'],

  getDerivationPath(network: Network, account: number = 0): string {
    const coinType = network === 'mainnet' ? '0' : '1';
    return `m/44'/${coinType}'/${account}'`;
  },

  getMultisigDerivationPath(_network: Network, account: number = 0): string {
    // BIP45 doesn't use coin type
    return `m/45'/${account}'`;
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    const derivationPath = device.derivationPath || this.getDerivationPath(options.network);
    const formattedPath = formatPathForDescriptor(derivationPath);
    const chain = options.change ? '1' : '0';
    const keyExpression = `[${device.fingerprint}/${formattedPath}]${device.xpub}`;
    return `pkh(${keyExpression}/${chain}/*)`;
  },

  buildMultiSigDescriptor(devices: DeviceKeyInfo[], options: MultiSigBuildOptions): string {
    const chain = options.change ? '1' : '0';
    const keyExpressions = devices.map((device) => {
      const derivationPath = device.derivationPath || this.getMultisigDerivationPath(options.network);
      const formattedPath = formatPathForDescriptor(derivationPath);
      return `[${device.fingerprint}/${formattedPath}]${device.xpub}/${chain}/*`;
    });
    const sortedMulti = `sortedmulti(${options.quorum},${keyExpressions.join(',')})`;
    return `sh(${sortedMulti})`;
  },

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = ['legacy', 'p2pkh', 'pkh'];
    return deviceScriptTypes.some((type) =>
      validTypes.includes(type.toLowerCase())
    );
  },
};
