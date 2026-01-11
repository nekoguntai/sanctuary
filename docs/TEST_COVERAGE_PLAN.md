# Sanctuary Test Coverage Plan

Last updated: 2026-01-11

## Executive Summary

**Current Coverage**: 59% server-side code coverage with ~4,100+ test cases.

The testing foundation is solid with excellent coverage in repositories, export/import services, and authorization. However, there are critical gaps in Bitcoin transaction handling and real-time features.

---

## Current Coverage by Area

| Area | Coverage | Assessment |
|------|----------|------------|
| Repositories | 91% | Excellent |
| Export Services | 93-100% | Excellent |
| Import Services | 95% | Excellent |
| Authorization | 91% | Excellent |
| Middleware | 86% | Good |
| UTXO Selection Strategies | 85% | Good |
| Services (General) | 69% | Moderate |
| Bitcoin Services | 60% | Needs Improvement |
| Cache Services | 42% | Needs Improvement |
| Bitcoin Sync | 28% | **Critical Gap** |
| WebSocket | 24% | **Critical Gap** |
| Push Providers | 24% | Low |
| Admin API | 14% | **Critical Gap** |

---

## Priority 1: Critical (Immediate Attention)

### 1.1 Bitcoin Sync Pipeline Tests
- **Current Coverage**: 28%
- **Location**: `server/src/services/bitcoin/sync/`
- **Risk**: Users could see incorrect balances, miss transactions, or experience UTXO state corruption
- **Effort**: Large (3+ days)

**Files needing tests:**
- `phases/reconcileUtxos.ts`
- `phases/rbfCleanup.ts`
- `addressDiscovery.ts`
- `pipeline.ts`

**Test scenarios:**
- UTXO reconciliation with conflicting states
- Address gap limit detection
- RBF transaction replacement cleanup
- Sync pipeline error recovery

### 1.2 WebSocket Server Tests
- **Current Coverage**: 24%
- **Risk**: Connection leaks, missed wallet updates, race conditions in multi-user signing
- **Effort**: Medium (1-3 days)

**Test scenarios:**
- Connection lifecycle (connect, disconnect, reconnect)
- Multi-client subscription management
- PSBT signing coordination between devices
- Message ordering and delivery guarantees

### 1.3 Admin API Tests
- **Current Coverage**: 14%
- **Location**: `server/src/api/admin.ts`
- **Risk**: Privilege escalation, unauthorized user creation/deletion
- **Effort**: Medium (1-3 days)

**38 endpoints needing coverage:**
- User CRUD operations
- Group management
- System settings modification
- Permission management

---

## Priority 2: High (Next Sprint)

### 2.1 RBF Transaction Tests
- **Effort**: Medium (1-3 days)
- **Location**: `server/src/services/bitcoin/advancedTx.ts`

**Test scenarios:**
- Creating RBF-enabled transactions
- Fee bumping with correct sequence numbers
- Handling conflicting transactions in mempool
- Broadcast replacement validation

### 2.2 Multisig Signing Flow Integration Tests
- **Effort**: Large (3+ days)

**Test scenarios:**
- Quorum verification (m-of-n validation)
- Partial signature aggregation
- Cross-device signing coordination
- Signature ordering for sortedmulti

### 2.3 Electrum Pool Connection Management Tests
- **Current Coverage**: 77 tests exist
- **Effort**: Medium (1-3 days)

**Additional scenarios needed:**
- Connection failover between servers
- Reconnection logic after network issues
- Server health monitoring
- Load balancing behavior

### 2.4 Price Service Provider Failover Tests
- **Current Coverage**: 78%
- **Effort**: Small (< 1 day)

**Test scenarios:**
- API rate limit handling
- Stale data detection
- Provider rotation on failure
- Cache invalidation

---

## Priority 3: Medium

### 3.1 Hardware Wallet Integration Tests (Frontend)
- **Location**: `services/hardwareWallet/`
- **Effort**: Large (3+ days)

**Devices to test:**
- Ledger (Nano S/X, Stax, Flex)
- Trezor (Model T, Safe 3/5/7)
- ColdCard (MK4, Q)
- BitBox02
- Foundation Passport
- Blockstream Jade

### 3.2 Labels API Tests
- **Location**: `server/src/api/labels.ts`
- **Effort**: Small (< 1 day)

**13 endpoints for:**
- Address labeling
- Transaction labeling
- UTXO labeling
- Conflict resolution

### 3.3 Push Notification Provider Tests
- **Current Coverage**: 24%
- **Effort**: Medium (1-3 days)

**Test scenarios:**
- Firebase delivery
- APNS delivery
- Token management and expiry
- Notification batching

### 3.4 Transfer Service Edge Cases
- **Effort**: Small (< 1 day)

**Test scenarios:**
- Partial transfers
- Cancellation mid-transfer
- Device access revocation

### 3.5 Event Bus Redis Integration Tests
- **Current Coverage**: 44%
- **Effort**: Medium (1-3 days)

**Test scenarios:**
- Message ordering guarantees
- Duplicate detection
- Cluster failover
- Split-brain scenarios

---

## Priority 4: Low

### 4.1 AI Service Tests
- **Effort**: Small (< 1 day)
- Timeout handling
- Model unavailability
- Response validation

### 4.2 Theme System Visual Regression Tests
- **Effort**: Small (< 1 day)
- Dark mode color inversion validation
- Seasonal theme transitions

### 4.3 OpenAPI Contract Validation
- **Effort**: Medium (1-3 days)
- Expand to validate all 240 API endpoints against schema

---

## Test Infrastructure Improvements

### 1. Add E2E Test Suite (Playwright)
Create end-to-end tests for critical flows:
- First-time setup and admin creation
- Single-sig wallet creation and receive address generation
- Transaction creation, signing, and broadcast
- Multisig quorum signing flow
- Hardware wallet pairing

### 2. Implement Test Data Builders
Create builder patterns for complex Bitcoin test data:
```typescript
const utxo = new UTXOBuilder()
  .withValue(100000)
  .confirmed(6)
  .forWallet(testWalletId)
  .build();

const psbt = new PSBTBuilder()
  .addInput(utxo)
  .addOutput(address, 50000)
  .withFeeRate(10)
  .build();
```

### 3. Database Seeding Fixtures
Standardize test database state for integration tests with consistent seed data.

### 4. CI Test Splitting
Parallelize the 4000+ tests by type for faster CI feedback:
- Unit tests (parallel)
- Integration tests (sequential with DB)
- Contract tests (parallel)

---

## Current Strengths

1. **Excellent Security Testing**: Comprehensive coverage of password policies, token security, admin self-protection
2. **Bitcoin-Specific Matchers**: Custom Jest matchers (`toBeValidBitcoinAddress`, `toBeValidTxid`, `toBeValidPsbt`)
3. **BIP78 Payjoin Validation**: Thorough PSBT validation tests covering all BIP78 rules
4. **Role-Based Access Testing**: Wallet integration tests verify owner/signer/viewer permissions
5. **Transaction Reducer Tests**: Frontend send flow reducer has comprehensive state management tests

---

## Risk Matrix

| Gap | Business Impact | Technical Risk | Priority |
|-----|-----------------|----------------|----------|
| Sync Pipeline | High - incorrect balances | Critical - data corruption | P1 |
| WebSocket | Medium - UX degradation | High - resource leaks | P1 |
| Admin API | High - security | Critical - privilege escalation | P1 |
| RBF Transactions | Medium - stuck funds | High - double-spend concerns | P2 |
| Multisig Flow | High - signing failures | Medium - UX issues | P2 |
| Hardware Wallet | Medium - device issues | Medium - compatibility | P3 |

---

## Frontend Coverage Improvement Plan

### Current Frontend State (2026-01-11)

| Metric | Current | Threshold | Buffer |
|--------|---------|-----------|--------|
| Lines | 19.07% | 18% | 1.07% |
| Statements | 18.57% | 18% | 0.57% |
| Functions | 14.70% | 14% | 0.70% |
| Branches | 16.91% | 15% | 1.91% |

**Status**: Very tight margins - any regression could break CI.

### Tier 1: Quick Wins (~5% coverage boost)

#### Contexts (0% coverage)
- [ ] ServiceContext.tsx (12 lines)
- [ ] SidebarContext.tsx (11 lines)
- [ ] NotificationContext.tsx (47 lines)
- [ ] SlotContext.tsx (65 lines)

#### Hooks (0% coverage)
- [ ] useCopyToClipboard.ts (10 lines)
- [ ] useErrorHandler.ts (17 lines)
- [ ] useDevices.ts (17 lines)
- [ ] useBitcoin.ts (14 lines, 7%)

#### Utils (0% coverage)
- [ ] clipboard.ts (18 lines)
- [ ] errorHandler.ts (13 lines)

#### Small Components
- [ ] ThemeProvider.tsx (9 lines, 0%)
- [ ] NotificationBadge.tsx (11 lines, 0%)
- [ ] Amount.tsx (12 lines, 8%)

### Tier 2: Medium Effort (~4% more)

- [ ] AppNotificationContext.tsx (118 lines, 0%)
- [ ] Layout.tsx (93 lines, 0%)
- [ ] WalletList.tsx (103 lines, 0%)
- [ ] WalletStats.tsx (63 lines, 0%)
- [ ] NotificationPanel.tsx (79 lines, 0%)
- [ ] LabelManager.tsx (75 lines, 0%)

### Tier 3: High Value (~6% more)

- [ ] SendTransactionContext.tsx (104 lines, 0%)
- [ ] useNotificationSound.ts (528 lines, 0%)
- [ ] ImportWallet.tsx (295 lines, 0%)
- [ ] WalletDetail.tsx (748 lines, 0%)

### Frontend Threshold Targets

After Tier 1 + 2:
```typescript
thresholds: {
  branches: 20,
  functions: 18,
  lines: 25,
  statements: 22,
}
```

After all tiers:
```typescript
thresholds: {
  branches: 25,
  functions: 22,
  lines: 30,
  statements: 28,
}
```
