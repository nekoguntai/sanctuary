import { describe, expect, it } from 'vitest';
import {
  keystoneMultisigParser,
  keystoneStandardParser,
} from '../../../services/deviceParsers/parsers/keystone';

describe('keystoneStandardParser branch coverage', () => {
  it('rejects non-keystone or non-BTC payloads in canParse', () => {
    expect(keystoneStandardParser.canParse(null)).toEqual({ detected: false, confidence: 0 });
    expect(keystoneStandardParser.canParse({})).toEqual({ detected: false, confidence: 0 });
    expect(
      keystoneStandardParser.canParse({
        coins: [{ coinCode: 'ETH', accounts: [{ hdPath: "M/84'/0'/0'", xPub: 'xpub-eth' }] }],
      })
    ).toEqual({ detected: false, confidence: 0 });
    expect(
      keystoneStandardParser.canParse({
        coins: [{ coinCode: 'BTC', accounts: [] }],
      })
    ).toEqual({ detected: false, confidence: 0 });
  });

  it('detects BTC standard format from nested data.sync.coins', () => {
    expect(
      keystoneStandardParser.canParse({
        data: {
          sync: {
            coins: [{ coin: 'BTC', accounts: [{ hdPath: "M/84'/0'/0'", xPub: 'xpub-btc' }] }],
          },
        },
      })
    ).toEqual({ detected: true, confidence: 90 });
  });

  it('parses single-sig and multisig accounts with script derivation and fallback path normalization', () => {
    const parsed = keystoneStandardParser.parse({
      coins: [
        {
          coinCode: 'BTC',
          accounts: [
            { hdPath: "M/44'/0'/0'", xPub: 'xpub-legacy' },
            { hdPath: "M/49h/0h/0h", xpub: 'xpub-nested' },
            { hdPath: "M/84'/0'/0'", xPub: 'xpub-native' },
            { hdPath: "M/86h/0h/0h", xpub: 'xpub-taproot' },
            { hdPath: "M/48h/0h/0h/1h", xPub: 'xpub-multi-nested' },
            { hdPath: "M/48'/0'/0'/2'", xPub: 'xpub-multi-native' },
            { hdPath: 'M/84/0/0', xPub: '' },
          ],
        },
      ],
    });

    expect(parsed.xpub).toBe('xpub-native');
    expect(parsed.derivationPath).toBe("m/84'/0'/0'");
    expect(parsed.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ xpub: 'xpub-legacy', scriptType: 'legacy', purpose: 'single_sig' }),
        expect.objectContaining({ xpub: 'xpub-nested', scriptType: 'nested_segwit', purpose: 'single_sig' }),
        expect.objectContaining({ xpub: 'xpub-native', scriptType: 'native_segwit', purpose: 'single_sig' }),
        expect.objectContaining({ xpub: 'xpub-taproot', scriptType: 'taproot', purpose: 'single_sig' }),
        expect.objectContaining({ xpub: 'xpub-multi-nested', scriptType: 'nested_segwit', purpose: 'multisig' }),
        expect.objectContaining({ xpub: 'xpub-multi-native', scriptType: 'native_segwit', purpose: 'multisig' }),
      ])
    );
  });

  it('returns empty parse for missing BTC accounts and falls back to first single-sig when no native segwit account exists', () => {
    expect(
      keystoneStandardParser.parse({
        coins: [{ coinCode: 'BTC', accounts: [] }],
      })
    ).toEqual({});

    const parsed = keystoneStandardParser.parse({
      coins: [
        {
          coinCode: 'BTC',
          accounts: [
            { hdPath: "M/49'/0'/0'", xPub: 'xpub-single-nested' },
            { hdPath: "M/48'/0'/0'/2'", xPub: 'xpub-multi' },
          ],
        },
      ],
    });

    expect(parsed.xpub).toBe('xpub-single-nested');
    expect(parsed.derivationPath).toBe("m/49'/0'/0'");
  });
});

describe('keystoneMultisigParser branch coverage', () => {
  it('detects multisig format with and without xfp confidence boost', () => {
    expect(keystoneMultisigParser.canParse(null)).toEqual({ detected: false, confidence: 0 });
    expect(keystoneMultisigParser.canParse({ Path: "M/48'/0'/0'/2'" })).toEqual({
      detected: false,
      confidence: 0,
    });
    expect(
      keystoneMultisigParser.canParse({
        ExtendedPublicKey: 'Zpub-1',
      })
    ).toEqual({ detected: true, confidence: 82 });
    expect(
      keystoneMultisigParser.canParse({
        ExtendedPublicKey: 'Zpub-2',
        xfp: '37b5eed4',
      })
    ).toEqual({ detected: true, confidence: 92 });
  });

  it('parses path normalization, script detection, and empty-xpub branches', () => {
    const nested = keystoneMultisigParser.parse({
      ExtendedPublicKey: 'Zpub-nested',
      Path: "M/48'/0'/0'/1'",
      xfp: 'deadbeef',
    });
    expect(nested).toEqual({
      xpub: 'Zpub-nested',
      fingerprint: 'deadbeef',
      derivationPath: "m/48'/0'/0'/1'",
      accounts: [
        {
          xpub: 'Zpub-nested',
          derivationPath: "m/48'/0'/0'/1'",
          purpose: 'multisig',
          scriptType: 'nested_segwit',
        },
      ],
    });

    const native = keystoneMultisigParser.parse({
      ExtendedPublicKey: 'Zpub-native',
      Path: "M/48h/0h/0h/2h",
    });
    expect(native.accounts?.[0].scriptType).toBe('native_segwit');

    const noXpub = keystoneMultisigParser.parse({
      Path: "M/48'/0'/0'/2'",
    } as unknown as { ExtendedPublicKey: string; Path: string });
    expect(noXpub).toEqual({
      xpub: '',
      fingerprint: '',
      derivationPath: "m/48'/0'/0'/2'",
      accounts: undefined,
    });
  });
});
