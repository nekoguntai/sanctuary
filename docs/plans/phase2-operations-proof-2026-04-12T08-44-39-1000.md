# Phase 2 Operations Proof

Date: 2026-04-12T08:44:39-10:00 (Pacific/Honolulu)
Environment: local disposable PostgreSQL integration database
Status: Passed

## Command

```bash
TEST_POSTGRES_PORT=55433 npm run test:ops:phase2
```

The first attempt on the default integration-test port failed because `0.0.0.0:5433` was already allocated on this host. The runner and `docker-compose.test.yml` now support `TEST_POSTGRES_PORT`, and the passing run used `localhost:55433`.

## Result

```text
tests/integration/ops/phase2OperationsProof.integration.test.ts
1 file passed
3 tests passed
Duration: 860ms
```

The runner started `sanctuary-test-db` from `postgres:16-alpine`, applied 47 Prisma migrations to `sanctuary_test`, ran the targeted integration spec, and removed the disposable Compose stack during cleanup.

## Backup/Restore Drill

The drill used the non-production integration database and the real backup service:

- Seeded a user, group, wallet, wallet-user ownership row, and audit-log row through Prisma.
- Created a backup with `backupService.createBackup('phase2-ops-proof')`.
- Validated the backup with `backupService.validateBackup(...)`.
- Deleted the seeded operational rows with the integration cleanup helper.
- Restored through `backupService.restoreFromBackup(...)`.
- Verified the user, wallet, wallet-user ownership row, and audit-log row existed after restore.

This proves the service-level backup validation and destructive restore path against a migrated PostgreSQL database. It is not a size/performance drill for large production backups.

## Gateway Audit Persistence

The drill used the production-style gateway HMAC path in-process:

- Mounted the real backend push router at `/api/v1/push`.
- Pointed the actual gateway `logSecurityEvent` implementation at the local backend app with `BACKEND_URL`.
- Used the same `GATEWAY_SECRET` on both sides.
- Sent `RATE_LIMIT_EXCEEDED` through `gateway/src/middleware/requestLogger.ts`.
- Verified the backend persisted an `audit_logs` row with `action: gateway.rate_limit_exceeded`, `category: gateway`, `source: gateway`, client IP, user agent, and failure metadata.
- Verified an unsigned `POST /api/v1/push/gateway-audit` returned `403` and did not create an audit row.

This proves gateway audit persistence through the shared SEC-002 HMAC signer/verifier and the backend repository. It is not a full multi-container gateway/backend exercise.

## Remaining Phase 2 Evidence

- Exercise the full monitoring stack locally and capture environment-specific runbook adjustments.
- Add durable Alertmanager receivers after production notification channels are chosen.
