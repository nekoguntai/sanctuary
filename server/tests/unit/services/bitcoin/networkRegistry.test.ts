import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  detectNetworkFromAddress,
  getNetworkConfig,
  getNetworkHandler,
  networkRegistry,
  validateAddressForNetwork,
} from '../../../../src/services/bitcoin/networkRegistry';

describe('networkRegistry', () => {
  it('registers default networks', () => {
    expect(networkRegistry.getAll().sort()).toEqual(['mainnet', 'regtest', 'signet', 'testnet']);
    expect(networkRegistry.has('mainnet')).toBe(true);
    expect(networkRegistry.has('testnet')).toBe(true);
  });

  it('returns config and explorer urls for handlers', () => {
    const mainnet = getNetworkConfig('mainnet');
    const handler = getNetworkHandler('mainnet');

    expect(mainnet.displayName).toBe('Bitcoin Mainnet');
    expect(mainnet.coinType).toBe(0);
    expect(handler.getTransactionUrl('tx123')).toBe('https://mempool.space/tx/tx123');
    expect(handler.getAddressUrl('addr123')).toBe('https://mempool.space/address/addr123');
    expect(handler.getBlockUrl('block123')).toBe('https://mempool.space/block/block123');
  });

  it('validates address prefixes and lengths per network', () => {
    const validMainnetP2pkh = `1${'a'.repeat(25)}`;
    const validMainnetP2sh = `3${'b'.repeat(25)}`;
    const validMainnetBech32 = `bc1${'q'.repeat(39)}`;
    const validTestnetP2pkh = `m${'c'.repeat(25)}`;
    const validRegtestBech32 = `bcrt1${'q'.repeat(38)}`;

    expect(validateAddressForNetwork(validMainnetP2pkh, 'mainnet')).toBe(true);
    expect(validateAddressForNetwork(validMainnetP2sh, 'mainnet')).toBe(true);
    expect(validateAddressForNetwork(validMainnetBech32, 'mainnet')).toBe(true);
    expect(validateAddressForNetwork(validTestnetP2pkh, 'testnet')).toBe(true);
    expect(validateAddressForNetwork(validRegtestBech32, 'regtest')).toBe(true);
    expect(validateAddressForNetwork('bad-address', 'mainnet')).toBe(false);
    expect(validateAddressForNetwork(`1${'a'.repeat(10)}`, 'mainnet')).toBe(false);
  });

  it('detects matching network from address', () => {
    const mainnetAddr = `bc1${'q'.repeat(39)}`;
    const testnetAddr = `tb1${'q'.repeat(39)}`;
    const regtestAddr = `bcrt1${'q'.repeat(38)}`;

    expect(detectNetworkFromAddress(mainnetAddr)).toBe('mainnet');
    // testnet and signet share tb1, registry order returns testnet first
    expect(detectNetworkFromAddress(testnetAddr)).toBe('testnet');
    expect(detectNetworkFromAddress(regtestAddr)).toBe('regtest');
    expect(detectNetworkFromAddress('not-a-btc-address')).toBeNull();
  });

  it('throws for unknown networks and supports overwriting handlers', () => {
    expect(() => getNetworkHandler('unknown' as any)).toThrow('Unknown network: unknown');

    const customHandler = {
      getConfig: () => getNetworkConfig('mainnet'),
      validateAddress: () => true,
      getTransactionUrl: (txid: string) => `custom://${txid}`,
      getAddressUrl: (addr: string) => `custom://${addr}`,
      getBlockUrl: (blockHash: string) => `custom://${blockHash}`,
    };
    networkRegistry.register('mainnet', customHandler);

    expect(getNetworkHandler('mainnet').getTransactionUrl('abc')).toBe('custom://abc');
    expect(detectNetworkFromAddress('anything')).toBe('mainnet');
  });
});
