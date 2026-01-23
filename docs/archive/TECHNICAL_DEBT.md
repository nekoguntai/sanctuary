# Sanctuary Technical Debt Analysis

Last updated: 2026-01-05

## Executive Summary

The Sanctuary codebase is **well-architected** with good separation of concerns, comprehensive testing infrastructure, and awareness of performance/security patterns. The identified technical debt is relatively minor.

**Codebase Size**: 46,464 lines of server code across 260 TypeScript files

---

## Summary by Severity

### Critical (Fix Immediately)
| Issue | Location | Description |
|-------|----------|-------------|
| JSON parse without validation | `server/src/api/auth.ts:117-121` | Can silently accept invalid config |
| Untyped `any` in blockchain service | `server/src/services/bitcoin/blockchain.ts:681` | `getTransactionDetails` returns `Promise<any>` |

### High (Fix Soon)
| Issue | Location | Description |
|-------|----------|-------------|
| Silent error swallowing | `server/src/api/auth.ts` | Multiple JSON.parse without logging |
| Type safety gaps | `server/src/services/transferService.ts` | Uses `any` for typed objects (lines 122, 499, 561, 570) |
| Inconsistent error domain | `server/src/services/wallet.ts:164-196` | Mix of generic Error and typed errors |

### Medium (Schedule)
| Issue | Location | Description |
|-------|----------|-------------|
| Deprecated code not removed | `server/src/services/transferService.ts:559-636` | Transfer wrappers marked @deprecated |
| Rate limit config duplication | `server/src/api/auth.ts` vs `server/src/config/index.ts` | Parsed in two places |
| Electrum response validation | `server/src/services/bitcoin/electrum.ts` | No schema validation on external API |
| Direct Prisma usage | 69 files | Repository pattern not universally applied |
| Loose type assertions | Multiple files | Functions return `any` |

### Low (Nice to Have)
| Issue | Location | Description |
|-------|----------|-------------|
| Magic number configuration | `server/src/websocket/server.ts` | WebSocket limits could be more discoverable |
| Backward compatibility config | `server/src/config/index.ts:178-189` | Both nested and flat structures |
| Documentation coverage | `server/src/api/` | JSDoc comments could be expanded |

---

## Detailed Analysis

### 1. Hardcoded Values & Magic Numbers

| Issue | Location | Severity |
|-------|----------|----------|
| Hardcoded timeouts | `server/src/websocket/server.ts:36` | Medium |
| Magic numbers in rate limiting | `server/src/api/auth.ts:40-94` | Low |
| Hardcoded pagination defaults | `server/src/constants.ts:34, 39` | Low |
| Number conversion divisors | `server/src/websocket/eventVersioning.ts:170, 198` | Low |

**Suggested Fixes:**
- Move all magic numbers from rate limiting to centralized config
- Create `TimeoutConfig` interface in config/types.ts
- Ensure conversion factors reference `SATOSHIS_PER_BTC` constant consistently

---

### 2. Inconsistent Patterns

#### Error Handling
```typescript
// BAD: server/src/api/auth.ts:117-121 - Silent failure
try {
  enabled = JSON.parse(setting.value);
} catch {
  enabled = false;  // Silently swallows parse errors
}
```

**Issues:**
- Mix of `throw new Error()` and domain errors
- Empty catch blocks that ignore errors without logging
- Silent failure on invalid JSON

**Fix:** Create `SafeJsonParse` utility that logs on failure and uses Zod schemas.

---

### 3. Type Safety Gaps

| Issue | Location | Severity |
|-------|----------|----------|
| `any` in response handling | `server/src/services/bitcoin/blockchain.ts:681` | High |
| `any` in transfer service | `server/src/services/transferService.ts:122, 499, 561, 570` | High |
| `any` in output matching | `server/src/services/bitcoin/sync/phases/processTransactions.ts:28` | Medium |
| `any` in middleware | `server/src/middleware/metrics.ts:91, 147` | Low |
| Loose response types | `server/src/api/node.ts:28` | Medium |

**Fix:** Create specific types: `TransactionDetails`, `TransactionOutput`, etc.

---

### 4. Code Duplication

| Issue | Location | Severity |
|-------|----------|------------|
| Deprecated wrapper functions | `server/src/services/transferService.ts:559-636` | Low |
| Rate limiter config duplication | `server/src/api/auth.ts` vs `server/src/config/index.ts` | Medium |
| JSON parse try-catch pattern | `server/src/api/auth.ts:117-148` | Medium |

**Fix:**
- Create `parseJsonSetting<T>(value: string, schema: ZodSchema, default: T): T`
- Remove @deprecated wrappers after updating callers

---

### 5. Architectural Concerns

#### Direct Prisma Usage
- 69 files directly use Prisma instead of going through repositories
- Repositories exist (`server/src/repositories/*.ts` - 12 files)
- Most API routes use services (good)
- Sync phases use Prisma directly for performance (acceptable)

#### Configuration Management
- Dual config systems for backward compatibility (nested + flat)
- 40+ parseInt calls with hardcoded defaults
- Validation happens at startup but only covers production DB requirement

---

### 6. Error Handling Issues

| Issue | Location | Severity |
|-------|----------|----------|
| Silent JSON.parse failures | `server/src/api/auth.ts:117-121, 145-149` | High |
| Inconsistent error domain | `server/src/services/wallet.ts:164-196` | Medium |
| Missing error context | Multiple catch blocks | Medium |

**Good Pattern Found:**
```typescript
// server/src/errors/errorHandler.ts
export function handlePrismaError(error: unknown, res: Response, context: string): boolean {
  // Specific error code handling for P2002, P2025, etc.
}
```

---

### 7. Security Concerns

| Issue | Location | Severity |
|-------|----------|----------|
| JSON.parse without validation | `server/src/api/auth.ts:118, 146` | High |
| Silent JSON failures | `server/src/repositories/systemSettingRepository.ts:104` | Medium |
| Potential SSRF via URL | `server/src/services/payjoinService.ts:230` | Low |
| No Electrum response validation | `server/src/services/bitcoin/electrum.ts` | Low |

**Critical Pattern:**
```typescript
// VULNERABLE: server/src/repositories/systemSettingRepository.ts:104
return JSON.parse(value) as T;  // No validation, unsafe cast

// Should be:
return systemSettingSchema.parse(JSON.parse(value));
```

---

### 8. Performance (No Critical Issues)

The codebase demonstrates good practices:
- Batch operations to avoid N+1 queries (documented in comments)
- Pagination implemented
- Caching layer exists (`server/src/services/cache/`)
- Bounded buffers for message queues
- Memory monitoring (`server/src/infrastructure/memoryMonitor.ts`)

---

### 9. Documentation Debt

| Issue | Location | Severity |
|-------|----------|----------|
| Minimal JSDoc coverage | `server/src/api/` | Low |
| Missing error documentation | `server/src/services/errors.ts` | Medium |
| Complex sync underdocumented | `server/src/services/bitcoin/sync/` | Medium |
| Config env vars not documented | `server/src/config/` | Low |

---

## Top 10 Actionable Improvements

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 1 | Add Zod schema to all JSON.parse calls | Security | High |
| 2 | Create SafeJsonParse utility function | Error Handling | Low |
| 3 | Remove @deprecated transfer service wrappers | Code Quality | Low |
| 4 | Type Transfer objects (remove `any`) | Type Safety | Medium |
| 5 | Consolidate rate limit config locations | Config | Low |
| 6 | Add error logging to silent catch blocks | Observability | Low |
| 7 | Create parseIntConfig helper | Configuration | Low |
| 8 | Document sync phases with architecture | Documentation | Medium |
| 9 | Add Zod validation to Electrum responses | Security | Medium |
| 10 | Create transfer service test for wrappers | Testing | Low |

---

## Architecture Positives

The codebase demonstrates excellent practices:

1. **Service Registry Pattern** - Dependency injection via `server/src/services/registry.ts`
2. **Repository Layer** - Clear separation of data access concerns
3. **Error Handling Strategy** - Centralized Prisma error handling
4. **Configuration Management** - Comprehensive config object with validation
5. **Batch Operations** - Conscious effort to prevent N+1 queries
6. **Distributed Locking** - Infrastructure for multi-instance coordination
7. **Rate Limiting** - Multiple strategies with bounded buffers
8. **WebSocket Architecture** - Well-designed with connection limits
9. **Feature Flags** - Registry-based extensibility
10. **Logging Infrastructure** - Structured logging with request context

---

## What This Codebase Does NOT Have

- Circular dependencies issues
- Missing N+1 query handling (developers are aware and document fixes)
- Swallowed errors (mostly, except JSON parse cases)
- Security vulnerabilities in core logic
- Deprecated package usage

This is a **mature, production-ready codebase** with manageable technical debt.
