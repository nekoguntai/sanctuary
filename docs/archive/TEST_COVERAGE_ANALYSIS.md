# Test Coverage Analysis & Recommendations

**Date:** 2026-01-06
**Current Global Coverage:** 52.38% statements, 42.2% branches, 45.98% functions

## Executive Summary

The recent threshold reduction in `transactionService.ts` (from 70% → 65%) was caused by error handling improvements that added new code paths without corresponding tests. While the existing test coverage plan (PLAN-test-coverage-gaps.md) addressed repositories, backup/restore, and sync logic, **the API routes remain the largest untested area** with several critical endpoints at <15% coverage.

---

## Coverage Status Overview

### Global Thresholds (Current vs Target)

| Metric | Current | Threshold | Target | Gap |
|--------|---------|-----------|--------|-----|
| Statements | 52.38% | 25% | 70% | -17.62% |
| Branches | 42.2% | 15% | 60% | -17.8% |
| Functions | 45.98% | 20% | 65% | -19.02% |
| Lines | 52.19% | 25% | 70% | -17.81% |

### Critical File Coverage

| File | Statements | Lines of Code | Risk Level |
|------|------------|---------------|------------|
| `src/api/transactions.ts` | **7.89%** | 2,121 | 🔴 CRITICAL |
| `src/api/auth.ts` | **11%** | 1,558 | 🔴 CRITICAL |
| `src/api/wallets.ts` | **11.23%** | 1,085 | 🔴 CRITICAL |
| `src/api/labels.ts` | **13.75%** | ~400 | 🟠 HIGH |
| `src/api/bitcoin.ts` | **20%** | ~900 | 🟠 HIGH |
| `src/api/drafts.ts` | **22.38%** | ~200 | 🟠 HIGH |
| `src/api/price.ts` | **21.15%** | ~320 | 🟡 MEDIUM |
| `src/services/bitcoin/transactionService.ts` | **65.46%** | 2,603 | 🟡 MEDIUM |

---

## Root Cause Analysis

### Why Thresholds Were Lowered

The `transactionService.ts` threshold was reduced because:

1. **Error handling improvements** added try-catch blocks and error type checking
2. **New code paths** were added without corresponding test coverage
3. **The existing tests** cover the happy paths but not edge cases and error conditions

**Specific uncovered lines** (from coverage report):
- Lines 263-550: Transaction building edge cases
- Lines 1299-1381: Multisig finalization error handling
- Lines 1883-1944: PSBT validation error paths
- Lines 2427-2446: Fee calculation edge cases

### Structural Issues

1. **API routes are almost completely untested** - The largest files have <15% coverage
2. **Integration tests exist but don't count toward coverage** - They're skipped in CI
3. **Import/Export handlers are untested** - Critical for data integrity
4. **Redis/Infrastructure code is untested** - Affects production reliability

---

## Prioritized Recommendations

### Phase 1: Critical API Route Tests (HIGH PRIORITY)
**Estimated Effort: 2-3 weeks**
**Impact: +15-20% global coverage**

These are the highest-value targets because they're large files with critical functionality:

#### 1.1 Transaction API Tests
**File:** `server/tests/unit/api/transactions.test.ts` (expand existing)
**Current:** 7.89% → **Target:** 60%

```
Priority endpoints to test:
- POST /transactions/create (single-sig)
- POST /transactions/batch (multisig)
- POST /transactions/broadcast
- GET /transactions/:id
- GET /transactions/wallet/:walletId
- POST /transactions/rbf
- DELETE /transactions/:id
```

**Test scenarios needed:**
- [ ] Create transaction with valid inputs
- [ ] Create transaction with insufficient balance
- [ ] Create transaction with invalid address
- [ ] Broadcast signed PSBT
- [ ] Broadcast with network error
- [ ] RBF replacement flow
- [ ] Transaction with multiple outputs
- [ ] Transaction with coin control

#### 1.2 Auth API Tests
**File:** `server/tests/unit/api/auth.test.ts` (expand existing)
**Current:** 11% → **Target:** 70%

```
Priority endpoints to test:
- POST /auth/login
- POST /auth/register
- POST /auth/refresh
- POST /auth/logout
- POST /auth/2fa/enable
- POST /auth/2fa/verify
- POST /auth/password/change
- POST /auth/recovery
```

**Test scenarios needed:**
- [ ] Successful login with valid credentials
- [ ] Login with invalid password
- [ ] Login with 2FA enabled
- [ ] Token refresh flow
- [ ] Session invalidation
- [ ] Password change with verification
- [ ] 2FA enable/disable flow
- [ ] Backup code usage

#### 1.3 Wallet API Tests
**File:** `server/tests/unit/api/wallets.test.ts` (expand existing)
**Current:** 11.23% → **Target:** 60%

```
Priority endpoints to test:
- POST /wallets (create single-sig)
- POST /wallets/multisig (create multisig)
- GET /wallets/:id
- GET /wallets/:id/balance
- DELETE /wallets/:id
- POST /wallets/:id/sync
- POST /wallets/:id/export
```

---

### Phase 2: TransactionService Recovery (MEDIUM PRIORITY)
**Estimated Effort: 1 week**
**Impact: Restore threshold to 70%+**

The `transactionService.ts` threshold was lowered from 70% to 65%. To restore it:

#### 2.1 Add Error Path Tests
**File:** `server/tests/unit/services/bitcoin/transactionService.test.ts`

```typescript
// Test scenarios to add:
describe('error handling', () => {
  it('should handle insufficient funds gracefully');
  it('should validate PSBT structure before signing');
  it('should handle network timeouts during broadcast');
  it('should handle invalid multisig configurations');
  it('should handle missing witness data');
  it('should handle fee estimation failures');
});
```

#### 2.2 Add Edge Case Tests

```typescript
describe('edge cases', () => {
  it('should handle dust outputs correctly');
  it('should handle maximum transaction size');
  it('should handle RBF with multiple replacements');
  it('should handle CPFP transactions');
  it('should handle consolidation with frozen UTXOs');
});
```

**Specific lines to cover:**
| Line Range | Description | Test Needed |
|------------|-------------|-------------|
| 263-550 | Transaction building | Insufficient funds, invalid outputs |
| 1299-1381 | Multisig finalization | Missing signatures, invalid PSBT |
| 1883-1944 | PSBT validation | Malformed PSBT, wrong network |
| 2427-2446 | Fee calculation | Zero fee, excessive fee |

---

### Phase 3: Import/Export Handler Tests (MEDIUM PRIORITY)
**Estimated Effort: 1 week**
**Impact: Data integrity assurance**

These handlers are critical for wallet portability but have <10% coverage:

#### 3.1 Import Handler Tests
**Location:** `server/tests/unit/services/import/`

| Handler | Current | Target | Priority |
|---------|---------|--------|----------|
| `coldcard.ts` | 10% | 80% | HIGH |
| `bluewallet.ts` | 10.52% | 70% | MEDIUM |
| `descriptor.ts` | 20% | 80% | HIGH |
| `walletExport.ts` | 9.52% | 70% | MEDIUM |
| `jsonConfig.ts` | 5.71% | 60% | LOW |

**Test scenarios:**
- [ ] Parse valid Coldcard JSON export
- [ ] Handle Coldcard with missing fields
- [ ] Parse multisig descriptor correctly
- [ ] Handle invalid descriptor syntax
- [ ] Parse BlueWallet backup format

#### 3.2 Export Handler Tests
**Location:** `server/tests/unit/services/export/`

| Handler | Current | Target |
|---------|---------|--------|
| `descriptor.ts` | 3.84% | 70% |
| `bluewallet.ts` | 4.16% | 60% |
| `sparrow.ts` | 5.55% | 60% |

---

### Phase 4: Infrastructure Tests (LOW PRIORITY)
**Estimated Effort: 2 weeks**
**Impact: Production reliability**

These affect production stability but are lower priority for coverage:

#### 4.1 Redis Infrastructure
| File | Current | Notes |
|------|---------|-------|
| `redisEventBus.ts` | 7.95% | Critical for multi-instance |
| `redis.ts` | 20.58% | Connection handling |
| `redisCache.ts` | 6.52% | Cache operations |

#### 4.2 Rate Limiting
| File | Current | Notes |
|------|---------|-------|
| `rateLimit.ts` | 11.76% | API protection |
| `memoryRateLimiter.ts` | 10.81% | Fallback limiter |
| `redisRateLimiter.ts` | 10% | Production limiter |

#### 4.3 Background Services
| File | Current | Notes |
|------|---------|-------|
| `eventService.ts` | 15.27% | Event processing |
| `deadLetterQueue.ts` | 15.78% | Failed event handling |
| `migrationService.ts` | 13.72% | Data migrations |

---

## Quick Wins (Immediate Impact)

These changes can be made quickly to improve coverage:

### 1. Enable Integration Tests in Coverage
Currently, integration tests are skipped. Enabling them would add significant coverage:

```javascript
// jest.config.js - add integration tests to coverage
testMatch: [
  '**/*.test.ts',
  '**/integration/**/*.test.ts'  // Add this
],
```

### 2. Add Missing Test Files
Create stub test files for completely untested modules:

```bash
# These files have 0% coverage and no tests:
touch server/tests/unit/api/labels.test.ts
touch server/tests/unit/api/price.test.ts
touch server/tests/unit/services/import/coldcard.test.ts
touch server/tests/unit/services/export/descriptor.test.ts
```

### 3. Consolidate Mocks
Many tests duplicate mock setups. Centralizing would:
- Reduce test maintenance burden
- Make it easier to add new tests
- Ensure consistent mock behavior

---

## Coverage Threshold Roadmap

### Immediate (This Week)
```javascript
// Keep current thresholds, focus on not regressing
global: { branches: 15, functions: 20, lines: 25, statements: 25 }
transactionService: { statements: 65, branches: 50, functions: 63, lines: 65 }
```

### Short-term (2-4 weeks)
```javascript
// After Phase 1 API tests
global: { branches: 25, functions: 30, lines: 40, statements: 40 }
transactionService: { statements: 70, branches: 55, functions: 70, lines: 70 }
```

### Medium-term (1-2 months)
```javascript
// After Phases 2-3
global: { branches: 35, functions: 40, lines: 50, statements: 50 }
// Add thresholds for API routes
'./src/api/transactions.ts': { statements: 50, lines: 50 }
'./src/api/auth.ts': { statements: 60, lines: 60 }
'./src/api/wallets.ts': { statements: 50, lines: 50 }
```

### Long-term (3+ months)
```javascript
// Target state
global: { branches: 50, functions: 55, lines: 65, statements: 65 }
```

---

## Metrics to Track

| Metric | Current | 2-Week Target | 1-Month Target |
|--------|---------|---------------|----------------|
| Global Statements | 52.38% | 55% | 60% |
| Global Branches | 42.2% | 45% | 50% |
| API Routes Avg | ~15% | 30% | 50% |
| Critical Services | 65% | 70% | 75% |

---

## Implementation Priority Matrix

| Task | Effort | Impact | Risk if Skipped | Priority |
|------|--------|--------|-----------------|----------|
| Transaction API tests | High | Very High | 🔴 Critical | P0 |
| Auth API tests | High | Very High | 🔴 Critical | P0 |
| Wallet API tests | Medium | High | 🔴 Critical | P1 |
| TransactionService recovery | Medium | Medium | 🟠 High | P1 |
| Import handlers | Medium | Medium | 🟠 High | P2 |
| Export handlers | Low | Medium | 🟡 Medium | P2 |
| Redis infrastructure | High | Low | 🟡 Medium | P3 |
| Rate limiting | Medium | Low | 🟢 Low | P3 |

---

## Conclusion

The test coverage reduction was a symptom of rapid feature development outpacing test coverage. The biggest gap is in **API route testing**, which should be the immediate focus. By implementing Phase 1 (API route tests), we can:

1. Increase global coverage by ~15-20%
2. Catch regressions in critical user-facing functionality
3. Restore confidence to raise thresholds incrementally

**Recommended immediate actions:**
1. Create comprehensive `transactions.test.ts` (highest impact)
2. Expand `auth.test.ts` with 2FA and session tests
3. Add wallet creation and sync tests to `wallets.test.ts`
4. Add error path tests to restore `transactionService.ts` to 70%
