# Address Verification Scripts

This directory contains tools for cross-implementation verification of Bitcoin address generation. The goal is to ensure Sanctuary's address derivation is correct by comparing against multiple independent implementations.

## Overview

The verification script derives addresses using the same inputs across multiple implementations:

| Implementation | Language | Notes |
|----------------|----------|-------|
| Bitcoin Core | C++ | THE reference implementation |
| bitcoinjs-lib | JavaScript | Same library Sanctuary uses |
| Caravan | JavaScript | Unchained Capital's multisig tool |
| bip_utils | Python | Independent Python implementation |
| btcd/btcutil | Go | Powers Lightning Network |

Only addresses where **all implementations agree** are considered verified.

## Prerequisites

### Required
- Node.js 18+
- Docker (for Bitcoin Core)

### Optional (for more implementations)
- Python 3 with bip_utils: `pip install bip_utils`
- Go 1.21+ (for btcd verification)

## Quick Start

### Option A: Use existing beacon-bitcoind (Recommended)

If you're already running Sanctuary, you have a trusted Bitcoin Core instance:

```bash
# Install dependencies
npm install

# Generate verified vectors (uses beacon-bitcoind on localhost:18443)
npm run generate
```

### Option B: Self-built Bitcoin Core (Most Secure)

Build Bitcoin Core from verified official source:

```bash
# Install dependencies
npm install

# Build Bitcoin Core from verified source
cd ../bitcoin-core-docker
./build.sh 27.0

# Start self-built container
cd ../verify-addresses
docker compose -f docker-compose.self-built.yml up -d

# Set environment to use this container
export BITCOIN_RPC_URL=http://127.0.0.1:18553
export BITCOIN_RPC_USER=verify
export BITCOIN_RPC_PASS=verify

# Generate verified vectors
npm run generate
```

### Option C: Third-party Docker image (Quick Start)

Use a third-party Docker image (convenient but requires trusting the image maintainer):

```bash
# Install dependencies
npm install

# Start Bitcoin Core container
docker compose up -d

# Set environment to use this container
export BITCOIN_RPC_URL=http://127.0.0.1:18553
export BITCOIN_RPC_USER=verify
export BITCOIN_RPC_PASS=verify

# Wait for Bitcoin Core to be ready
sleep 5

# Generate verified vectors
npm run generate
```

## Output

The script generates:
- `output/verified-vectors.ts` - TypeScript file with all verified vectors
- `../../server/tests/fixtures/verified-address-vectors.ts` - Same file in test fixtures

## What Gets Tested

### Single-Sig Addresses
- **Script Types**: P2PKH (legacy), P2SH-P2WPKH (nested segwit), P2WPKH (native segwit), P2TR (taproot)
- **Networks**: mainnet, testnet
- **Indices**: 0, 1, 2, 19, 99, 999, 9999, 2147483646 (high index)
- **Change**: Both receive (0) and change (1) addresses

### Multisig Addresses
- **Script Types**: P2SH, P2SH-P2WSH, P2WSH
- **Thresholds**: 2-of-3, 3-of-5
- **Key Ordering**: Tests that different input orders produce same address (BIP-67)

### Test Mnemonic
All derivations use the official BIP-39 test mnemonic:
```
abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
```

## Implementation Details

### Bitcoin Core Integration

Uses Bitcoin Core's `deriveaddresses` RPC which is the canonical implementation:

```bash
# Example: derive a native segwit address
bitcoin-cli deriveaddresses "wpkh([fingerprint/84h/0h/0h]xpub.../0/0)"
```

### Adding New Implementations

1. Create a new file in `implementations/` implementing the `AddressDeriver` interface
2. Export it from the implementation file
3. Add it to the `allImplementations` array in `generate-vectors.ts`

### Verifying Specific Addresses

You can also use the implementations directly:

```typescript
import { bitcoinjsImpl } from './implementations/bitcoinjs.js';

const address = await bitcoinjsImpl.deriveSingleSig(
  'xpub...', // xpub
  0,         // index
  'native_segwit',
  false,     // change
  'mainnet'
);
```

## Troubleshooting

### Bitcoin Core not available
```bash
# Check if container is running
docker compose ps

# View logs
docker compose logs bitcoind

# Restart
docker compose down && docker compose up -d
```

### Python bip_utils not found
```bash
pip install bip_utils
# or
pip3 install bip_utils
```

### Go modules not found
```bash
cd implementations
go mod download
```

## Regenerating Vectors

If you need to regenerate vectors (e.g., after updating implementations):

```bash
npm run generate
```

This will:
1. Check available implementations
2. Generate test cases
3. Verify all cases across implementations
4. Output only cases with consensus
5. Write to both output/ and server/tests/fixtures/

## Why This Matters

Address generation correctness is critical for Bitcoin wallets:
- **Wrong address** = lost funds (sent to address no one controls)
- **Off-by-one errors** = funds sent to wrong person
- **Key ordering bugs** = multisig funds inaccessible

By verifying against 4+ independent implementations, we achieve very high confidence that our implementation is correct.
