# Sanctuary Codebase Remediation Plan

## Executive Summary

This document provides a comprehensive analysis of the Sanctuary codebase following recent additions including AI integration, coin control panel, and related API endpoints. The analysis identifies issues across severity levels that should be addressed to improve code quality, security, and maintainability.

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [High Priority Issues](#high-priority-issues)
3. [Medium Priority Issues](#medium-priority-issues)
4. [Low Priority Issues](#low-priority-issues)
5. [Dependencies and Fix Order](#dependencies-and-fix-order)

---

## Critical Issues

### CRIT-001: AI Container Config Secret Not Enforced by Default

**File:** `/home/azayaka/sanctuary/ai-proxy/src/index.ts`
**Lines:** 29, 112-120

**Issue:** The `AI_CONFIG_SECRET` environment variable defaults to an empty string, and when empty, any request can configure the AI container.

```typescript
const CONFIG_SECRET = process.env.AI_CONFIG_SECRET || '';
// ...
if (CONFIG_SECRET) {  // Only checks if non-empty
  const providedSecret = req.headers['x-ai-config-secret'];
  if (providedSecret !== CONFIG_SECRET) {
    // ...
  }
}
```

**Impact:** If deployed without setting `AI_CONFIG_SECRET`, any container with network access to the AI container can reconfigure it to point to a malicious AI endpoint.

**Recommendation:**
1. Generate a random secret at container startup if not provided
2. Require the secret header on all configuration requests
3. Add documentation about this security requirement

---

### CRIT-002: Backend Syncs Config to AI Container on Every Request

**File:** `/home/azayaka/sanctuary/server/src/services/aiService.ts`
**Lines:** 248-249, 293-294, 361-362, 397-398

**Issue:** The `syncConfigToContainer` function is called on every AI request (suggest-label, query, list-models, pull-model). This creates unnecessary network overhead and potential race conditions.

```typescript
export async function suggestTransactionLabel(...) {
  // ...
  await syncConfigToContainer(config);  // Called every time
  // ...
}
```

**Impact:**
- Performance degradation on every AI request
- Potential race conditions if multiple requests sync simultaneously
- Config could be partially applied if container restarts during request

**Recommendation:**
1. Cache the last synced config and only sync on changes
2. Add a config version/hash to detect changes
3. Sync on admin settings update, not on every request

---

### CRIT-003: Missing Authentication on AI Container Internal Endpoints

**File:** `/home/azayaka/sanctuary/ai-proxy/src/index.ts`
**Lines:** 206-256

**Issue:** The AI container's internal data fetching endpoints (`fetchTransactionContext`, `fetchWalletLabels`, `fetchWalletContext`) pass the auth token to the backend, but there's no validation that the token is actually valid before making the external AI call.

**Impact:** A malicious request with an invalid token could still trigger external AI calls with fabricated data.

**Recommendation:**
1. Validate backend responses explicitly
2. Return early if backend returns authentication error
3. Add explicit status checks before processing

---

## High Priority Issues

### HIGH-001: Console.log Statements in Production Code

**File:** `/home/azayaka/sanctuary/components/ConnectDevice.tsx`
**Lines:** 506, 513, 519, 587, 616, 682, 704-705, 714, 722, 727, 729, 742, 757, 764, 777, 781, 786, 790, 814, 819, 826, 832, 837, 850-851, 855, 976-977

**Issue:** 30+ `console.log` statements remain in the QR code scanning implementation.

**Impact:**
- Leaks potentially sensitive wallet information to browser console
- Performance impact from string concatenation
- Unprofessional appearance in production

**Recommendation:** Replace all `console.log` with the existing `log.debug()` logger utility.

---

### HIGH-002: Inconsistent Error Handling in Catch Blocks

**Files:** Multiple components throughout `/home/azayaka/sanctuary/components/`

**Issue:** Many catch blocks have inconsistent error handling patterns:
- Some log errors but don't set error state
- Some set error state but don't log
- Some silently swallow errors with empty catches

**Examples:**
```typescript
// WalletDetail.tsx:737 - Only logs, no user feedback
} catch (err) {
  log.error('Failed to fetch user groups', { error: err });
}

// Settings.tsx:122 - Reverts state but doesn't notify user
} catch (err) {
  setEnabled(!newEnabled);  // Silent revert
}
```

**Impact:** Users may not be informed of failures, leading to confusion.

**Recommendation:** Create a standardized error handling utility that:
1. Always logs the error
2. Sets appropriate error state for UI display
3. Optionally shows a notification toast

---

### HIGH-003: Race Condition in CoinControlPanel Privacy Analysis

**File:** `/home/azayaka/sanctuary/components/CoinControlPanel.tsx`
**Lines:** 140-160

**Issue:** Privacy analysis debounce timer doesn't cancel properly, and multiple rapid selections could queue multiple API calls.

```typescript
const timeoutId = setTimeout(() => {
  transactionsApi.analyzeSpendPrivacy(walletId, Array.from(newSelection))
    .then(analysis => {
      setPrivacyAnalysis(analysis);
    })
    .catch(...);
}, 300);
```

**Impact:** Stale privacy analysis data could be displayed, or unnecessary API calls made.

**Recommendation:** Store timeout ID in a ref and clear it on unmount and before setting new timer.

---

### HIGH-004: TODO: Remove Invalid Tokens Left Unimplemented

**File:** `/home/azayaka/sanctuary/gateway/src/services/backendEvents.ts`
**Line:** 196

**Issue:** A TODO comment indicates invalid tokens should be removed from the database, but this is not implemented.

```typescript
// TODO: Remove invalid tokens from database
```

**Impact:** Invalid push notification tokens accumulate in the database, causing failed push attempts and wasted resources.

**Recommendation:** Implement token cleanup when backend reports token is invalid.

---

### HIGH-005: Missing Loading/Error States in AILabelSuggestion

**File:** `/home/azayaka/sanctuary/components/AILabelSuggestion.tsx`

**Issue:** Based on the component usage patterns, the AILabelSuggestion component may not properly handle all error states from the AI service.

**Recommendation:**
1. Add explicit loading spinner during AI request
2. Show user-friendly error message when AI is unavailable
3. Handle timeout scenarios gracefully

---

### HIGH-006: Unvalidated Type Assertions in AI Service

**File:** `/home/azayaka/sanctuary/server/src/services/aiService.ts`
**Lines:** 210, 263, 268, 308, 313, 341, 375, 413

**Issue:** Multiple `as any` type assertions on fetch responses without validation.

```typescript
const result = await response.json() as any;
return result.suggestion || null;
```

**Impact:** Runtime errors if AI container returns unexpected response format.

**Recommendation:**
1. Define explicit response types
2. Validate response structure before accessing properties
3. Use Zod or similar for runtime validation

---

## Medium Priority Issues

### MED-001: Type Mismatch in Frontend AI Status Response

**File:** `/home/azayaka/sanctuary/src/api/ai.ts`
**Lines:** 13-19

**vs Backend:** `/home/azayaka/sanctuary/server/src/api/ai.ts`
**Lines:** 48-54

**Issue:** Frontend `AIStatus` type doesn't include `containerAvailable` field that backend returns.

Frontend:
```typescript
export interface AIStatus {
  available: boolean;
  model?: string;
  endpoint?: string;
  error?: string;
  message?: string;
}
```

Backend returns:
```typescript
res.json({
  available: health.available,
  model: health.model,
  endpoint: health.endpoint,
  containerAvailable: health.containerAvailable,  // Missing in frontend type
  error: health.error,
});
```

**Recommendation:** Add `containerAvailable?: boolean` to frontend `AIStatus` interface.

---

### MED-002: Hardcoded Rate Limits Across Multiple Locations

**Files:**
- `/home/azayaka/sanctuary/ai-proxy/src/index.ts` (lines 48-49)
- `/home/azayaka/sanctuary/server/src/api/ai.ts` (lines 23-29)
- `/home/azayaka/sanctuary/gateway/src/middleware/rateLimit.ts`

**Issue:** Rate limiting values are hardcoded in multiple places (10 requests/minute in AI container and server).

**Recommendation:**
1. Move rate limit configuration to environment variables
2. Create a single source of truth for rate limit values
3. Document the rate limits in API documentation

---

### MED-003: Missing Validation in UTXO Selection Service

**File:** `/home/azayaka/sanctuary/server/src/services/utxoSelectionService.ts`
**Lines:** 405-455

**Issue:** The `selectUtxos` function doesn't validate that `targetAmount` is a positive BigInt.

**Recommendation:** Add input validation at the start of the function.

---

### MED-004: Potential Memory Leak in Rate Limiter

**File:** `/home/azayaka/sanctuary/ai-proxy/src/index.ts`
**Lines:** 47-66

**Issue:** The in-memory rate limit store grows unbounded and only cleans up when size exceeds 1000.

```typescript
const rateLimitStore = new Map<string, RateLimitEntry>();
// Only cleans when size > 1000
if (rateLimitStore.size > 1000) {
  // cleanup...
}
```

**Impact:** Memory could grow indefinitely before cleanup is triggered.

**Recommendation:**
1. Use a more efficient data structure (LRU cache)
2. Add periodic cleanup timer
3. Consider using a proper rate limiting library (e.g., express-rate-limit)

---

### MED-005: Inconsistent BigInt to Number Conversion

**File:** `/home/azayaka/sanctuary/server/src/api/transactions.ts`
**Lines:** 79-96

**Issue:** Transaction amounts are converted to Number for JSON serialization, but this could lose precision for very large amounts (> 2^53 satoshis = ~90M BTC).

**Recommendation:**
1. Convert to string for amounts near Number.MAX_SAFE_INTEGER
2. Document the precision limitations
3. Consider using a BigInt-safe JSON serializer

---

### MED-006: Duplicate Privacy Score Calculation Logic

**Files:**
- `/home/azayaka/sanctuary/server/src/services/privacyService.ts` (getGrade function)
- `/home/azayaka/sanctuary/server/src/services/utxoSelectionService.ts` (inline score calculation)

**Issue:** Privacy score to grade conversion logic is duplicated.

**Recommendation:** Extract shared utility function for score-to-grade conversion.

---

### MED-007: Missing Timeout Cleanup in WalletDetail Payjoin Effect

**File:** `/home/azayaka/sanctuary/components/WalletDetail.tsx`
**Lines:** 389-423

**Issue:** The Payjoin URI fetch effect sets up a timeout but the cleanup may not properly abort the in-flight request.

**Recommendation:** Use AbortController in addition to the cancelled flag.

---

### MED-008: Gateway Whitelist Pattern Could Miss Edge Cases

**File:** `/home/azayaka/sanctuary/gateway/src/routes/proxy.ts`
**Lines:** 63-106

**Issue:** UUID regex pattern `[a-f0-9-]+` allows any length, not exactly 36 characters.

```typescript
{ method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]+$/ },
```

**Recommendation:** Use stricter UUID regex: `[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`

---

### MED-009: Missing CORS Origin Validation Edge Case

**File:** `/home/azayaka/sanctuary/gateway/src/index.ts`
**Lines:** 30-45

**Issue:** When `corsAllowedOrigins` is empty, all origins are allowed. This is documented but could be unintentional in production.

**Recommendation:** Add a warning log when CORS is open.

---

## Low Priority Issues

### LOW-001: Unused Import Pattern in Types

**File:** `/home/azayaka/sanctuary/types.ts`

**Issue:** The file is quite large and may contain type definitions that are no longer used.

**Recommendation:** Run TypeScript unused export analyzer and remove dead types.

---

### LOW-002: Inconsistent Logging Patterns

**Files:** Multiple throughout codebase

**Issue:** Some files use `console.log`, some use the custom `createLogger`, some use `log.info/debug/error`.

**Recommendation:** Standardize on `createLogger` pattern throughout.

---

### LOW-003: Magic Numbers in Privacy Service

**File:** `/home/azayaka/sanctuary/server/src/services/privacyService.ts`
**Lines:** 18-25

**Issue:** Privacy scoring weights are defined as magic numbers without documentation.

```typescript
const WEIGHTS = {
  ADDRESS_REUSE: -20,
  CLUSTER_LINKAGE: -5,
  // ...
};
```

**Recommendation:** Add JSDoc explaining the rationale for each weight.

---

### LOW-004: Missing Export Statement Documentation

**File:** `/home/azayaka/sanctuary/src/api/admin.ts`

**Issue:** API functions are exported but not re-exported from an index file, making imports verbose.

**Recommendation:** Create index.ts barrel exports for API modules.

---

### LOW-005: Inconsistent Async/Await vs .then() Usage

**Files:** Multiple components

**Issue:** Some code uses async/await, some uses .then(). This is stylistically inconsistent.

**Examples:**
- `WalletDetail.tsx:602` uses `.then()`
- `WalletDetail.tsx:731` uses `await Promise.all`

**Recommendation:** Standardize on async/await throughout.

---

### LOW-006: SpendPrivacyCard Missing Default Export

**File:** `/home/azayaka/sanctuary/components/SpendPrivacyCard.tsx`
**Line:** 154

**Issue:** Component uses named export only, inconsistent with some other components.

**Recommendation:** Add default export for consistency or document the pattern.

---

### LOW-007: Missing aria-label Attributes

**Files:** Various components

**Issue:** Some interactive elements lack proper accessibility labels.

**Recommendation:** Add aria-label to icon-only buttons and interactive elements.

---

### LOW-008: Strategy Selector Could Have TypeScript Enum

**File:** `/home/azayaka/sanctuary/components/StrategySelector.tsx`
**File:** `/home/azayaka/sanctuary/server/src/services/utxoSelectionService.ts`

**Issue:** Selection strategy is defined as a union type in multiple places.

**Recommendation:** Create a shared enum or const object for strategy values.

---

## Dependencies and Fix Order

### Phase 1: Critical Security (Week 1)
1. **CRIT-001** - AI Config Secret - Standalone, no dependencies
2. **CRIT-002** - Config Sync Optimization - Depends on understanding current state
3. **CRIT-003** - Internal Endpoint Auth - Standalone

### Phase 2: High Priority Stability (Week 2)
4. **HIGH-001** - Console.log Cleanup - Standalone
5. **HIGH-002** - Error Handling Standardization - Create utility first, then apply
6. **HIGH-003** - Race Condition Fix - Standalone
7. **HIGH-004** - Token Cleanup - Standalone
8. **HIGH-005** - AILabelSuggestion States - After HIGH-002
9. **HIGH-006** - Type Assertions - Standalone

### Phase 3: Medium Priority Quality (Week 3)
10. **MED-001** - Type Mismatch - Standalone
11. **MED-002** - Rate Limit Config - Standalone
12. **MED-003** - Input Validation - Standalone
13. **MED-004** - Memory Leak - Standalone
14. **MED-005** - BigInt Conversion - Standalone
15. **MED-006** - Duplicate Logic - Standalone
16. **MED-007** - Timeout Cleanup - Standalone
17. **MED-008** - UUID Pattern - Standalone
18. **MED-009** - CORS Warning - Standalone

### Phase 4: Low Priority Polish (Week 4+)
- All LOW priority items can be addressed in any order

---

## Summary Statistics

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 6 |
| Medium | 9 |
| Low | 8 |
| **Total** | **26** |

---

## Next Steps

1. Review this plan with the development team
2. Create tickets/issues for each item
3. Prioritize based on upcoming release schedule
4. Begin Phase 1 fixes immediately
5. Add automated checks to prevent regression (linting rules, tests)

---

*Document generated: 2024-12-20*
*Codebase version: 0.4.9*
