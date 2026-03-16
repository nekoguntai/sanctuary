# BIP Official Test Vector Implementation Plan

## Overview
Add official test vector verification for 4 additional Bitcoin standards, bringing the total from 6 to 10 verified BIP implementations.

## Test Suites to Implement

### 1. BIP-143: SegWit v0 Transaction Digest (Sighash)
**Source:** https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki
**What it tests:** Correct computation of the transaction digest that gets signed for SegWit v0 inputs
**Why it matters:** Incorrect sighash = invalid signatures = lost funds

**Vectors:**
- Native P2WPKH: unsigned tx with 2 inputs, tests sighash for the P2WPKH input
  - Expected sigHash: `c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670`
- P2SH-P2WPKH: unsigned tx with 1 input, tests sighash for wrapped SegWit input
  - Expected sigHash: `64f3b0f4dd2bb3aa1ce8566d220cc74dda9df97d8490cc81d89d735c92e59fb6`

**Approach:** Parse unsigned tx hex with `bitcoinjs-lib`, call `transaction.hashForWitnessV0()` with scriptCode, value, hashType. Compare against expected sighash.

**Files:**
- `tests/fixtures/bip143-test-vectors.ts`
- `tests/unit/services/bitcoin/bip143.verified.test.ts`

---

### 2. BIP-341: Taproot ScriptPubKey & Key Path Spending
**Source:** https://github.com/bitcoin/bips/blob/master/bip-0341/wallet-test-vectors.json
**What it tests:** Taproot output construction (internal key + script tree -> tweaked key -> scriptPubKey -> address) and key path spending sighash computation
**Why it matters:** Verifies P2TR address generation and Taproot transaction signing

**Vectors:**
- 7 scriptPubKey vectors: internal pubkey + script tree -> expected scriptPubKey hex and bip350 address
  - Tests: key-only (no scripts), single leaf, two leaves, three leaves (binary tree)
  - Verifies: tweak computation, tweaked pubkey, Merkle root, control blocks
- 7 keyPathSpending vectors: full transaction with 9 inputs, various SIGHASH types
  - Tests: SIGHASH_SINGLE|ANYONECANPAY (0x83), SIGHASH_ALL (0x01), SIGHASH_DEFAULT (0x00), SIGHASH_NONE (0x02), SIGHASH_NONE|ANYONECANPAY (0x82), SIGHASH_ALL|ANYONECANPAY (0x81), SIGHASH_SINGLE (0x03)
  - Verifies: precomputed hash components, sigMsg construction, final sigHash, witness output

**Approach:**
- ScriptPubKey tests: Use `tiny-secp256k1` for point tweaking, verify scriptPubKey and address match
- KeyPathSpending tests: Verify precomputed hashes (hashAmounts, hashOutputs, hashPrevouts, hashScriptPubkeys, hashSequences), verify per-input sigHash values, verify witness signatures

**Files:**
- `tests/fixtures/bip341-test-vectors.ts`
- `tests/unit/services/bitcoin/bip341.verified.test.ts`

---

### 3. BIP-380: Output Descriptor Checksum (Official Vectors)
**Source:** https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki
**What it tests:** Descriptor checksum algorithm correctness
**Why it matters:** Sanctuary uses descriptors for wallet import; wrong checksum = accepting corrupted descriptors

**Vectors:**
- Valid: `raw(deadbeef)` -> checksum `89f8spxm`
- Invalid cases (7): missing checksum, truncated, too long, payload error, double separator, invalid characters

**Approach:** Test `validateAndRemoveChecksum()` from `src/services/bitcoin/descriptorParser/checksum.ts` directly against official BIP-380 vectors. Existing `descriptorChecksum.test.ts` uses Bitcoin Core vectors but tests through `validateDescriptor()` indirectly.

**Files:**
- `tests/fixtures/bip380-test-vectors.ts`
- `tests/unit/services/bitcoin/bip380.verified.test.ts`

---

### 4. Bitcoin Core key_io: Address Encoding/Decoding
**Source:** https://github.com/bitcoin/bitcoin/blob/master/src/test/data/key_io_valid.json
**What it tests:** Address string <-> scriptPubKey encoding for all address types across all networks
**Why it matters:** Verifies address parsing/generation across P2PKH, P2SH, P2WPKH, P2WSH, P2TR, and higher witness versions

**Vectors:**
- 80 valid entries: [address, scriptPubKey_hex, {chain, isPrivkey, ...}]
  - Covers: mainnet, testnet4, signet, regtest
  - Types: P2PKH (1..., m..., n...), P2SH (3..., 2...), P2WPKH (bc1q..., tb1q...), P2WSH, P2TR (bc1p..., tb1p...), higher witness versions (bc1z..., bc1r..., bc1s...)
  - Also includes WIF private key encoding tests
- ~70 invalid entries: malformed addresses that must be rejected

**Approach:** For address entries (isPrivkey=false, chain=main), decode using bitcoinjs-lib's `address.toOutputScript()` and compare hex against expected scriptPubKey. For private keys, decode WIF and verify the raw key bytes match.

**Files:**
- `tests/fixtures/bitcoin-core-key-io-vectors.ts`
- `tests/unit/services/bitcoin/key-io.verified.test.ts`

---

## Execution Order
1. BIP-380 (simplest, extends existing coverage)
2. BIP-143 (2 vectors, well-defined)
3. Bitcoin Core key_io (data-heavy but straightforward)
4. BIP-341 (most complex, many vectors)

## Expected Test Count
- BIP-380: ~10 tests (1 valid checksum + 7 invalid + format checks)
- BIP-143: ~4 tests (2 sighash computations + round-trip verification)
- key_io: ~90 tests (80 valid + ~10 invalid address samples)
- BIP-341: ~30 tests (7 scriptPubKey + 7 sighash + intermediary verifications)
- **Total new: ~134 tests**
- **Grand total: ~475 verified BIP tests**
