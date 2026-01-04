/**
 * Coldcard Nested Format Parser
 *
 * Handles the standard Coldcard JSON export with nested BIP sections:
 * { xfp: "...", bip84: { xpub: "...", _pub: "zpub...", deriv: "m/84'/0'/0'" }, ... }
 */

import type { DeviceParser, DeviceParseResult, FormatDetectionResult } from '../types';

interface ColdcardNestedFormat {
  xfp?: string;
  bip44?: { xpub?: string; _pub?: string; deriv?: string };
  bip49?: { xpub?: string; _pub?: string; deriv?: string };
  bip84?: { xpub?: string; _pub?: string; deriv?: string };
  bip86?: { xpub?: string; _pub?: string; deriv?: string };
  bip48_1?: { xpub?: string; deriv?: string };
  bip48_2?: { xpub?: string; deriv?: string };
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

    // Priority: bip84 > bip86 > bip49 > bip44 > bip48_2 > bip48_1
    // (Native SegWit preferred)
    let xpub = '';
    let derivationPath = '';

    if (cc.bip84) {
      xpub = cc.bip84._pub || cc.bip84.xpub || '';
      derivationPath = cc.bip84.deriv || '';
    } else if (cc.bip86) {
      xpub = cc.bip86._pub || cc.bip86.xpub || '';
      derivationPath = cc.bip86.deriv || '';
    } else if (cc.bip49) {
      xpub = cc.bip49._pub || cc.bip49.xpub || '';
      derivationPath = cc.bip49.deriv || '';
    } else if (cc.bip44) {
      xpub = cc.bip44._pub || cc.bip44.xpub || '';
      derivationPath = cc.bip44.deriv || '';
    } else if (cc.bip48_2) {
      xpub = cc.bip48_2.xpub || '';
      derivationPath = cc.bip48_2.deriv || '';
    } else if (cc.bip48_1) {
      xpub = cc.bip48_1.xpub || '';
      derivationPath = cc.bip48_1.deriv || '';
    }

    return {
      xpub,
      fingerprint: cc.xfp || '',
      derivationPath,
      label: cc.name || cc.label || '',
    };
  },
};
