/**
 * Coldcard Nested Format Parser
 *
 * Handles the standard Coldcard JSON export with nested BIP sections:
 * { xfp: "...", bip84: { xpub: "...", _pub: "zpub...", deriv: "m/84'/0'/0'" }, ... }
 *
 * Returns ALL available accounts (single-sig and multisig) for multi-account import.
 */

import type { DeviceParser, DeviceParseResult, DeviceAccount, FormatDetectionResult } from '../types';

interface ColdcardNestedFormat {
  xfp?: string;
  bip44?: { xpub?: string; _pub?: string; deriv?: string };
  bip49?: { xpub?: string; _pub?: string; deriv?: string };
  bip84?: { xpub?: string; _pub?: string; deriv?: string };
  bip86?: { xpub?: string; _pub?: string; deriv?: string };
  bip48_1?: { xpub?: string; deriv?: string }; // Nested segwit multisig (P2SH-P2WSH)
  bip48_2?: { xpub?: string; deriv?: string }; // Native segwit multisig (P2WSH)
  name?: string;
  label?: string;
}

function isColdcardNestedFormat(data: unknown): data is ColdcardNestedFormat {
  if (typeof data !== 'object' || data === null) return false;
  const cc = data as ColdcardNestedFormat;
  return (
    cc.bip44 !== undefined ||
    cc.bip49 !== undefined ||
    cc.bip84 !== undefined ||
    cc.bip86 !== undefined ||
    cc.bip48_1 !== undefined ||
    cc.bip48_2 !== undefined
  );
}

export const coldcardNestedParser: DeviceParser = {
  id: 'coldcard-nested',
  name: 'Coldcard Standard Export',
  description: 'Coldcard JSON export with bip44/bip49/bip84/bip86 sections',
  priority: 90,

  canParse(data: unknown): FormatDetectionResult {
    if (!isColdcardNestedFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    // Higher confidence if it has xfp (fingerprint)
    const cc = data as ColdcardNestedFormat;
    const hasXfp = typeof cc.xfp === 'string' && cc.xfp.length === 8;

    return {
      detected: true,
      confidence: hasXfp ? 95 : 85,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const cc = data as ColdcardNestedFormat;
    const accounts: DeviceAccount[] = [];

    // Extract all available single-sig accounts
    if (cc.bip84) {
      const xpub = cc.bip84._pub || cc.bip84.xpub || '';
      if (xpub) {
        accounts.push({
          xpub,
          derivationPath: cc.bip84.deriv || "m/84'/0'/0'",
          purpose: 'single_sig',
          scriptType: 'native_segwit',
        });
      }
    }

    if (cc.bip86) {
      const xpub = cc.bip86._pub || cc.bip86.xpub || '';
      if (xpub) {
        accounts.push({
          xpub,
          derivationPath: cc.bip86.deriv || "m/86'/0'/0'",
          purpose: 'single_sig',
          scriptType: 'taproot',
        });
      }
    }

    if (cc.bip49) {
      const xpub = cc.bip49._pub || cc.bip49.xpub || '';
      if (xpub) {
        accounts.push({
          xpub,
          derivationPath: cc.bip49.deriv || "m/49'/0'/0'",
          purpose: 'single_sig',
          scriptType: 'nested_segwit',
        });
      }
    }

    if (cc.bip44) {
      const xpub = cc.bip44._pub || cc.bip44.xpub || '';
      if (xpub) {
        accounts.push({
          xpub,
          derivationPath: cc.bip44.deriv || "m/44'/0'/0'",
          purpose: 'single_sig',
          scriptType: 'legacy',
        });
      }
    }

    // Extract multisig accounts (BIP-48)
    if (cc.bip48_2) {
      const xpub = cc.bip48_2.xpub || '';
      if (xpub) {
        accounts.push({
          xpub,
          derivationPath: cc.bip48_2.deriv || "m/48'/0'/0'/2'",
          purpose: 'multisig',
          scriptType: 'native_segwit',
        });
      }
    }

    if (cc.bip48_1) {
      const xpub = cc.bip48_1.xpub || '';
      if (xpub) {
        accounts.push({
          xpub,
          derivationPath: cc.bip48_1.deriv || "m/48'/0'/0'/1'",
          purpose: 'multisig',
          scriptType: 'nested_segwit',
        });
      }
    }

    // Primary account: prefer native segwit single-sig (bip84)
    const primaryAccount = accounts.find(a => a.purpose === 'single_sig' && a.scriptType === 'native_segwit')
      || accounts.find(a => a.purpose === 'single_sig')
      || accounts[0];

    return {
      xpub: primaryAccount?.xpub || '',
      fingerprint: cc.xfp || '',
      derivationPath: primaryAccount?.derivationPath || '',
      label: cc.name || cc.label || '',
      accounts: accounts.length > 0 ? accounts : undefined,
    };
  },
};
