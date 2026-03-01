import { describe, it, expect } from 'vitest';
import { useBitcoin, useWallets } from '../../../hooks/queries';
import { useBitcoin as useBitcoinDirect } from '../../../hooks/queries/useBitcoin';
import { useWallets as useWalletsDirect } from '../../../hooks/queries/useWallets';

describe('hooks/queries index exports', () => {
  it('re-exports the query hooks', () => {
    expect(useBitcoin).toBe(useBitcoinDirect);
    expect(useWallets).toBe(useWalletsDirect);
  });
});
