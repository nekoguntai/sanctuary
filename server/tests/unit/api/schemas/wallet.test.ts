import { describe, it, expect } from 'vitest';
import {
  CreateWalletSchema,
  CreateMultisigWalletSchema,
  BroadcastTransactionSchema,
  GenerateAddressSchema,
  TransactionOutputSchema,
} from '../../../src/api/schemas/wallet';

describe('Wallet Schemas', () => {
  it('validates single-sig wallet creation', () => {
    const result = CreateWalletSchema.safeParse({
      name: 'Test Wallet',
      network: 'mainnet',
      scriptType: 'p2wpkh',
      type: 'standard',
    });
    expect(result.success).toBe(true);
  });

  it('validates multisig wallet with matching signers', () => {
    const result = CreateMultisigWalletSchema.safeParse({
      name: 'Multisig',
      network: 'mainnet',
      scriptType: 'p2wpkh',
      type: 'multisig',
      requiredSignatures: 2,
      totalSigners: 3,
      signers: [
        { xpub: 'xpub' + 'a'.repeat(79) },
        { xpub: 'xpub' + 'b'.repeat(79) },
        { xpub: 'xpub' + 'c'.repeat(79) },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects multisig when required signatures exceed total', () => {
    const result = CreateMultisigWalletSchema.safeParse({
      name: 'Bad Multisig',
      network: 'mainnet',
      scriptType: 'p2wpkh',
      type: 'multisig',
      requiredSignatures: 3,
      totalSigners: 2,
      signers: [
        { xpub: 'xpub' + 'a'.repeat(79) },
        { xpub: 'xpub' + 'b'.repeat(79) },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('requires psbt or rawTx for broadcast', () => {
    const result = BroadcastTransactionSchema.safeParse({});
    expect(result.success).toBe(false);

    const result2 = BroadcastTransactionSchema.safeParse({ psbt: 'cHNidA==' });
    expect(result2.success).toBe(true);
  });

  it('applies defaults for address generation', () => {
    const result = GenerateAddressSchema.parse({});
    expect(result.count).toBe(1);
    expect(result.change).toBe(false);
  });

  it('validates transaction output address/amount', () => {
    const result = TransactionOutputSchema.safeParse({
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      amount: 1000,
    });
    expect(result.success).toBe(true);
  });
});
