# Reliability Hardening Plan

Date: 2026-02-27
Owner: TBD
Status: Draft

## Goals

Three guiding principles, in priority order:

1. **Perpetual Operations** — The app runs 24/7 for months/years without restarts, memory leaks, or resource exhaustion.
2. **Scalability** — Under load (many wallets, concurrent syncs, burst notifications), the event loop stays healthy and connections stay bounded.
3. **Extensibility** — Failed operations are observable, recoverable, and don't silently disappear.

## Severity Legend

| Label | Meaning |
|-------|---------|
| CRITICAL | Blocks event loop or can cause OOM/crash under normal usage |
| HIGH | Degrades performance or reliability under moderate load |
| MEDIUM | Operational blind spot or slow leak over long runtime |
| LOW | Improvement for observability or edge-case resilience |

---

## Phase 1 — Event Loop & I/O Safety

**Goal:** Eliminate all synchronous blocking calls from request/notification hot paths.
**Risk if skipped:** Under load, a single scrypt or file read stalls every in-flight request.

### 1.1 Replace `crypto.scryptSync` with async `crypto.scrypt`

- **Severity:** CRITICAL
- **File:** `server/src/utils/encryption.ts:51`
- **Problem:** `scryptSync` blocks the event loop for 500ms-1s+ on every encrypt/decrypt call. Every request that touches encrypted node passwords (admin config, sync setup) blocks all other requests.
- **Fix:**
  1. Replace `crypto.scryptSync(key, salt, 32)` with promisified `crypto.scrypt(key, salt, 32)`
  2. Make `getEncryptionKey()` async
  3. Cache the derived key in module scope (salt + key combo as cache key) so repeated calls don't re-derive
  4. Update all callers of `encrypt()`/`decrypt()` to await
- **Effort:** Low (2-3 hours)
- **Test:** Verify encrypt/decrypt still produce same output; load test with concurrent decrypt calls

### 1.2 Cache push provider file reads at initialization

- **Severity:** CRITICAL
- **Files:**
  - `server/src/services/push/providers/fcm.ts:42,62`
  - `server/src/services/push/providers/apns.ts:60`
- **Problem:** `fs.readFileSync` called on every notification send. Each push notification blocks the event loop for file I/O.
- **Fix:**
  1. Read service account / key file once during provider initialization
  2. Store parsed content in a module-level variable
  3. `getServiceAccount()` and `getToken()` return cached value
  4. Add a `reloadConfig()` method for hot-reload if needed
- **Effort:** Low (1-2 hours)
- **Test:** Send test notification; verify file is read once (add debug log on actual read)

### 1.3 Add timeouts to all external API fetch calls

- **Severity:** HIGH
- **Files:**
  - `server/src/services/telegram/telegramService.ts:72,110`
  - `server/src/services/push/providers/fcm.ts:94-98`
- **Problem:** Telegram API calls and FCM OAuth token requests have no timeout. A hung external API blocks the notification pipeline indefinitely.
- **Fix:**
  1. Add `signal: AbortSignal.timeout(10000)` to every `fetch()` call in these files
  2. Wrap in try/catch to handle `AbortError` gracefully
  3. Audit all other `fetch()` calls in `server/src/` for missing timeouts (use grep for `fetch(` without `AbortSignal`)
- **Effort:** Low (1 hour)
- **Test:** Mock a slow endpoint; verify timeout fires and error is logged

### 1.4 Bound concurrent Electrum fetches in confirmation sync

- **Severity:** HIGH
- **File:** `server/src/services/bitcoin/sync/confirmations.ts:238,278,349`
- **Problem:** `Promise.all` with 10 concurrent address history fetches per batch. Multiple wallets syncing simultaneously can exhaust the Electrum connection pool.
- **Fix:**
  1. Replace `Promise.all(batch.map(...))` with `mapWithConcurrency(batch, fn, 3)` from `utils/async.ts`
  2. Concurrency of 3 keeps throughput high while bounding connections
  3. Apply to all three call sites (lines 238, 278, 349)
- **Effort:** Low (1 hour)
- **Test:** Sync a wallet with many addresses; verify concurrent connections stay bounded

### Phase 1 Checklist

- [x] 1.1 Async scrypt + key caching
- [x] 1.2 Cached file reads in FCM/APNs providers
- [x] 1.3 Timeouts on Telegram + FCM OAuth fetch calls (+ mempool, GitHub, payjoin)
- [x] 1.4 Bounded concurrency in confirmation sync
- [x] Run full test suite (172 files, 4992 tests pass)
- [ ] Load test: 10 concurrent wallet syncs + notification burst

---

## Phase 2 — Data Safety & Memory Bounds

**Goal:** Prevent OOM from unbounded queries and fix long-term memory leaks.
**Risk if skipped:** Backup export crashes on large wallets; memory grows over months of operation.

### 2.1 Stream backup exports with pagination

- **Severity:** HIGH
- **File:** `server/src/services/backupService.ts:225`
- **Problem:** `prisma[table].findMany()` loads entire tables into memory. A wallet with 100k+ transactions causes OOM.
- **Fix:**
  1. Implement cursor-based pagination for export: fetch 1000 rows at a time
  2. Stream results to a temporary file or response stream
  3. Use Prisma's `cursor` + `take` pattern (already used in `transactionRepository.ts`)
  4. Add progress callback for large exports
- **Effort:** Medium (4-6 hours)
- **Test:** Create test wallet with 10k transactions; verify export completes without memory spike

### 2.2 Fix `addressToWalletMap` memory leak

- **Severity:** MEDIUM
- **File:** `server/src/services/syncService.ts:56`
- **Problem:** Map of address→wallet is populated during sync but never cleaned up when wallets are deleted. Over months of wallet creation/deletion, this grows unboundedly.
- **Fix:**
  1. Listen for wallet deletion events and remove associated addresses from the map
  2. Add periodic reconciliation (e.g., every hour) that rebuilds the map from active wallets
  3. Add a `size` metric to the health endpoint for monitoring
- **Effort:** Low (2-3 hours)
- **Test:** Create and delete wallets; verify map size stays proportional to active wallets

### 2.3 Add max size limit to in-memory cache

- **Severity:** LOW
- **File:** `server/src/services/cache/cacheService.ts`
- **Problem:** Cache relies solely on TTL expiration. A burst of unique keys (e.g., per-address balance lookups) could spike memory before TTL kicks in.
- **Fix:**
  1. Add `maxSize` config option (default 10,000 entries)
  2. When cache exceeds max size, evict oldest entries (LRU or FIFO)
  3. Log a warning when eviction happens (indicates TTL or access pattern issue)
- **Effort:** Low (2 hours)
- **Test:** Fill cache beyond max size; verify eviction occurs and oldest entries are removed

### Phase 2 Checklist

- [x] 2.1 Cursor-based paginated backup exports (BACKUP_PAGE_SIZE=1000 for large tables)
- [x] 2.2 Address map cleanup: deletion handler already exists + added hourly reconciliation
- [x] 2.3 Cache max size limit (DEFAULT_MAX_CACHE_SIZE=10,000 with 5% FIFO batch eviction)
- [x] Health endpoint already reports `subscribedAddresses` map size
- [x] Run full test suite (172 files, 4992 tests pass)
- [ ] Test with large dataset (10k+ transactions per wallet)

---

## Phase 3 — Job Queue & Scheduling Resilience

**Goal:** Prevent job overlap, route failed jobs for recovery, and handle lock loss.
**Risk if skipped:** Maintenance jobs run concurrently causing DB contention; failed notifications are silently lost.

### 3.1 Add distributed locks to maintenance jobs

- **Severity:** HIGH
- **File:** `server/src/jobs/definitions/maintenance.ts`
- **Problem:** Weekly vacuum, monthly cleanup, and hourly cleanup jobs have no distributed locks. If execution exceeds the cron interval, two instances run concurrently.
- **Fix:**
  1. Add `lockOptions` to all maintenance job definitions (pattern already exists in `syncJobs.ts`)
  2. Lock key: `maintenance:<jobName>`
  3. Lock TTL: job timeout + 60 seconds grace period
  4. Apply to: `weeklyVacuumJob`, `monthlyCleanupJob`, all `cleanup:*` jobs
- **Effort:** Low (2 hours)
- **Test:** Trigger maintenance job manually while another is running; verify second is skipped

### 3.2 Route exhausted jobs to dead letter queue

- **Severity:** MEDIUM
- **File:** `server/src/worker/jobs/notificationJobs.ts:86-92`
- **Problem:** Notification jobs that exhaust all retry attempts are only logged. No way to inspect or manually retry them.
- **Fix:**
  1. When `job.attemptsMade >= maxAttempts`, call `deadLetterQueue.add()` (service exists at `server/src/services/deadLetterQueue.ts`)
  2. Include full job data, error message, and attempt history
  3. Add admin API endpoint to list/retry DLQ entries
  4. Apply to all job types, not just notifications
- **Effort:** Medium (3-4 hours)
- **Test:** Force a notification job to fail all retries; verify it appears in DLQ

### 3.3 Handle lock loss during job execution

- **Severity:** MEDIUM
- **File:** `server/src/worker/workerJobQueue.ts:214-224`
- **Problem:** If Redis blips during a sync job, the lock is lost but the job continues. Another worker could acquire the same lock and run the same job concurrently.
- **Fix:**
  1. When lock refresh fails, set a `lockLost` flag on the job context
  2. Check flag at key checkpoints within sync logic (before DB writes)
  3. If lock lost, abort the job and let it be retried
  4. Log as WARNING with job ID and lock key
- **Effort:** Medium (3-4 hours)
- **Test:** Simulate Redis disconnect during job execution; verify job aborts cleanly

### 3.4 Increase job history retention

- **Severity:** LOW
- **File:** `server/src/jobs/jobQueue.ts:54-59`
- **Problem:** Only 100 completed + 50 failed jobs kept. Insufficient for debugging multi-day issues.
- **Fix:** Increase to `removeOnComplete: 500`, `removeOnFail: 250`
- **Effort:** Trivial (5 minutes)

### Phase 3 Checklist

- [x] 3.1 Distributed locks on all 8 maintenance jobs (cleanup, vacuum, monthly)
- [x] 3.2 Centralized DLQ routing in workerJobQueue failed handler (all job types)
- [x] 3.3 Lock loss detection aborts job via Promise.race + lockLostPromise
- [x] 3.4 Job history retention increased (500 completed, 250 failed)
- [x] Run full test suite (172 files, 4992 tests pass)
- [ ] Verify job queue health endpoint reflects new metrics

---

## Phase 4 — External Service Resilience

**Goal:** Wrap notification providers in circuit breakers so outages don't cascade.
**Risk if skipped:** When Telegram/Google APIs go down, every notification attempt wastes time hitting dead endpoints.

### 4.1 Circuit breakers for notification providers

- **Severity:** MEDIUM
- **Files:**
  - `server/src/services/telegram/telegramService.ts`
  - `server/src/services/push/providers/fcm.ts`
  - `server/src/services/push/providers/apns.ts`
- **Problem:** No circuit breaker wrapping external notification calls. If Telegram API is down, every notification attempt waits for timeout before failing.
- **Fix:**
  1. Create circuit breaker instances for each provider using existing `circuitBreaker.ts`
  2. Configure: 5 failures → open circuit for 60 seconds → half-open probe
  3. When circuit is open, immediately fail notifications with "service unavailable" (don't consume timeout)
  4. Report circuit state in health endpoint
- **Effort:** Medium (3-4 hours)
- **Test:** Mock Telegram returning 500s; verify circuit opens after threshold and recovers

### 4.2 Add circuit breaker to DB health check reconnection

- **Severity:** MEDIUM
- **File:** `server/src/models/prisma.ts:263-294`
- **Problem:** Health check retries reconnection every 30 seconds indefinitely without backoff. During extended DB outage, this generates log spam and wasted resources.
- **Fix:**
  1. After N consecutive reconnection failures, increase health check interval (30s → 60s → 120s → 300s max)
  2. Reset backoff on successful reconnection
  3. Notify WebSocket clients when DB is in reconnection state
- **Effort:** Low (2 hours)
- **Test:** Stop Postgres; verify backoff increases; restart Postgres; verify recovery

### Phase 4 Checklist

- [x] 4.1 Circuit breakers on Telegram, FCM, APNs (5 failures → open 60s → half-open; 4xx bypasses circuit)
- [x] 4.2 Backoff on DB reconnection (setTimeout loop: 30s → 60s → 120s → 300s max, reset on success)
- [x] Health endpoint already reports all circuit states via circuitBreakerRegistry (auto-registered)
- [x] Run full test suite (172 files, 4992 tests pass)
- [ ] Test: disable each external service; verify graceful degradation

---

## Phase 5 — Operational Observability

**Goal:** Fill monitoring blind spots so issues are detected before they become outages.
**Risk if skipped:** Silent degradation goes unnoticed until users report problems.

### 5.1 Implement disk space monitoring

- **Severity:** LOW
- **Files:** `server/src/api/health.ts`, `server/src/config/index.ts:170`
- **Problem:** Config property `diskWarningThresholdPercent` exists but is never checked. Docker log rotation mitigates but doesn't cover all disk usage.
- **Fix:**
  1. Add disk space check to health endpoint (use `child_process` to run `df` or use `statvfs`)
  2. Report as degraded when below warning threshold
  3. Report as unhealthy when below critical threshold (5%)
- **Effort:** Low (2 hours)

### 5.2 Fix `isReconnecting` race condition

- **Severity:** LOW
- **File:** `server/src/models/prisma.ts:182`
- **Problem:** Non-atomic boolean flag; concurrent health checks could trigger simultaneous reconnection attempts.
- **Fix:** Use a mutex or track reconnection with a Promise that concurrent callers can await.
- **Effort:** Low (1 hour)

### 5.3 Add connection draining on shutdown

- **Severity:** LOW
- **File:** `server/src/models/prisma.ts:176`
- **Problem:** `disconnect()` doesn't wait for in-flight queries to complete before closing.
- **Fix:**
  1. Track active query count with a counter
  2. On shutdown, wait up to 10 seconds for active queries to complete before disconnecting
  3. Force disconnect after timeout
- **Effort:** Medium (2-3 hours)

### 5.4 Frontend WebSocket reconnection recovery

- **Severity:** LOW
- **File:** `services/websocket.ts:118`
- **Problem:** After 5 failed reconnection attempts, client gives up permanently. User must refresh the page.
- **Fix:**
  1. After max attempts, show a "Connection lost — Reconnect" button in the UI
  2. Optionally: reset attempt counter after a long delay (e.g., 5 minutes) and try again
- **Effort:** Low (2 hours)

### Phase 5 Checklist

- [x] 5.1 Disk space in health endpoint (fs.statfs, warning at config threshold, critical at 95%)
- [x] 5.2 Atomic reconnection flag (Promise-based guard replaces boolean)
- [x] 5.3 Connection draining on shutdown (activeQueries counter, 10s drain timeout)
- [x] 5.4 WebSocket reconnection recovery (5-min slow retry after fast attempts exhausted, dispatches exhausted event)
- [x] Health endpoint covers all new metrics (disk component added)
- [x] Run full test suite (172 files, 4992 tests pass)

---

## Summary

| Phase | Focus | Items | Total Effort | Impact |
|-------|-------|-------|-------------|--------|
| **Phase 1** | Event Loop & I/O Safety | 4 items | ~5-7 hours | Eliminates all event-loop-blocking code |
| **Phase 2** | Data Safety & Memory Bounds | 3 items | ~8-11 hours | Prevents OOM and long-term memory growth |
| **Phase 3** | Job Queue Resilience | 4 items | ~8-10 hours | No silent job failures or overlap |
| **Phase 4** | External Service Resilience | 2 items | ~5-6 hours | Graceful degradation during outages |
| **Phase 5** | Operational Observability | 4 items | ~7-8 hours | Detect issues before they become outages |

**Total estimated effort: ~33-42 hours across all phases**

## What's Already Solid (No Changes Needed)

These areas were reviewed and found to be production-ready:

- Circuit breakers on Electrum connections (full state machine)
- Distributed locking with Redis + in-memory fallback
- Rate limiting with Redis-backed sliding window + per-endpoint policies
- Health checks covering DB, Redis, Electrum, WebSocket, memory, queues
- WebSocket reliability: bounded queues, backpressure, heartbeat, proper cleanup
- Graceful shutdown: ordered teardown of HTTP → WS → services → DB → Redis
- Async utilities: `mapWithConcurrency`, `withTimeout`, `withRetry`
- Startup resilience: critical vs non-critical service distinction with retry
- Docker log rotation: 10MB max, 3 files per service
- Config validation: Zod schemas, production-specific checks, clear error messages
