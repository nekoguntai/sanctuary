# Test Coverage Gaps - Implementation Plan

Created: 2026-01-04
Status: **Pending Implementation**

## Overview

QA analysis identified three major coverage gaps in the codebase:

| Area | Current Coverage | Target | Priority |
|------|-----------------|--------|----------|
| Repository Layer | ~0% | 80%+ | High |
| Backup/Restore | ~40% | 80%+ | High |
| Sync Logic | ~20% | 70%+ | Medium |

---

## 1. Repository Layer Tests (~3,461 LOC, 14 repositories)

### Current State
- No dedicated repository tests exist
- Repositories are tested indirectly through service/API tests
- 14 repository files need coverage

### Files to Test
```
server/src/repositories/
├── addressRepository.ts
├── auditLogRepository.ts
├── deviceRepository.ts
├── draftRepository.ts
├── labelRepository.ts
├── pushDeviceRepository.ts
├── sessionRepository.ts
├── systemSettingRepository.ts
├── transactionRepository.ts
├── userRepository.ts
├── utxoRepository.ts
├── walletRepository.ts
└── walletSharingRepository.ts
```

### Implementation Tasks

#### Task 1.1: Create Repository Test Infrastructure
**File:** `server/tests/integration/repositories/setup.ts`
- Create test database connection helper
- Add transaction rollback wrapper for test isolation
- Create seed data fixtures for each entity type

#### Task 1.2: User Repository Tests
**File:** `server/tests/integration/repositories/userRepository.test.ts`
- Test `create`, `findById`, `findByUsername`
- Test `updatePassword`, `updateTwoFactor`
- Test `delete` with cascade behavior
- Test unique constraint violations

#### Task 1.3: Wallet Repository Tests
**File:** `server/tests/integration/repositories/walletRepository.test.ts`
- Test `create` for single-sig and multi-sig wallets
- Test `findById`, `findByUserId`, `getIdsByNetwork`
- Test `findByNetworkWithSyncStatus`
- Test `resetSyncState`, `updateSyncStatus`
- Test cascade delete behavior (addresses, transactions, UTXOs)

#### Task 1.4: Transaction Repository Tests
**File:** `server/tests/integration/repositories/transactionRepository.test.ts`
- Test `create`, `findById`, `findByWalletId`
- Test `updateConfirmations`, `updateRbfStatus`
- Test `deleteByWalletId` (batch delete)
- Test `findPendingByWalletId`
- Test ordering and pagination

#### Task 1.5: Address Repository Tests
**File:** `server/tests/integration/repositories/addressRepository.test.ts`
- Test `create`, `findById`, `findByWalletId`
- Test `markAsUsed`, `resetUsedFlags`
- Test `findUnusedReceive`, `findUnusedChange`
- Test gap limit logic

#### Task 1.6: UTXO Repository Tests
**File:** `server/tests/integration/repositories/utxoRepository.test.ts`
- Test `create`, `createMany`, `findByWalletId`
- Test `markSpent`, `markUnspent`
- Test `findUnspent`, `calculateBalance`
- Test `deleteByWalletId`

#### Task 1.7: Device Repository Tests
**File:** `server/tests/integration/repositories/deviceRepository.test.ts`
- Test `create`, `findById`, `findByUserId`
- Test `findByFingerprint`
- Test device-wallet associations

#### Task 1.8: Draft Repository Tests
**File:** `server/tests/integration/repositories/draftRepository.test.ts`
- Test `create`, `findById`, `findByWalletId`
- Test `updateSignatures`, `updateStatus`
- Test `delete`

#### Task 1.9: Label Repository Tests
**File:** `server/tests/integration/repositories/labelRepository.test.ts`
- Test `create`, `findById`, `findByWalletId`
- Test `attachToAddress`, `attachToTransaction`
- Test `detach` operations

#### Task 1.10: Remaining Repository Tests
**Files:** Individual test files for:
- `auditLogRepository.test.ts` - Test log creation, querying by user/action
- `sessionRepository.test.ts` - Test session CRUD, expiration
- `systemSettingRepository.test.ts` - Test get/set settings
- `pushDeviceRepository.test.ts` - Test push token management
- `walletSharingRepository.test.ts` - Test share/unshare, role management

---

## 2. Backup/Restore Tests Enhancement

### Current State
- 526 lines in `backupService.test.ts`
- Covers: validation, basic create/export, serialization
- Missing: restore logic, error recovery, edge cases

### Implementation Tasks

#### Task 2.1: Restore Operation Tests
**File:** `server/tests/unit/services/backupService.test.ts` (extend)
```typescript
describe('restoreBackup', () => {
  // Test successful restore of minimal backup
  // Test restore order (dependency resolution)
  // Test restore with existing data (should clear first)
  // Test restore preserves referential integrity
  // Test restore handles BigInt deserialization
  // Test restore handles Date deserialization
});
```

#### Task 2.2: Error Recovery Tests
**File:** `server/tests/unit/services/backupService.test.ts` (extend)
```typescript
describe('restore error handling', () => {
  // Test partial restore failure (should rollback)
  // Test corrupted data handling
  // Test missing required fields
  // Test invalid foreign key references
  // Test database constraint violations
});
```

#### Task 2.3: Migration/Version Tests
**File:** `server/tests/unit/services/backupService.test.ts` (extend)
```typescript
describe('schema version handling', () => {
  // Test backup from older schema version
  // Test migration path execution
  // Test rejection of incompatible versions
  // Test forward compatibility warnings
});
```

#### Task 2.4: Edge Case Tests
**File:** `server/tests/unit/services/backupService.test.ts` (extend)
```typescript
describe('edge cases', () => {
  // Test very large backup (memory handling)
  // Test backup with special characters in strings
  // Test backup with null/undefined values
  // Test backup with empty arrays for all tables
  // Test concurrent backup/restore operations
});
```

#### Task 2.5: Encrypted Backup Tests
**File:** `server/tests/unit/services/backupService.test.ts` (extend)
```typescript
describe('encrypted backups', () => {
  // Test create encrypted backup
  // Test restore encrypted backup with correct password
  // Test restore encrypted backup with wrong password
  // Test password strength validation
});
```

---

## 3. Sync Logic Tests Enhancement

### Current State
- 299 lines in `sync.test.ts` (API layer only)
- Missing: BlockchainService sync logic, reorg handling, concurrent sync

### Implementation Tasks

#### Task 3.1: Blockchain Service Unit Tests
**File:** `server/tests/unit/services/blockchain.test.ts` (new)
```typescript
describe('BlockchainService', () => {
  describe('syncWallet', () => {
    // Test initial sync (no prior data)
    // Test incremental sync (existing data)
    // Test sync with new transactions found
    // Test sync with confirmations updated
    // Test sync with no changes
  });
});
```

#### Task 3.2: Transaction Detection Tests
**File:** `server/tests/unit/services/blockchain.test.ts` (extend)
```typescript
describe('transaction detection', () => {
  // Test detecting incoming transactions
  // Test detecting outgoing transactions
  // Test detecting internal transfers (self-send)
  // Test handling unconfirmed transactions
  // Test handling RBF transactions
  // Test handling CPFP transactions
});
```

#### Task 3.3: UTXO Management Tests
**File:** `server/tests/unit/services/blockchain.test.ts` (extend)
```typescript
describe('UTXO management', () => {
  // Test UTXO creation on receive
  // Test UTXO spending detection
  // Test UTXO balance calculation
  // Test handling dust UTXOs
  // Test UTXO consolidation scenarios
});
```

#### Task 3.4: Reorg Handling Tests
**File:** `server/tests/unit/services/blockchain.test.ts` (extend)
```typescript
describe('reorg handling', () => {
  // Test detection of reorg (block hash mismatch)
  // Test rollback of affected transactions
  // Test re-sync after reorg
  // Test deep reorg handling (>6 blocks)
});
```

#### Task 3.5: Concurrent Sync Tests
**File:** `server/tests/unit/services/blockchain.test.ts` (extend)
```typescript
describe('concurrent sync', () => {
  // Test multiple wallets syncing simultaneously
  // Test queue priority handling
  // Test sync lock mechanism
  // Test graceful handling of stuck syncs
});
```

#### Task 3.6: Address Discovery Tests
**File:** `server/tests/unit/services/blockchain.test.ts` (extend)
```typescript
describe('address discovery', () => {
  // Test gap limit handling (receive)
  // Test gap limit handling (change)
  // Test address generation on demand
  // Test derivation path consistency
});
```

#### Task 3.7: Error Handling Tests
**File:** `server/tests/unit/services/blockchain.test.ts` (extend)
```typescript
describe('sync error handling', () => {
  // Test Electrum connection failure
  // Test timeout handling
  // Test retry logic
  // Test partial sync failure recovery
  // Test invalid response handling
});
```

---

## 4. Test Utility Consolidation

### Current State
- Some test utilities duplicated between frontend/backend
- Mock factories scattered across test files

### Implementation Tasks

#### Task 4.1: Shared Test Fixtures
**File:** `server/tests/fixtures/` (consolidate)
- Consolidate all entity fixtures (users, wallets, devices, etc.)
- Create factory functions for generating test data
- Document fixture usage patterns

#### Task 4.2: Mock Consolidation
**File:** `server/tests/mocks/` (consolidate)
- Create centralized mock registry
- Document which mocks exist and how to use them
- Remove duplicate mock implementations

---

## Implementation Order

Recommended order based on risk and dependency:

1. **Phase 1 - Infrastructure** (Tasks 1.1, 4.1, 4.2)
   - Set up test infrastructure before writing tests

2. **Phase 2 - Repository Layer** (Tasks 1.2-1.10)
   - Foundation for all other tests
   - Can run integration tests against test database

3. **Phase 3 - Backup/Restore** (Tasks 2.1-2.5)
   - Critical for data safety
   - Depends on repository layer for restore testing

4. **Phase 4 - Sync Logic** (Tasks 3.1-3.7)
   - Most complex, requires Electrum mocking
   - Can be done in parallel with Phase 3

---

## Notes

- All repository tests should use a test database with transaction rollback
- Sync tests should mock Electrum responses, not hit real servers
- Consider using `jest-extended` for additional matchers
- Run integration tests in CI with real PostgreSQL (via docker-compose.test.yml)
