# Technical Debt Cleanup Plan

Date: 2026-01-22
Owner: TBD
Status: Draft

## Constraints & Priorities
- Accuracy and trustworthiness are non-negotiable (financial app).
- UI behavior changes are allowed.
- Config flags/env switches are allowed.
- DB migrations are allowed if justified.

## UI Areas Likely to Change (Specific)
- Wallet detail page: UTXO list paging and “Load more” behavior (currently expected to show all in one view).
- Wallet detail page: address list paging and summary usage.
- Dashboard: balance history chart now comes from server aggregation, not client-side reconstruction.
- Coin control flows: any place that assumes a full UTXO list in memory may require explicit “load all” or stats endpoint.

Files:
- `components/WalletDetail.tsx`
- `components/UTXOList.tsx`
- `components/WalletStats.tsx`
- `components/Dashboard.tsx`
- `hooks/queries/useWallets.ts`

## Phase 1 — Ops-First (Reliability & Single Ownership)
Goal: Eliminate duplicate background work and ensure idempotent scheduling.

1) Consolidate job ownership
- Make worker/queue the single source of recurring jobs.
- Ensure API server only schedules when queue is available; fallback to in-process only when queue is unavailable.
- Add explicit logs/health signals so operators can verify which runtime is in charge.

2) Idempotent scheduling everywhere
- Deterministic jobIds for all repeatable schedules.
- Ensure multi-instance startup does not create duplicates.
- Verify with Redis repeatable job list and unit tests.

3) Single Electrum subscription owner
- Worker owns subscriptions; API server should not subscribe.
- Guard against double subscriptions if both processes run.
- Add config flag to disable server-side Electrum subsystem.

Deliverables:
- Updated background ownership docs.
- Idempotent scheduling tests.
- Config flag + fallback path.

Success Metrics:
- Only one repeatable entry per job in Redis across multi-instance startups.
- Only one Electrum subscription per address (no double callbacks).

## Phase 2 — Perf-First (Scalability Without Accuracy Loss)
Goal: Reduce heavy list payloads and move aggregation server-side with accuracy preserved.

Current state (as of 2026-01-22):
- Unpaginated calls to addresses/UTXOs are soft-capped at 1000 with
  `X-Result-Limit` and `X-Result-Truncated` headers in
  `server/src/api/transactions/addresses.ts` and
  `server/src/api/transactions/utxos.ts`.

1) Pagination enforcement on heavy lists
- Require `limit/offset` on addresses and UTXOs where UI calls exist.
- Add a soft cap for unpaginated calls (default limit) with response headers
  to flag truncation: `X-Result-Limit`, `X-Result-Truncated`.
- Ensure API returns accurate totals independent of page.

2) Server-side aggregation for cross-wallet history
- Bucketed aggregation by timeframe (hour/day/week/month).
- Ensure chart accuracy for end-of-period balances (no double counting).
- Keep raw balances fully accurate; charts are a representation.

3) Add precise “stats” endpoints if full list is required by UI
- e.g., UTXO age distribution and counts without full payload.
- Avoid accuracy loss by using DB aggregates.

Deliverables:
- Paged endpoints with stable totals.
- Cross-wallet history query that scales with time range.

Success Metrics:
- p95 latency stable on large wallets.
- No UI memory spikes on large UTXO/address counts.
- Any unpaginated call includes truncation headers and does not return
  unbounded payloads.

## Phase 3 — Structural Cleanup (Maintainability)
Goal: Consistent service/repo boundaries and feature-flag consolidation.

1) Service/repo boundary
- Migrate direct Prisma usage in API routes into services/repositories.
- Standardize error handling and access checks.

2) Feature flag consolidation
- Select one flag service and migrate callers.
- Document flag source of truth.

Deliverables:
- API handlers call services, not Prisma directly.
- Single feature flag API with tests.

Success Metrics:
- Reduced duplicate logic; simpler testing surface.

## Sequencing
Recommended order: Phase 1 → Phase 2 → Phase 3.

## Rollout Strategy
- Use feature flags/config toggles for risky behavior changes.
- Ship in small slices (1–3 days per slice).
- Add monitoring/logging before deprecating old paths.

## Accuracy & Trust Notes
- Balance calculations must remain exact.
- Aggregations for charts are allowed to be bucketed, but totals must match current balances.
- Any approximation must be explicit, opt-in, and documented.
