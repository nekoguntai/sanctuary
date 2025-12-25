# Testnet Support Implementation Plan

**Status**: In Progress
**Started**: 2025-12-25
**Last Updated**: 2025-12-25

## Overview

Adding testnet/signet support to Sanctuary wallet. The database schema already has a `network` field on wallets, and address validation supports testnet patterns. The main gaps are in the Electrum client (hardcoded mainnet) and UI (no network selection on create, no Electrum server config per network).

---

## Phase 1: Database & Electrum Foundation

### 1.1 Add Network to NodeConfig Schema
- [x] Add `network` field to `NodeConfig` model in `server/prisma/schema.prisma`
- [x] Add `network` field to `ElectrumServer` model
- [x] Create migration (`20251225000000_add_network_to_node_config`)
- [ ] Update seed data with testnet Electrum server presets (deferred)

**Files:**
- `server/prisma/schema.prisma` ✓
- `server/prisma/migrations/20251225000000_add_network_to_node_config/` ✓

### 1.2 Make Electrum Client Network-Aware
- [x] Add `network` parameter to ElectrumClient constructor
- [x] Add `network` property to ElectrumClient class
- [x] Add `getNetworkLib()` helper method
- [x] Fix `addressToScriptHash()` to use network parameter (line ~899)
- [x] Fix `decodeRawTransaction()` to use network (line ~652)
- [x] Create network-keyed client registry instead of singleton
- [x] Export `getElectrumClientForNetwork(network)` function
- [x] Maintain backward compatibility with `getElectrumClient()`

**Files:**
- `server/src/services/bitcoin/electrum.ts` ✓

### 1.3 Update Node Client Abstraction
- [x] Import `getElectrumClientForNetwork` in nodeClient.ts
- [x] Modify `getNodeClient()` to accept optional network parameter (defaults to mainnet)
- [x] Update internal calls to use `getElectrumClientForNetwork(network)`
- [x] Update `syncWallet()` in blockchain.ts to pass wallet network
- [x] Update `subscribeWalletAddresses()` in syncService.ts to pass wallet network

**Files:**
- `server/src/services/bitcoin/nodeClient.ts` ✓
- `server/src/services/bitcoin/blockchain.ts` ✓
- `server/src/services/syncService.ts` ✓

---

## Phase 2: Backend API Updates

### 2.1 Config API for Per-Network Electrum Servers
- [x] Add endpoints to manage Electrum servers by network
- [x] GET `/api/v1/admin/electrum-servers/:network` - get servers for network
- [x] POST `/api/v1/admin/electrum-servers` with network param - add server for network
- [x] Updated getElectrumServers() API helper to accept network parameter
- [x] Validate server network in add/update endpoints

**Files:**
- `server/src/api/admin.ts` ✓
- `src/api/admin.ts` ✓

### 2.2 Wallet API Network Validation
- [x] Validate recipient address network matches wallet network on send (already implemented)
- [x] Return network in wallet list/detail responses (already there)

**Files:**
- `server/src/api/transactions.ts` ✓
- `server/src/services/bitcoin/utils.ts` ✓

---

## Phase 3: Frontend - Electrum Server Configuration UI

### 3.1 Network-Specific Server Settings
- [x] Create `ElectrumServerSettings.tsx` component
- [x] Add tabs for Mainnet/Testnet/Signet servers with color coding
- [x] Show connection status per network in tab badges
- [x] Add preset buttons for common testnet servers:
  - `electrum.blockstream.info:60002` (testnet SSL)
  - `testnet.aranguren.org:51002` (testnet SSL)
  - `testnet.hsmiths.com:53012` (testnet SSL)
- [x] Add preset for signet: `electrum.mutinynet.com:50002`
- [x] Server management per network (add/edit/delete/test/reorder)
- [x] Health status indicators per server

**Files:**
- `components/ElectrumServerSettings.tsx` ✓
- `components/NodeConfig.tsx` ✓

### 3.2 Integrate into NodeConfig
- [x] Integrated ElectrumServerSettings into NodeConfig as Section 4.5
- [x] Show network-specific server configuration UI
- [x] Network badges and health indicators visible per network

**Files:**
- `components/NodeConfig.tsx` ✓

---

## Phase 4: Frontend - Wallet Creation & Display

### 4.1 Create Wallet Network Selection
- [x] Add network selector to CreateWallet.tsx (reused pattern from ImportWallet)
- [x] Default to mainnet with clear testnet/signet options
- [x] Show warning when selecting testnet or signet with color-coded alerts
- [x] Network badge shown in review step before wallet creation
- [x] Network value passed to wallet creation API

**Files:**
- `components/CreateWallet.tsx` ✓

### 4.2 Visual Network Indicators
- [x] Add network badge to wallet cards in grid view (only for non-mainnet)
- [x] Add network badge to wallet table view with color coding
- [x] Add network indicator to wallet detail header (testnet=amber, signet=purple)
- [x] Color-coded badges: mainnet=emerald, testnet=amber, signet=purple

**Files:**
- `components/WalletList.tsx` ✓
- `components/WalletDetail.tsx` ✓

### 4.3 Network-Aware Explorer URLs
- [x] Create utility `getExplorerUrl(baseUrl, network)`
- [x] Create helper functions: `getTxExplorerUrl`, `getAddressExplorerUrl`, `getBlockExplorerUrl`
- [x] Handle mempool.space/testnet and blockstream.info/testnet patterns
- [x] Support for signet URLs (mempool.space/signet)
- [ ] Apply to transaction/address links in WalletDetail (deferred to Phase 6)
- [ ] Apply to TransactionList and TransactionDetail (deferred to Phase 6)

**Files:**
- `utils/explorer.ts` ✓

---

## Phase 5: Hardware Wallet Support

### 5.1 Ledger Testnet Support
- [x] Verify TPUB version constant usage (Lines 28-29: XPUB_VERSION and TPUB_VERSION defined)
- [x] Detects testnet from derivation path (Line 256: checks for "/1'/")
- [x] Uses correct xpub version based on network (Line 257: isTestnet ? TPUB_VERSION : XPUB_VERSION)
- [x] Handle different derivation paths (automatically handled by path detection)

**Files:**
- `services/hardwareWallet/adapters/ledger.ts` ✓

**Implementation Notes:**
- Ledger adapter automatically detects testnet vs mainnet based on coin type in derivation path
- When path contains "/1'/" (coin type 1), uses TPUB_VERSION (0x043587cf)
- When path contains "/0'/" (coin type 0), uses XPUB_VERSION (0x0488b21e)
- No additional changes needed - already fully testnet compatible

### 5.2 Trezor Testnet Support
- [x] Verify Trezor testnet coin type handling (Lines 288-293, 352-353)
- [x] Uses correct coin parameter (Line 293: coin: isTestnet ? 'Testnet' : 'Bitcoin')
- [x] Test derivation and signing with network context (Line 401: uses correct network for address decoding)

**Files:**
- `services/hardwareWallet/adapters/trezor.ts` ✓

**Implementation Notes:**
- Trezor adapter detects testnet from derivation path containing "/1'/"
- Passes correct coin parameter to TrezorConnect.getPublicKey() and signTransaction()
- Uses appropriate network when decoding addresses in PSBT signing
- No additional changes needed - already fully testnet compatible

---

## Phase 6: Testing & Polish

### 6.1 Unit Tests
- [x] Explorer URL generation tests (tests/utils/explorer.test.ts)
  - Tests for mainnet, testnet, signet, and regtest URLs
  - Tests for mempool.space and blockstream.info URL transformations
  - Tests for getTxExplorerUrl, getAddressExplorerUrl, and getBlockExplorerUrl helpers
- [x] Address validation cross-network rejection (tests/utils/validateAddress.test.ts)
  - Tests for getAddressNetwork() function
  - Tests for addressMatchesNetwork() with comprehensive cross-network validation
  - Ensures mainnet addresses rejected on testnet wallets and vice versa
- [x] Electrum client with testnet addresses (server/tests/unit/services/bitcoin/electrum.test.ts)
  - Tests for network-specific client instances
  - Tests for address handling across different networks (mainnet, testnet, signet, regtest)
  - Tests for network library selection (bc1, tb1, bcrt prefixes)
  - Tests for cross-network address validation

**Files:**
- `tests/utils/explorer.test.ts` ✓
- `tests/utils/validateAddress.test.ts` ✓
- `server/tests/unit/services/bitcoin/electrum.test.ts` ✓

### 6.2 Apply Network-Aware Explorer URLs
- [x] Updated WalletDetail to use `getAddressExplorerUrl()` with wallet network
- [x] Updated TransactionList to use `getTxExplorerUrl()` with wallet network
- [x] Updated UTXOList to use network-aware explorer URLs
  - Added `network` prop to UTXOListProps
  - Updated address and transaction links to use explorer helpers

**Files:**
- `components/WalletDetail.tsx` ✓
- `components/TransactionList.tsx` ✓
- `components/UTXOList.tsx` ✓

### 6.3 Integration Tests (Deferred)
- [ ] Connect to testnet Electrum server
- [ ] Sync testnet wallet
- [ ] Build testnet PSBT

### 6.4 Manual Testing Checklist (Deferred)
- [ ] Create testnet wallet (watch-only)
- [ ] Import testnet wallet via descriptor
- [ ] Configure testnet Electrum server
- [ ] Sync testnet transactions
- [ ] Verify testnet address derivation
- [ ] Send testnet transaction (if hardware wallet available)
- [ ] Verify mainnet wallet still works alongside testnet

---

## Default Testnet Electrum Servers

```
# Testnet3
electrum.blockstream.info:60002 (SSL)
testnet.aranguren.org:51002 (SSL)
testnet.hsmiths.com:53012 (SSL)

# Signet (future)
electrum.mutinynet.com:50002 (SSL)
```

---

## Key Technical Decisions

1. **Per-Network Electrum Clients**: Use a Map<network, ElectrumClient> instead of singleton
2. **UI Server Config**: Separate sections for mainnet/testnet servers, not mixed
3. **Visual Differentiation**: Purple accent for testnet, clear badges everywhere
4. **Validation**: Strict - reject sending to wrong network address

---

## Progress Tracking

### Completed
- [x] Initial architecture analysis
- [x] Plan document created
- [x] Phase 1: Database & Electrum Foundation (2025-12-25)
- [x] Phase 2: Backend API Updates (2025-12-25)
- [x] Phase 3: Frontend - Electrum Server Configuration UI (2025-12-25)
- [x] Phase 4: Frontend - Wallet Creation & Display (2025-12-25)
- [x] Phase 5: Hardware Wallet Support (2025-12-25)
- [x] Phase 6: Testing & Polish (2025-12-25)

### In Progress
- None

### Blocked
- None

---

## Notes

- ImportWallet.tsx already has network selector at line 1099 - reuse pattern
- Address validation in utils/validateAddress.ts already complete
- Wallet model already has network field with default "mainnet"
