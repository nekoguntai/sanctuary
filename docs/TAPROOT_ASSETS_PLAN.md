# Taproot Assets Support - Implementation Plan

## Executive Summary

Adding Taproot Assets support to Sanctuary would enable tracking and displaying assets like USDC/USDT that are issued on Bitcoin via the Taproot Assets protocol. The key challenge is that hardware wallets (Coldcard, Trezor, etc.) only see the underlying Bitcoin transaction - Sanctuary must decode and overlay the asset information.

**Core Approach**: Sanctuary acts as an "asset-aware layer" that:
1. Detects Taproot Asset commitments in transactions
2. Fetches asset metadata from Universe servers
3. Displays asset amounts alongside BTC transactions
4. Constructs valid asset transfers that hardware wallets can sign (they just see BTC)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Sanctuary                                 │
├─────────────────────────────────────────────────────────────────┤
│  Frontend                                                        │
│  ├─ Asset Balance Display (USDC: 1,000,000)                     │
│  ├─ Transaction List (shows both BTC + Asset amounts)           │
│  └─ Asset Transfer UI (creates valid Taproot Asset PSBTs)       │
├─────────────────────────────────────────────────────────────────┤
│  Backend                                                         │
│  ├─ Universe Client (fetches asset proofs/metadata)             │
│  ├─ Asset Sync Phase (decodes commitments from transactions)    │
│  ├─ Asset Balance Tracker (per-wallet asset balances)           │
│  └─ PSBT Builder (embeds asset commitments)                     │
├─────────────────────────────────────────────────────────────────┤
│  External                                                        │
│  ├─ Universe Server (universe.lightning.finance)                │
│  ├─ Electrum Server (existing)                                  │
│  └─ Hardware Wallet (signs BTC tx, unaware of assets)           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation & Asset Discovery
**Priority: CRITICAL** | **Effort: HIGH (3-4 weeks)** | **Risk: MEDIUM**

### 1.1 Database Schema Extensions

| Task | Effort | Risk |
|------|--------|------|
| Add `Asset` model (id, name, ticker, assetId, decimals, totalSupply, issuanceOutpoint, universeHost) | Low | Low |
| Add `AssetBalance` model (walletId, assetId, balance, lastSync) | Low | Low |
| Add `AssetTransaction` model (transactionId, assetId, amount, type, proofData) | Medium | Low |
| Add `AssetUTXO` model (utxoId, assetId, amount, proofAnchor) | Medium | Low |
| Migration scripts for existing data | Low | Medium |

**Schema Design:**

```prisma
model Asset {
  id              String   @id @default(uuid())
  assetId         String   @unique  // Taproot Asset ID (32 bytes hex)
  name            String
  ticker          String?
  decimals        Int      @default(0)
  totalSupply     BigInt?
  issuanceOutpoint String?  // txid:vout of issuance
  universeHost    String?  // Custom universe server
  metaHash        String?  // Asset metadata hash
  createdAt       DateTime @default(now())

  balances        AssetBalance[]
  transactions    AssetTransaction[]
  utxos           AssetUTXO[]
}

model AssetBalance {
  id        String   @id @default(uuid())
  walletId  String
  assetId   String
  balance   BigInt
  utxoCount Int      @default(0)
  lastSync  DateTime @default(now())

  wallet    Wallet   @relation(fields: [walletId], references: [id])
  asset     Asset    @relation(fields: [assetId], references: [id])

  @@unique([walletId, assetId])
  @@index([walletId])
}

model AssetTransaction {
  id            String   @id @default(uuid())
  transactionId String
  assetId       String
  amount        BigInt
  type          String   // "send" | "receive" | "issuance"
  proofData     Bytes?   // Serialized proof
  createdAt     DateTime @default(now())

  transaction   Transaction @relation(fields: [transactionId], references: [id])
  asset         Asset       @relation(fields: [assetId], references: [id])

  @@index([transactionId])
  @@index([assetId])
}

model AssetUTXO {
  id          String   @id @default(uuid())
  utxoId      String
  assetId     String
  amount      BigInt
  proofAnchor String?  // Reference to proof storage
  spent       Boolean  @default(false)

  utxo        UTXO     @relation(fields: [utxoId], references: [id])
  asset       Asset    @relation(fields: [assetId], references: [id])

  @@unique([utxoId, assetId])
  @@index([assetId, spent])
}
```

### 1.2 Universe Client Integration

| Task | Effort | Risk |
|------|--------|------|
| Create `UniverseClient` service with REST/gRPC support | High | Medium |
| Implement asset metadata fetching (name, decimals, supply) | Medium | Low |
| Implement proof fetching and validation | High | High |
| Add caching layer for asset metadata | Medium | Low |
| Handle multiple universe servers (default + custom) | Medium | Medium |

**Key APIs to integrate** ([Taproot Assets API Reference](https://lightning.engineering/api-docs/api/taproot-assets/)):
- `GET /v1/taproot-assets/universe/roots` - List all known assets
- `GET /v1/taproot-assets/universe/leaves/asset-id/{asset_id}` - Get asset proofs
- `GET /v1/taproot-assets/assets/{asset_id}` - Get asset metadata

### 1.3 Asset Detection in Sync Pipeline

| Task | Effort | Risk |
|------|--------|------|
| Create `AssetDetectionPhase` for sync pipeline | High | High |
| Decode Taproot output commitments | High | High |
| Match commitments against known assets | Medium | Medium |
| Store asset transaction records | Medium | Low |

**Risk Mitigation**: Start with read-only detection before attempting transfers.

---

## Phase 2: Balance Tracking & Display
**Priority: HIGH** | **Effort: MEDIUM (2-3 weeks)** | **Risk: LOW**

### 2.1 Asset Balance Calculation

| Task | Effort | Risk |
|------|--------|------|
| Create `assetBalanceService` for balance aggregation | Medium | Low |
| Extend wallet sync to include asset balance updates | Medium | Medium |
| Add `recalculateAssetBalances()` similar to BTC | Medium | Low |
| Handle asset decimals for display (e.g., 6 for USDC) | Low | Low |

### 2.2 Repository Layer

| Task | Effort | Risk |
|------|--------|------|
| Create `assetRepository` for asset CRUD | Low | Low |
| Create `assetBalanceRepository` for balance queries | Low | Low |
| Create `assetTransactionRepository` for history | Low | Low |
| Add batch operations for performance | Medium | Low |

### 2.3 API Endpoints

| Task | Effort | Risk |
|------|--------|------|
| `GET /api/wallets/:id/assets` - List wallet assets | Low | Low |
| `GET /api/wallets/:id/assets/:assetId/transactions` - Asset history | Medium | Low |
| `GET /api/assets` - List all known assets | Low | Low |
| `GET /api/assets/:id` - Asset details | Low | Low |

### 2.4 Frontend Display

| Task | Effort | Risk |
|------|--------|------|
| Create `AssetBalance` component | Medium | Low |
| Add asset column to wallet overview | Low | Low |
| Create `AssetAmount` formatter (handles decimals) | Low | Low |
| Add asset filter to transaction list | Medium | Low |
| Show asset info in transaction details | Medium | Low |

---

## Phase 3: Asset Transfers (Send)
**Priority: HIGH** | **Effort: HIGH (3-4 weeks)** | **Risk: HIGH**

### 3.1 PSBT Construction with Asset Commitments

| Task | Effort | Risk |
|------|--------|------|
| Extend `transactionService` for asset transfers | High | High |
| Generate valid Taproot Asset commitment structures | High | High |
| Build correct witness data for asset outputs | High | High |
| Handle change outputs (both BTC and asset change) | Medium | High |

**Critical Insight**: Hardware wallets see only the BTC transaction. The asset commitment is embedded in the Taproot script tree. Sanctuary must:
1. Build the PSBT with correct Taproot outputs
2. Include asset proof data in proprietary PSBT fields
3. Hardware wallet signs the BTC spend
4. Sanctuary attaches asset proofs post-signing

### 3.2 Asset UTXO Selection

| Task | Effort | Risk |
|------|--------|------|
| Extend coin selection for asset UTXOs | Medium | Medium |
| Handle mixed BTC + asset inputs | Medium | High |
| Calculate correct fees (asset txs are larger) | Medium | Medium |

### 3.3 Frontend Send Flow

| Task | Effort | Risk |
|------|--------|------|
| Add asset selector to send wizard | Medium | Low |
| Show asset amounts in review step | Medium | Low |
| Handle asset-specific validation (sufficient balance) | Medium | Low |
| Update transaction summary for assets | Low | Low |

### 3.4 Hardware Wallet Integration

| Task | Effort | Risk |
|------|--------|------|
| Test Coldcard signing with asset PSBTs | High | High |
| Test Trezor signing with asset PSBTs | High | High |
| Document device-specific quirks | Medium | Low |
| Add fallback for incompatible devices | Medium | Medium |

---

## Phase 4: Asset Receiving & Proof Management
**Priority: MEDIUM** | **Effort: MEDIUM (2-3 weeks)** | **Risk: MEDIUM**

### 4.1 Proof Storage & Validation

| Task | Effort | Risk |
|------|--------|------|
| Store asset proofs in database | Medium | Low |
| Implement proof chain validation | High | High |
| Handle proof updates on new blocks | Medium | Medium |
| Prune old proofs (configurable retention) | Low | Low |

### 4.2 Receive Address Generation

| Task | Effort | Risk |
|------|--------|------|
| Generate Taproot addresses for asset receives | Medium | Medium |
| Create asset-specific invoice format | Medium | Low |
| QR code generation for asset receives | Low | Low |

### 4.3 Automatic Asset Detection

| Task | Effort | Risk |
|------|--------|------|
| Detect new asset receives during sync | Medium | Medium |
| Auto-register unknown assets from universe | Medium | Medium |
| Notify user of new asset receipts | Low | Low |

---

## Phase 5: Advanced Features
**Priority: LOW** | **Effort: VARIABLE** | **Risk: VARIABLE**

### 5.1 Asset Issuance (Optional)

| Task | Effort | Risk |
|------|--------|------|
| Create asset issuance workflow | Very High | Very High |
| Manage issuance authority keys | High | High |
| Implement supply management | High | High |

**Recommendation**: Defer issuance to future release. Focus on transfers first.

### 5.2 Multi-Asset Transactions

| Task | Effort | Risk |
|------|--------|------|
| Support multiple assets in single transaction | High | High |
| Handle complex change scenarios | High | High |
| UI for multi-asset sends | High | Medium |

### 5.3 Lightning Network Integration

| Task | Effort | Risk |
|------|--------|------|
| Asset transfers over Lightning | Very High | Very High |
| Channel balance tracking with assets | Very High | Very High |

**Recommendation**: Out of scope for initial implementation.

---

## Beneficial Enhancements

### Enhancement 1: Asset Discovery UI
**Effort: LOW** | **Value: HIGH**

- Browse popular assets from default universe
- One-click "watch" to track an asset
- Show asset metadata (issuer, supply, description)

### Enhancement 2: Price Feed Integration
**Effort: MEDIUM** | **Value: HIGH**

- Fetch USDC/USDT prices (trivial - they're $1)
- Show fiat equivalent for asset balances
- Historical price tracking for non-stablecoins

### Enhancement 3: Asset Labels & Notes
**Effort: LOW** | **Value: MEDIUM**

- Custom labels for asset transactions
- Notes field for asset transfers
- Export asset transaction history

### Enhancement 4: Proof Export/Import
**Effort: MEDIUM** | **Value: HIGH**

- Export proofs for backup
- Import proofs from other wallets
- Proof verification UI

### Enhancement 5: Batch Asset Transfers
**Effort: HIGH** | **Value: MEDIUM**

- Send to multiple recipients in one transaction
- Useful for payroll/distributions
- Complex fee calculation

### Enhancement 6: Asset Freezing
**Effort: LOW** | **Value: MEDIUM**

- Freeze specific asset UTXOs (like BTC coin control)
- Prevent accidental spending
- Privacy management for assets

---

## Risk Assessment Summary

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Taproot Assets protocol changes | Medium | High | Pin to specific tapd version, abstract protocol layer |
| Hardware wallet compatibility | Medium | High | Extensive testing, graceful degradation |
| Universe server availability | Medium | Medium | Support multiple servers, local caching |
| Proof validation complexity | High | High | Start read-only, comprehensive testing |
| Performance with many assets | Low | Medium | Pagination, lazy loading, caching |
| Security of asset proofs | Medium | Very High | Cryptographic validation, audit trail |

---

## Implementation Timeline

```
Phase 1: Foundation (Weeks 1-4)
├─ Week 1-2: Database schema, Universe client
├─ Week 3-4: Asset detection in sync pipeline
└─ Milestone: Can detect and display asset transactions ✓

Phase 2: Balance & Display (Weeks 5-7)
├─ Week 5: Balance calculation, repositories
├─ Week 6-7: API endpoints, frontend display
└─ Milestone: Full read-only asset support ✓

Phase 3: Asset Transfers (Weeks 8-11)
├─ Week 8-9: PSBT construction with commitments
├─ Week 10: Hardware wallet testing
├─ Week 11: Frontend send flow
└─ Milestone: Can send assets via hardware wallet ✓

Phase 4: Receiving & Proofs (Weeks 12-14)
├─ Week 12: Proof storage and validation
├─ Week 13-14: Receive flow, auto-detection
└─ Milestone: Full send/receive asset support ✓

Phase 5: Polish & Enhancements (Weeks 15-16)
├─ Week 15: Asset discovery UI, labels
├─ Week 16: Testing, documentation
└─ Milestone: Production-ready release ✓
```

**Total Estimated Effort: 16 weeks (4 months)** for full implementation.

---

## Recommended MVP Scope

For a minimal viable implementation, focus on:

1. **Read-Only Detection** (Phase 1 + 2): ~6 weeks
   - Detect asset transactions in existing wallets
   - Display asset balances and history
   - No transfer capability initially

2. **Add Transfers** (Phase 3): +4 weeks
   - Send assets via hardware wallet
   - Basic UTXO selection

**MVP Total: ~10 weeks** to see "1,000,000 USDC" in a 2-of-3 multisig wallet.

---

## Dependencies & Prerequisites

### External Dependencies
- [Taproot Assets Protocol Spec](https://github.com/lightninglabs/taproot-assets)
- [Lightning Labs Universe API](https://docs.lightning.engineering/lightning-network-tools/taproot-assets/universes)
- [tapd v0.7+](https://lightning.engineering/posts/2025-12-16-tapd-0.7-launch/) for latest features

### Internal Prerequisites
- Current Taproot (P2TR) support in Sanctuary (already exists)
- Multisig PSBT signing flow (already working)
- Electrum integration (already working)

### Development Environment
- Local tapd instance for testing
- Testnet assets for development
- Hardware wallet test devices

---

## Questions to Resolve

1. **Universe Server Strategy**: Use public universe only, or allow custom servers?
2. **Proof Retention**: How long to keep proofs? (Storage vs. verification tradeoff)
3. **Asset Whitelisting**: Show all assets or only user-added ones?
4. **Fee Attribution**: How to display fees for asset transfers? (BTC fees, but asset transfer)
5. **Multisig Threshold**: Should asset transfers require same threshold as BTC?

---

## Sources

- [Lightning Labs Universes Documentation](https://docs.lightning.engineering/lightning-network-tools/taproot-assets/universes)
- [Taproot Assets API Reference](https://lightning.engineering/api-docs/api/taproot-assets/)
- [GitHub: lightninglabs/taproot-assets](https://github.com/lightninglabs/taproot-assets)
- [Taproot Assets v0.7 Announcement](https://lightning.engineering/posts/2025-12-16-tapd-0.7-launch/)
- [Taproot Assets v0.6 Announcement](https://lightning.engineering/posts/2025-6-24-tapd-v0.6-launch/)
- [Getting Started with tapd](https://docs.lightning.engineering/lightning-network-tools/taproot-assets/get-tapd)
