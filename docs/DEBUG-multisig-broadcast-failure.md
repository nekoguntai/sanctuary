# Trezor Multisig Signing - Transaction Version Bug (RESOLVED)

## Problem Summary

2-of-3 multisig wallet with Trezor Safe 7 (USB) + Coldcard (PSBT file) failed to broadcast.

**Error:** `mandatory-script-verify-flag-failed (Script evaluated without error but finished with a false/empty top stack element)`

## Root Cause

**TrezorConnect.signTransaction() defaults to transaction version 1, but our PSBTs use version 2.**

Transaction version is included in the BIP143 sighash preimage for SegWit transactions. When Trezor signs version 1 but the PSBT contains version 2, the sighashes are completely different, making Trezor's signature invalid against the PSBT's expected sighash.

```
Expected: psbtVersion=2, trezorVersion=2 → same sighash → valid signature
Actual:   psbtVersion=2, trezorVersion=1 → different sighash → INVALID signature
```

## Solution

Pass `version` and `locktime` explicitly to TrezorConnect:

```typescript
// services/hardwareWallet/adapters/trezor.ts

const psbtTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Buffer };
const txFromPsbt = bitcoin.Transaction.fromBuffer(psbtTx.toBuffer());

const result = await TrezorConnect.signTransaction({
  inputs,
  outputs,
  refTxs: refTxs.length > 0 ? refTxs : undefined,
  coin,
  push: false,
  version: txFromPsbt.version,   // CRITICAL: Ensure version matches PSBT
  locktime: txFromPsbt.locktime, // CRITICAL: Ensure locktime matches PSBT
});
```

## Validation

The Trezor adapter includes validation to detect mismatches. If version/locktime/outputs/inputs don't match after signing, errors are logged:

- `Transaction version mismatch - Trezor signed different version`
- `Transaction locktime mismatch`
- `Output mismatch between PSBT and Trezor signed transaction`
- `Input mismatch between PSBT and Trezor signed transaction`

The backend also validates signatures before finalization:

- `Invalid signature detected during multisig finalization` - logged when ecc.verify() fails

## Technical Details

For P2WSH multisig (BIP143), the sighash preimage includes:
1. **nVersion** (4 bytes) - Transaction version
2. hashPrevouts (32 bytes)
3. hashSequence (32 bytes)
4. outpoint (36 bytes)
5. scriptCode (varies) - The witnessScript
6. amount (8 bytes)
7. nSequence (4 bytes)
8. hashOutputs (32 bytes)
9. **nLocktime** (4 bytes) - Transaction locktime
10. sighash type (4 bytes)

If any of these differ between what Trezor signs and what's in the PSBT, the signatures will be invalid.

## Files

- `services/hardwareWallet/adapters/trezor.ts` - Trezor signing with version/locktime
- `server/src/services/bitcoin/transactionService.ts` - Signature verification
