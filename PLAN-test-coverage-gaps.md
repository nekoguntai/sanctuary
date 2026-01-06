# Test Coverage Gaps - Implementation Plan

Created: 2026-01-04
Updated: 2026-01-06
Status: **Phases 1, 2, 3, 4 Complete** (Task 4.1, 4.2 deferred)

> **Note:** A follow-up analysis identified additional gaps in API route coverage.
> See `docs/TEST_COVERAGE_ANALYSIS.md` for the expanded plan addressing API routes,
> import/export handlers, and infrastructure tests.

## Progress Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 - Infrastructure | Done | setup.ts with builders, factories, assertion helpers |
| Phase 1 - Core Repositories | Done | User, Wallet, Transaction, Address, UTXO, Device |
| Phase 1 - Remaining Repos | Done | Draft, Label, AuditLog, Session, SystemSetting, PushDevice, WalletSharing |
| Phase 3 - Backup/Restore | Done | Extended backupService.test.ts with restore, error handling, migrations, edge cases |
| Phase 4 - Sync Logic | Done | Created syncService.test.ts (34 tests) + blockchainService.test.ts (31 tests) = 65 tests |

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

#### Task 1.1: Create Repository Test Infrastructure [DONE]
**File:** `server/tests/integration/repositories/setup.ts`
- [x] Create test database connection helper
- [x] Add transaction rollback wrapper for test isolation
- [x] Create seed data fixtures for each entity type
- [x] Added TestScenarioBuilder for complex test setups
- [x] Added assertion helpers (assertExists, assertNotExists, assertCount)
- [x] Added data generators (generateId, generateTxid, generateFingerprint)

#### Task 1.2: User Repository Tests [DONE]
**File:** `server/tests/integration/repositories/userRepository.test.ts`
- [x] Test `create`, `findById`, `findByUsername`
- [x] Test `updatePassword`, `updateTwoFactor`
- [x] Test `delete` with cascade behavior
- [x] Test unique constraint violations

#### Task 1.3: Wallet Repository Tests [DONE]
**File:** `server/tests/integration/repositories/walletRepository.test.ts`
- [x] Test `create` for single-sig and multi-sig wallets
- [x] Test `findById`, `findByUserId`, `getIdsByNetwork`
- [x] Test `findByNetworkWithSyncStatus`
- [x] Test `resetSyncState`, `updateSyncStatus`
- [x] Test cascade delete behavior (addresses, transactions, UTXOs)
- [x] Test group-based wallet access

#### Task 1.4: Transaction Repository Tests [DONE]
**File:** `server/tests/integration/repositories/transactionRepository.test.ts`
- [x] Test `create`, `findById`, `findByWalletId`
- [x] Test `updateConfirmations`, `updateRbfStatus`
- [x] Test `deleteByWalletId` (batch delete)
- [x] Test `findPendingByWalletId`
- [x] Test ordering and pagination
- [x] Test RBF replacement chain tracking

#### Task 1.5: Address Repository Tests [DONE]
**File:** `server/tests/integration/repositories/addressRepository.test.ts`
- [x] Test `create`, `findById`, `findByWalletId`
- [x] Test `markAsUsed`, `resetUsedFlags`
- [x] Test `findUnusedReceive`, `findUnusedChange`
- [x] Test gap limit logic
- [x] Test batch operations

#### Task 1.6: UTXO Repository Tests [DONE]
**File:** `server/tests/integration/repositories/utxoRepository.test.ts`
- [x] Test `create`, `createMany`, `findByWalletId`
- [x] Test `markSpent`, `markUnspent`
- [x] Test `findUnspent`, `calculateBalance`
- [x] Test `deleteByWalletId`
- [x] Test freeze/unfreeze
- [x] Test dust detection
- [x] Test coin control queries

#### Task 1.7: Device Repository Tests [DONE]
**File:** `server/tests/integration/repositories/deviceRepository.test.ts`
- [x] Test `create`, `findById`, `findByUserId`
- [x] Test `findByFingerprint`
- [x] Test device-wallet associations
- [x] Test device accounts (multi-path support)
- [x] Test device sharing (user and group)
- [x] Test hardware model associations

#### Task 1.8: Draft Repository Tests [DONE]
**File:** `server/tests/integration/repositories/draftRepository.test.ts`
- [x] Test `create`, `findById`, `findByWalletId`
- [x] Test PSBT data storage and updates
- [x] Test signing workflow and signature collection
- [x] Test UTXO locking for drafts
- [x] Test expiration and cascade deletes

#### Task 1.9: Label Repository Tests [DONE]
**File:** `server/tests/integration/repositories/labelRepository.test.ts`
- [x] Test `create`, `findById`, `findByWalletId`
- [x] Test transaction labels and address labels
- [x] Test label associations
- [x] Test cascade deletes

#### Task 1.10: Remaining Repository Tests [DONE]
**Files:** Individual test files for:
- [x] `auditLogRepository.test.ts` - filtering, pagination, groupBy, security monitoring
- [x] `sessionRepository.test.ts` - refresh tokens, JWT revocation, session management
- [x] `systemSettingRepository.test.ts` - upsert, type-specific getters, prefix queries
- [x] `pushDeviceRepository.test.ts` - platform filtering, stale cleanup, cascade deletes
- [x] `walletSharingRepository.test.ts` - wallet roles, group access, access control queries

---

## 2. Backup/Restore Tests Enhancement [DONE]

### Current State
- Extended `backupService.test.ts` with comprehensive test coverage
- Added ~600 lines of new tests

### Implementation Tasks

#### Task 2.1: Restore Operation Tests [DONE]
**File:** `server/tests/unit/services/backupService.test.ts`
- [x] Test successful restore of minimal backup
- [x] Test restore order (dependency resolution)
- [x] Test restore handles BigInt deserialization
- [x] Test restore handles Date deserialization

#### Task 2.2: Error Recovery Tests [DONE]
**File:** `server/tests/unit/services/backupService.test.ts`
- [x] Test partial restore failure (should rollback)
- [x] Test database connection failures
- [x] Test foreign key violations
- [x] Test timeout handling

#### Task 2.3: Migration/Version Tests [DONE]
**File:** `server/tests/unit/services/backupService.test.ts`
- [x] Test backup from older schema version
- [x] Test rejection of incompatible versions
- [x] Test forward compatibility warnings

#### Task 2.4: Edge Case Tests [DONE]
**File:** `server/tests/unit/services/backupService.test.ts`
- [x] Test backup with special characters in strings
- [x] Test backup with null/undefined values
- [x] Test backup with empty arrays
- [x] Test nested JSON fields
- [x] Test very long strings

#### Task 2.5: Encrypted Backup Tests [DONE]
**File:** `server/tests/unit/services/backupService.test.ts`
- [x] Test node config password handling
- [x] Test decryption failure scenarios

---

## 3. Sync Logic Tests Enhancement [DONE]

### Current State
- Created two comprehensive test files with 65 tests total:
  - `syncService.test.ts` - 34 tests for service orchestration
  - `blockchainService.test.ts` - 31 tests for blockchain operations

### Implementation Tasks

#### Task 3.1: Blockchain Service Unit Tests [DONE]
**File:** `server/tests/unit/services/blockchainService.test.ts`
- [x] Test syncWallet and syncAddress operations
- [x] Test transaction creation and detection
- [x] Test broadcast and fee estimation

#### Task 3.2: Transaction Detection Tests [DONE]
**File:** `server/tests/unit/services/blockchainService.test.ts`
- [x] Test detecting incoming (received) transactions
- [x] Test detecting outgoing (sent) transactions
- [x] Test detecting consolidation transactions
- [x] Test handling RBF replacement transactions
- [x] Test fee calculation from inputs/outputs

#### Task 3.3: UTXO Management Tests [DONE]
**File:** `server/tests/unit/services/blockchainService.test.ts`
- [x] Test UTXO creation from blockchain
- [x] Test UTXO spending detection
- [x] Test invalidation of draft transactions using spent UTXOs
- [x] Test UTXO confirmation updates
- [x] Test skipDuplicates behavior

#### Task 3.4: Reorg Handling Tests [DONE]
**File:** `server/tests/unit/services/blockchainService.test.ts`
- [x] Test confirmation count reset on reorg
- [x] Test UTXOs becoming unspent after reorg
- [x] Test transaction confirmation updates during sync

#### Task 3.5: Concurrent Sync Tests [DONE]
**File:** `server/tests/unit/services/syncService.test.ts`
- [x] Test distributed locking (acquire/release)
- [x] Test skip sync when lock cannot be acquired
- [x] Test concurrent sync limiting
- [x] Test queue management with priorities

#### Task 3.6: Address Discovery Tests [DONE]
**File:** `server/tests/unit/services/blockchainService.test.ts`
- [x] Test gap limit checking
- [x] Test address generation when gap is insufficient
- [x] Test handling both receive and change address chains
- [x] Test skip wallets without descriptors

#### Task 3.7: Error Handling Tests [DONE]
**Files:** `syncService.test.ts` + `blockchainService.test.ts`
- [x] Test Electrum connection failure
- [x] Test timeout handling
- [x] Test retry logic with exponential backoff
- [x] Test database error handling
- [x] Test broadcast failure handling

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

## Phase 5 - API Integration Tests and Redundancy Cleanup

### Task 5.1: Admin API Integration Tests [DONE]
**File:** `server/tests/integration/flows/admin.integration.test.ts`
- [x] User management (CRUD, validation, cascade deletes)
- [x] Group management (CRUD, member management)
- [x] Audit logging verification
- [x] Access control integration (group membership → wallet access)
- **Result:** 48 new integration tests added

### Task 5.2: Transaction Unit Test Redundancy Cleanup [DEFERRED]
**File:** `server/tests/unit/api/transactions.test.ts`

Analysis findings:
- 75 unit tests with heavy mocking (131 mockPrismaClient usages)
- 32 integration tests now provide real database coverage
- ~50% of unit tests are redundant with integration tests

**Tests to KEEP** (testing logic, not mocks):
- Confirmation Calculation (3 tests) - pure math
- BigInt Serialization (5 tests) - serialization logic
- Running Balance (2 tests) - business logic
- Input Validation (4 tests) - validation rules
- Error handling scenarios

**Tests to REMOVE** (redundant with integration):
- GET /transactions - basic CRUD covered by integration
- GET /pending - covered by integration
- GET /export - covered by integration
- GET /utxos - covered by integration
- POST /recalculate - covered by integration
- PATCH freeze - covered by integration

**Recommendation:** ~30-40 tests can be removed (~50% reduction)
**Status:** Deferred to avoid risk, integration tests provide better coverage

### Task 5.3: WebSocket Integration Tests [DEFERRED]
**Analysis:** WebSocket already has comprehensive unit tests (634 lines) covering:
- Configuration and limits
- JWT authentication
- Wallet access validation
- Event channel mapping
- Message format validation
- Subscription validation
- Gateway HMAC challenge-response
- Close codes

**Coverage gap reason:** Unit tests test logic in isolation; integration would require HTTP server with WebSocket upgrade. Given thorough unit coverage, this is lower priority.

**Potential future integration tests:**
- [ ] Full connection lifecycle with real WS client
- [ ] Multi-instance broadcasting via Redis bridge
- [ ] Load testing with many concurrent connections

---

## Notes

- All repository tests should use a test database with transaction rollback
- Sync tests should mock Electrum responses, not hit real servers
- Consider using `jest-extended` for additional matchers
- Run integration tests in CI with real PostgreSQL (via docker-compose.test.yml)
