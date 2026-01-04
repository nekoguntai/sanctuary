/**
 * Keystone Format Parsers
 *
 * Handles multiple Keystone export formats:
 * 1. Standard format with coins/accounts structure
 * 2. Multisig format with ExtendedPublicKey/Path
 */

import type { DeviceParser, DeviceParseResult, FormatDetectionResult } from '../types';

// Standard Keystone format
interface KeystoneStandardFormat {
  coins?: Array<{
    coinCode?: string;
    coin?: string;
    accounts?: Array<{
      hdPath?: string;
      xPub?: string;
      xpub?: string;
    }>;
  }>;
  data?: {
    sync?: {
      coins?: KeystoneStandardFormat['coins'];
    };
  };
}

// Multisig Keystone format
interface KeystoneMultisigFormat {
  ExtendedPublicKey?: string;
  Path?: string;
  xfp?: string;
}

function isKeystoneStandardFormat(data: unknown): data is KeystoneStandardFormat {
  if (typeof data !== 'object' || data === null) return false;
  const ks = data as KeystoneStandardFormat;
  const coins = ks.coins || ks.data?.sync?.coins;
  return Array.isArray(coins) && coins.length > 0;
}

function isKeystoneMultisigFormat(data: unknown): data is KeystoneMultisigFormat {
  if (typeof data !== 'object' || data === null) return false;
  const ks = data as KeystoneMultisigFormat;
  return typeof ks.ExtendedPublicKey === 'string' && ks.ExtendedPublicKey.length > 0;
}

/**
 * Keystone Standard Format Parser
 * { coins: [{ coinCode: "BTC", accounts: [{ hdPath: "M/84'/0'/0'", xPub: "xpub..." }] }] }
 */
export const keystoneStandardParser: DeviceParser = {
  id: 'keystone-standard',
  name: 'Keystone Export',
  description: 'Keystone JSON export with coins/accounts structure',
  priority: 85,

  canParse(data: unknown): FormatDetectionResult {
    if (!isKeystoneStandardFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    const ks = data as KeystoneStandardFormat;
    const coins = ks.coins || ks.data?.sync?.coins || [];
    const btcCoin = coins.find((c) => c.coinCode === 'BTC' || c.coin === 'BTC');

    if (!btcCoin?.accounts?.length) {
      return { detected: false, confidence: 0 };
    }

    return {
      detected: true,
      confidence: 90,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const ks = data as KeystoneStandardFormat;
    const coins = ks.coins || ks.data?.sync?.coins || [];
    const btcCoin = coins.find((c) => c.coinCode === 'BTC' || c.coin === 'BTC');

    if (!btcCoin?.accounts?.length) {
      return {};
    }

    // Prefer Native SegWit (84') account
    const nativeSegwit = btcCoin.accounts.find(
      (a) => a.hdPath?.includes("84'") || a.hdPath?.includes("84h")
    );
    const account = nativeSegwit || btcCoin.accounts[0];

    return {
      xpub: account.xPub || account.xpub || '',
      derivationPath: (account.hdPath || '').replace(/^M/, 'm'),
    };
  },
};

/**
 * Keystone Multisig Format Parser
 * { ExtendedPublicKey: "Zpub...", Path: "M/48'/0'/0'/2'", xfp: "37b5eed4" }
 */
export const keystoneMultisigParser: DeviceParser = {
  id: 'keystone-multisig',
  name: 'Keystone Multisig Export',
  description: 'Keystone multisig format with ExtendedPublicKey/Path',
  priority: 86,

  canParse(data: unknown): FormatDetectionResult {
    if (!isKeystoneMultisigFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    const ks = data as KeystoneMultisigFormat;
    const hasXfp = typeof ks.xfp === 'string' && ks.xfp.length === 8;

    return {
      detected: true,
      confidence: hasXfp ? 92 : 82,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const ks = data as KeystoneMultisigFormat;

    return {
      xpub: ks.ExtendedPublicKey || '',
      fingerprint: ks.xfp || '',
      derivationPath: (ks.Path || '').replace(/^M/, 'm'),
    };
  },
};
