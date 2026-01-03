/**
 * Sparrow Wallet Export Format Handler
 *
 * Exports wallet in Sparrow-compatible JSON format.
 * This format is widely supported by desktop wallet software.
 */

import type {
  ExportFormatHandler,
  WalletExportData,
  ExportOptions,
  ExportResult,
} from '../types';

/**
 * Map internal script type to Sparrow format
 */
function mapScriptType(scriptType: string): string {
  const scriptTypeMap: Record<string, string> = {
    native_segwit: 'P2WPKH',
    nested_segwit: 'P2SH_P2WPKH',
    taproot: 'P2TR',
    legacy: 'P2PKH',
  };
  return scriptTypeMap[scriptType] || 'P2WPKH';
}

/**
 * Map internal script type to Sparrow multisig format
 */
function mapMultisigScriptType(scriptType: string): string {
  const scriptTypeMap: Record<string, string> = {
    native_segwit: 'P2WSH',
    nested_segwit: 'P2SH_P2WSH',
    legacy: 'P2SH',
  };
  return scriptTypeMap[scriptType] || 'P2WSH';
}

/**
 * Map device type to Sparrow wallet model
 */
function mapDeviceType(deviceType: string): string {
  const typeMap: Record<string, string> = {
    coldcard: 'COLDCARD',
    coldcardmk4: 'COLDCARD',
    coldcard_mk4: 'COLDCARD',
    coldcard_q: 'COLDCARD',
    ledger: 'LEDGER_NANO_S',
    ledger_nano: 'LEDGER_NANO_S',
    ledger_nano_s: 'LEDGER_NANO_S',
    ledger_nano_x: 'LEDGER_NANO_X',
    ledger_stax: 'LEDGER_STAX',
    ledger_flex: 'LEDGER_FLEX',
    trezor: 'TREZOR_1',
    trezor_one: 'TREZOR_1',
    trezor_t: 'TREZOR_T',
    trezor_safe_3: 'TREZOR_SAFE_3',
    trezor_safe_5: 'TREZOR_SAFE_5',
    bitbox: 'BITBOX_02',
    bitbox02: 'BITBOX_02',
    jade: 'JADE',
    seedsigner: 'SEEDSIGNER',
    passport: 'PASSPORT',
    keystone: 'KEYSTONE',
    specter: 'SPECTER_DIY',
  };

  const normalizedType = deviceType.toLowerCase().replace(/[\s-]/g, '_');
  return typeMap[normalizedType] || 'COLDCARD';
}

export const sparrowHandler: ExportFormatHandler = {
  id: 'sparrow',
  name: 'Sparrow Wallet',
  description: 'Sparrow-compatible JSON format for desktop wallets',
  fileExtension: '.json',
  mimeType: 'application/json',

  export(wallet: WalletExportData, options?: ExportOptions): ExportResult {
    const keystores = wallet.devices.map((device, index) => ({
      label: device.label,
      source: 'HW_AIRGAPPED',
      walletModel: mapDeviceType(device.type),
      masterFingerprint: device.fingerprint,
      derivation: device.derivationPath || '',
      xpub: device.xpub,
      keyIndex: index,
    }));

    const exportData: Record<string, unknown> = {
      label: wallet.name,
      policy: wallet.type === 'multi_sig'
        ? {
            type: 'MULTI',
            numSigners: wallet.totalSigners,
            threshold: wallet.quorum,
          }
        : {
            type: 'SINGLE',
          },
      scriptType: wallet.type === 'multi_sig'
        ? mapMultisigScriptType(wallet.scriptType)
        : mapScriptType(wallet.scriptType),
      keystores,
      descriptor: wallet.descriptor,
    };

    // Include change descriptor if requested
    if (options?.includeChangeDescriptor && wallet.changeDescriptor) {
      exportData.changeDescriptor = wallet.changeDescriptor;
    }

    // Include any additional metadata
    if (options?.metadata) {
      Object.assign(exportData, options.metadata);
    }

    const content = JSON.stringify(exportData, null, 2);
    const filename = options?.filename
      ? `${options.filename}.json`
      : `${wallet.name.replace(/[^a-zA-Z0-9-_]/g, '_')}_sparrow.json`;

    return {
      content,
      mimeType: this.mimeType,
      filename,
      encoding: 'utf-8',
    };
  },
};
