/**
 * BlueWallet Text Export Format Handler
 *
 * Exports wallet in BlueWallet/Coldcard text format.
 * Compatible with Coldcard and BlueWallet multisig wallets.
 */

import type {
  ExportFormatHandler,
  WalletExportData,
  ExportOptions,
  ExportResult,
} from '../types';

/**
 * Map script type to BlueWallet format name
 */
function mapScriptTypeToFormat(scriptType: string, isMultisig: boolean): string {
  if (isMultisig) {
    const formatMap: Record<string, string> = {
      native_segwit: 'P2WSH',
      nested_segwit: 'P2SH-P2WSH',
      legacy: 'P2SH',
    };
    return formatMap[scriptType] || 'P2WSH';
  }
  const formatMap: Record<string, string> = {
    native_segwit: 'P2WPKH',
    nested_segwit: 'P2SH-P2WPKH',
    taproot: 'P2TR',
    legacy: 'P2PKH',
  };
  return formatMap[scriptType] || 'P2WPKH';
}

export const bluewalletHandler: ExportFormatHandler = {
  id: 'bluewallet',
  name: 'BlueWallet/Coldcard',
  description: 'Text format compatible with BlueWallet and Coldcard',
  fileExtension: '.txt',
  mimeType: 'text/plain',

  canExport(wallet: WalletExportData): boolean {
    // BlueWallet format is best for multisig wallets
    // But can also export single-sig
    return true;
  },

  export(wallet: WalletExportData, options?: ExportOptions): ExportResult {
    const lines: string[] = [];

    // Header
    lines.push(`Name: ${wallet.name}`);

    if (wallet.type === 'multi_sig') {
      lines.push(`Policy: ${wallet.quorum} of ${wallet.totalSigners}`);
    } else {
      lines.push('Policy: 1 of 1');
    }

    lines.push(`Format: ${mapScriptTypeToFormat(wallet.scriptType, wallet.type === 'multi_sig')}`);
    lines.push('');

    // Device/Key information
    for (let i = 0; i < wallet.devices.length; i++) {
      const device = wallet.devices[i];
      const keyNum = i + 1;

      lines.push(`Derivation: ${device.derivationPath || "m/48'/0'/0'/2'"}`);
      lines.push(`${device.fingerprint}: ${device.xpub}`);
      lines.push('');
    }

    const content = lines.join('\n');
    const filename = options?.filename
      ? `${options.filename}.txt`
      : `${wallet.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_bluewallet.txt`;

    return {
      content,
      mimeType: this.mimeType,
      filename,
      encoding: 'utf-8',
    };
  },
};
