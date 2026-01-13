# PSBT Cross-Implementation Verification

This directory contains tools for verifying our PSBT (Partially Signed Bitcoin Transaction) implementation against multiple independent Bitcoin implementations.

## Purpose

PSBT bugs can result in **lost funds** or **stuck transactions**. This verification suite ensures our implementation matches:

1. **Bitcoin Core** - THE reference implementation
2. **bitcoinjs-lib** - Our current implementation
3. **BIP-174 Test Vectors** - Official protocol specification tests

## Quick Start

### 1. Start Bitcoin Core (for full verification)

```bash
cd scripts/verify-psbt
docker compose up -d
```

### 2. Run BIP-174 Compliance Tests

```bash
cd server
npm test -- --run tests/unit/services/bitcoin/psbt.verified.test.ts
```

### 3. Generate Extended Vectors (requires Bitcoin Core)

```bash
cd scripts/verify-psbt
npm install
npm run generate
```

## Directory Structure

```
scripts/verify-psbt/
├── docker-compose.yml      # Bitcoin Core container
├── implementations/
│   ├── bitcoincore.ts     # Bitcoin Core RPC wrapper
│   └── sanctuary.ts       # Our bitcoinjs-lib wrapper
├── types.ts               # Type definitions
├── generate-vectors.ts    # Vector generation script (TODO)
└── README.md              # This file

server/tests/
├── fixtures/
│   └── bip174-test-vectors.ts  # BIP-174 official vectors
└── unit/services/bitcoin/
    └── psbt.verified.test.ts   # PSBT verification tests
```

## Test Categories

### BIP-174 Compliance Tests

Tests each PSBT role defined in BIP-174:

| Role | Purpose |
|------|---------|
| Creator | Creates unsigned transaction |
| Updater | Adds UTXO data, scripts, derivation paths |
| Signer | Adds partial signatures |
| Combiner | Merges multiple PSBTs |
| Finalizer | Creates final scriptSig/witness |
| Extractor | Extracts signed transaction |

### Invalid PSBT Tests

Ensures we correctly reject malformed PSBTs:

- Invalid magic bytes
- Missing required fields
- Duplicate keys
- Malformed structures

### Extended Verification Tests (P2WPKH, P2WSH)

Real-world scenarios verified against Bitcoin Core:

- Single-sig native SegWit (P2WPKH)
- Multisig SegWit (P2WSH)
- Fee calculation accuracy
- Virtual size estimation

## Bitcoin Core RPC Commands

The verification uses these Bitcoin Core RPC methods:

| Command | Purpose |
|---------|---------|
| `decodepsbt` | Parse and display PSBT structure |
| `analyzepsbt` | Get fee, vsize, completion status |
| `createpsbt` | Create unsigned PSBT |
| `combinepsbt` | Merge multiple PSBTs |
| `finalizepsbt` | Create final scriptSig/witness |
| `utxoupdatepsbt` | Update with UTXO data |

## Implementation Details

### Bitcoin Core Wrapper

Located at `implementations/bitcoincore.ts`:

- Supports CLI mode (docker exec) and direct RPC
- Handles regtest, testnet, and mainnet
- Timeout handling for hanging RPC calls

### Sanctuary Wrapper

Located at `implementations/sanctuary.ts`:

- Wraps bitcoinjs-lib Psbt class
- Provides consistent interface with Bitcoin Core wrapper
- Enables direct comparison of outputs

## Adding New Test Vectors

1. Create the vector in `server/tests/fixtures/bip174-test-vectors.ts`
2. Verify with Bitcoin Core:
   ```bash
   docker exec bitcoin-core bitcoin-cli -regtest decodepsbt "<psbt_base64>"
   ```
3. Add test case in `server/tests/unit/services/bitcoin/psbt.verified.test.ts`

## Troubleshooting

### Bitcoin Core Not Starting

```bash
# Check container logs
docker compose logs bitcoin-core

# Restart container
docker compose restart bitcoin-core
```

### RPC Connection Failed

```bash
# Verify Bitcoin Core is ready
docker exec bitcoin-core bitcoin-cli -regtest getblockchaininfo
```

### Tests Failing on Valid PSBTs

1. Check that the PSBT is complete base64 (not truncated)
2. Verify against Bitcoin Core manually:
   ```bash
   docker exec bitcoin-core bitcoin-cli -regtest decodepsbt "<psbt>"
   ```
3. Check for version incompatibilities in bitcoinjs-lib

## References

- [BIP-174: PSBT](https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki)
- [BIP-370: PSBT Version 2](https://github.com/bitcoin/bips/blob/master/bip-0370.mediawiki)
- [bitcoinjs-lib PSBT](https://github.com/bitcoinjs/bitcoinjs-lib/blob/master/src/psbt.js)
- [Bitcoin Core RPC](https://developer.bitcoin.org/reference/rpc/)
