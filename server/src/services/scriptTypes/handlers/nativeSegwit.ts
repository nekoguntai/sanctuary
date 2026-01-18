/**
 * Native SegWit (P2WPKH/P2WSH) Script Type Handler
 *
 * BIP-84 for single-sig, BIP-48 script type 2 for multisig.
 * Most modern and efficient on-chain script type.
 */

import type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  MultiSigBuildOptions,
  Network,
} from '../types';
import { formatPathForDescriptor } from '../../../../../shared/utils/bitcoin';

export const nativeSegwitHandler: ScriptTypeHandler = {
  id: 'native_segwit',
  name: 'Native SegWit (P2WPKH)',
  description: 'BIP-84 native SegWit addresses starting with bc1q',
  bip: 84,
  multisigBip: 48,
  multisigScriptTypeNumber: 2,
  supportsMultisig: true,
  aliases: ['p2wpkh', 'bech32', 'segwit', 'wpkh'],

  getDerivationPath(network: Network, account: number = 0): string {
    const coinType = network === 'mainnet' ? '0' : '1';
    return `m/84'/${coinType}'/${account}'`;
  },

  getMultisigDerivationPath(network: Network, account: number = 0): string {
    const coinType = network === 'mainnet' ? '0' : '1';
    return `m/48'/${coinType}'/${account}'/2'`; // BIP48 script type 2
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    const derivationPath = device.derivationPath || this.getDerivationPath(options.network);
    const formattedPath = formatPathForDescriptor(derivationPath);
    const chain = options.change ? '1' : '0';
    const keyExpression = `[${device.fingerprint}/${formattedPath}]${device.xpub}`;
    return `wpkh(${keyExpression}/${chain}/*)`;
  },

  buildMultiSigDescriptor(devices: DeviceKeyInfo[], options: MultiSigBuildOptions): string {
    const chain = options.change ? '1' : '0';
    const keyExpressions = devices.map((device) => {
      const derivationPath = device.derivationPath || this.getMultisigDerivationPath(options.network);
      const formattedPath = formatPathForDescriptor(derivationPath);
      return `[${device.fingerprint}/${formattedPath}]${device.xpub}/${chain}/*`;
    });
    const sortedMulti = `sortedmulti(${options.quorum},${keyExpressions.join(',')})`;
    return `wsh(${sortedMulti})`;
  },

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = ['native_segwit', 'p2wpkh', 'bech32', 'segwit', 'wpkh'];
    return deviceScriptTypes.some((type) =>
      validTypes.includes(type.toLowerCase())
    );
  },
};
