# Test Coverage Deep Analysis

**Date:** 2026-01-06
**Current Coverage:** 57.83% Statements, 47.31% Branches, 52.7% Functions, 57.76% Lines
**Test Count:** 3128 backend tests, 1125 frontend tests

---

## Executive Summary

The test suite has grown significantly with recent additions to API integration tests. However, there's a strategic opportunity to **improve test effectiveness by shifting from heavily-mocked unit tests to more integration tests** now that we have a working test database infrastructure.

### Key Findings

1. **2,227 mock calls across 68 unit test files** - many tests are testing mock behavior, not actual code
2. **Integration tests catch real bugs** - we found the `walletSharing` → `walletUser` rename through integration testing
3. **Several critical areas have very low coverage** despite many tests
4. **Some well-tested areas are over-tested with redundant assertions**

---

## Coverage Analysis by Area

### Critical Gaps (< 30% Coverage)

| Area | Coverage | Priority | Issue |
|------|----------|----------|-------|
| `src/api/admin` | 26.47% | HIGH | Admin routes control user management, system settings |
| `src/websocket` | 27.51% | HIGH | Real-time updates, sync status, notifications |
| `src/services/rateLimiting` | 22.33% | MEDIUM | Security feature, rate limiting |
| `src/services/push/providers` | 24.16% | LOW | FCM/APNS push notifications |
| `src/services/import/handlers` | 10.43% | MEDIUM | Coldcard, BlueWallet import handlers |
| `src/errors` | 41.66% | LOW | Error handling classes |

### Files with Almost No Coverage (< 15%)

| File | Coverage | Notes |
|------|----------|-------|
| `descriptor.ts` | 3.84% | Script descriptor handling |
| `nestedSegwit.ts` | 4.76% | Nested SegWit script type |
| `jsonConfig.ts` | 5.71% | JSON config import handler |
| `redisCache.ts` | 6.52% | Redis caching (mocked in tests) |
| `mempool.ts` | 6.79% | Mempool provider |
| `docker.ts` | 7.35% | AI Docker container management |
| `server.ts` | 7.86% | Main server file |
| `redisEventBus.ts` | 7.95% | Redis pub/sub event bus |
| `bluewallet.ts` | 8.33% | BlueWallet export handler |
| `coldcard.ts` | 10% | Coldcard import handler |

### Well-Covered Areas (> 80%)

| Area | Coverage | Assessment |
|------|----------|------------|
| `src/services/authorization` | 90.9% | ✅ Good - security critical |
| `src/services/export` | 96% | ✅ Good - core feature |
| `src/services/scriptTypes` | 96.25% | ✅ Good - Bitcoin handling |
| `src/services/hooks` | 88.14% | ✅ Good |
| `src/services/import` | 93.25% | ✅ Good |
| `src/services/telegram` | 87.2% | ✅ Good |
| `src/services/utxoSelection/strategies` | 95.38% | ✅ Good - coin selection |

---

## Recommendations

### 1. Convert Heavily-Mocked Unit Tests to Integration Tests

**Rationale:** Unit tests with 50+ mocks often test mock configuration, not actual behavior.

**Candidates for conversion:**

| Test File | Mock Count | Recommendation |
|-----------|------------|----------------|
| `admin.test.ts` | 108 | Convert to integration tests |
| `walletImport.test.ts` | 104 | Convert to integration tests |
| `transactionService.test.ts` | 100 | Partial conversion |
| `transactions.test.ts` | 95 | Already have integration tests - remove redundant |
| `blockchain.test.ts` | 180 | Keep some, convert business logic tests |
| `blockchainService.test.ts` | 146 | Keep some, convert business logic tests |

**Example transformation:**

```typescript
// BEFORE: Heavily mocked unit test
jest.mock('../repositories/userRepository');
jest.mock('../repositories/walletRepository');
jest.mock('../services/auditService');
// ... 50 more mocks

it('should create user', async () => {
  mockUserRepo.create.mockResolvedValue({ id: '1', username: 'test' });
  const result = await userService.create({ username: 'test' });
  expect(mockUserRepo.create).toHaveBeenCalledWith({ username: 'test' });
});

// AFTER: Integration test with real database
it('should create user', async () => {
  const user = await createTestUser(prisma, { username: 'test' });
  expect(user.username).toBe('test');

  // Verify in database
  const found = await prisma.user.findUnique({ where: { id: user.id } });
  expect(found).toBeTruthy();
});
```

### 2. Add Integration Tests for Admin API

**Current state:** 26% coverage with heavily mocked tests
**Target:** 70%+ with real database tests

**Tests to add:**
- User creation/deletion with audit logging
- System setting changes with validation
- Backup/restore operations
- User role changes and permission verification
- Rate limiting configuration
- Registration enable/disable

### 3. Add WebSocket Integration Tests

**Current state:** 27% coverage
**Challenge:** WebSocket testing requires special handling

**Approach:**
```typescript
describe('WebSocket Integration', () => {
  let wsClient: WebSocket;

  beforeEach(async () => {
    wsClient = new WebSocket(`ws://localhost:${testPort}/ws`);
    await waitForConnection(wsClient);
  });

  it('should broadcast wallet sync status', async () => {
    // Trigger sync
    await syncService.syncWallet(walletId);

    // Verify WebSocket received status updates
    const messages = await collectMessages(wsClient, 5000);
    expect(messages).toContainEqual(
      expect.objectContaining({ type: 'sync:status' })
    );
  });
});
```

### 4. Remove Redundant Tests

**Criteria for removal:**
- Tests that only verify mock was called (not behavior)
- Duplicate tests between unit and integration
- Tests for trivial getters/setters
- Tests that test the test framework itself

**Example redundant test:**
```typescript
// This test only verifies mock configuration, not behavior
it('should call repository', async () => {
  mockRepo.findById.mockResolvedValue(mockData);
  await service.getById('1');
  expect(mockRepo.findById).toHaveBeenCalledWith('1'); // Redundant
});
```

### 5. Priority Test Additions

#### Priority 1: Security-Critical
- [ ] Admin API permission checks (integration)
- [ ] Rate limiting behavior under load
- [ ] 2FA flow edge cases
- [ ] Token refresh race conditions

#### Priority 2: Business-Critical
- [ ] Transaction broadcasting with real Electrum mock
- [ ] UTXO selection with complex scenarios
- [ ] Import/Export round-trip tests
- [ ] Sync conflict resolution

#### Priority 3: Infrastructure
- [ ] Redis connection failure handling
- [ ] Database transaction rollback
- [ ] WebSocket reconnection

---

## Specific Test Case Improvements

### Transactions: Replace Unit Tests with Integration Tests

**Current:** 95 mocks in `transactions.test.ts` + 32 integration tests
**Recommendation:** Keep integration tests, remove 50% of unit tests

**Unit tests to KEEP:**
- Pure calculation functions (fee estimation math)
- Input validation logic
- Error message formatting

**Unit tests to REMOVE:**
- Any test that only calls repository mock
- Tests duplicated in integration suite
- Tests for simple passthrough functions

### Admin API: Build Integration Test Suite

**Tests needed:**

```typescript
describe('Admin API Integration', () => {
  describe('User Management', () => {
    it('should create admin user with proper audit trail');
    it('should prevent non-admin from accessing admin routes');
    it('should cascade delete user data on user deletion');
    it('should update user role and verify permissions change');
  });

  describe('System Settings', () => {
    it('should update and persist system settings');
    it('should validate setting values');
    it('should emit events on setting changes');
  });

  describe('Backup/Restore', () => {
    it('should create backup with all user data');
    it('should restore backup to empty database');
    it('should handle partial restore on conflict');
  });
});
```

### Import/Export: Add Round-Trip Tests

```typescript
describe('Import/Export Round-Trip', () => {
  it('should export wallet and reimport with same data', async () => {
    // Create wallet with transactions, labels, UTXOs
    const wallet = await createFullWallet(prisma);

    // Export
    const exported = await exportService.export(wallet.id, 'sparrow');

    // Delete wallet
    await prisma.wallet.delete({ where: { id: wallet.id } });

    // Import
    const imported = await importService.import(exported, userId);

    // Verify all data matches
    expect(imported.transactions).toHaveLength(wallet.transactions.length);
    expect(imported.labels).toHaveLength(wallet.labels.length);
  });
});
```

---

## Mock Reduction Strategy

### Phase 1: Identify Pure Functions
Extract pure functions that don't need mocks:
- Fee calculations
- Address validation
- Descriptor parsing
- Amount formatting

### Phase 2: Consolidate Repository Mocks
Create a single mock factory instead of per-test mocking:
```typescript
// Instead of 100 individual mockResolvedValue calls
const mockData = createTestScenario()
  .withUser()
  .withWallet({ transactions: 5, utxos: 10 })
  .build();

configurePrismaMock(mockData);
```

### Phase 3: Use Real Database Where Possible
For any test that:
- Tests business logic with database state
- Verifies relationships between entities
- Tests cascade deletes or updates
- Tests unique constraints

---

## Estimated Impact

| Change | Tests Affected | Coverage Impact | Confidence Impact |
|--------|---------------|-----------------|-------------------|
| Add Admin integration tests | +30 | +5% | HIGH |
| Add WebSocket integration tests | +20 | +3% | HIGH |
| Remove redundant unit tests | -100 | 0% | N/A |
| Convert transaction unit→integration | ±50 | +2% | HIGH |
| Add import/export round-trip | +10 | +2% | MEDIUM |

**Expected outcome:** ~70% statement coverage with significantly higher confidence in test results.

---

## Next Steps

1. **Immediate:** Add Admin API integration tests (highest security impact)
2. **Short-term:** Remove redundant transaction unit tests
3. **Medium-term:** Add WebSocket integration tests
4. **Long-term:** Refactor heavily-mocked services to use test database
