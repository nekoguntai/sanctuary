# Frontend Extensibility Plan

## Purpose

This plan captures the frontend-focused extensibility work recovered from the local Codex session logs after the crash. It replaces the accidental detour into `docs/archive/architecture-improvement-plan.md`, which is backend-heavy and does not match the current implementation worktree.

The current direction is to reduce duplicated UI wiring by moving high-churn frontend surfaces into small, typed definition registries. The goal is not to create a plugin framework yet. The goal is to make common extension points cheaper and safer to change.

## Progress Update

The route/sidebar manifest and wallet detail tab definition slices are implemented. The background pattern metadata consolidation slice is also implemented and now centralizes registered background IDs, categories, icon keys, and animated detection around `themes/patterns.ts`.

The original recovered plan was not only the frontend background work. The frontend-focused slices are complete, and the broader first-pass extensibility recommendations have now been handled.

Current original-plan status:

- Implemented: app route/sidebar manifest.
- Implemented: wallet detail tab definitions.
- Implemented: theme/background metadata consolidation.
- Implemented first pass: wallet/device OpenAPI contract guardrails.
- Implemented first pass: moving high-churn route logic into services.
- Implemented first pass: clarifying job queue surfaces.
- Implemented: Extension Points Map documentation in `docs/EXTENSION_POINTS.md`.

The original plan is complete at first-pass scope. Remaining items are deliberately deferred future design or refactor work, not unfinished plan tasks:

- Decide whether theme-specific background IDs should become a first-class persisted preference type once real theme-specific backgrounds are added.
- Decide whether wallet/device APIs should move beyond OpenAPI guardrails into generated or schema-first route/client contracts.
- Decide queue ownership boundaries before changing sync/job queue runtime behavior.

## Current Implementation Status

### Implemented: app route and sidebar manifest

Current files:

- `src/app/appRoutes.tsx`
- `App.tsx`
- `components/Layout/SidebarContent.tsx`
- `tests/src/app/appRoutes.test.ts`

What changed:

- Lazy route components, fallbacks, route IDs, nav labels, nav sections, feature metadata, and redirect routes are now centralized in `appRouteDefinitions` and `appRedirectRoutes`.
- `App.tsx` renders routes from the manifest instead of hand-writing every `<Route>`.
- `SidebarContent.tsx` derives static nav items from the route manifest instead of maintaining a separate route/nav list.
- Tests assert that nav items map to registered routes and that required sidebar entries exist.

Remaining follow-up:

- Keep this slice focused. Do not mix unrelated visual changes into the route/sidebar manifest change.
- If future routes need authorization, route definitions should grow explicit access metadata instead of pushing conditional route checks back into `App.tsx`.

### Implemented: wallet detail tab definitions

Current files:

- `components/WalletDetail/tabDefinitions.ts`
- `components/WalletDetail/TabBar.tsx`
- `components/WalletDetail/WalletDetail.tsx`
- `components/WalletDetail/types.ts`
- `tests/components/WalletDetail/tabDefinitions.test.ts`
- `tests/components/WalletDetail.test.tsx`
- `tests/components/WalletDetail.wrapper.test.tsx`

What changed:

- Tab IDs, labels, default tab, role visibility, and draft badge metadata now live in `walletDetailTabDefinitions`.
- `TabBar.tsx` renders tab labels and badge behavior from the registry.
- `WalletDetail.tsx` validates router-provided tab state through the registry and falls back when the requested tab is hidden for the current wallet role.
- Tests cover tab ordering, viewer/signer/owner visibility, route-state validation, and hidden-tab fallback.

Remaining follow-up:

- The tab content renderer still lives in `WalletDetail.tsx`. That is acceptable for the current slice because the duplication we removed was tab metadata and visibility, not the tab component switch.
- If the wallet page needs third-party or optional tabs later, extend the registry to include render metadata or a `renderTabContent(tabId, context)` helper. Do that as a separate slice because it will touch more state and props.

### Not part of this plan: login logo cleanup

Current worktree also contains changes to:

- `components/Login/LoginLogoContainer.tsx`
- `index.html`
- `tests/components/Login/LoginLogoContainer.test.tsx`

Those changes remove the login logo glow ring. They appear to be frontend work, but they are not part of the recovered extensibility plan. Keep them separate when reviewing, committing, or continuing the extensibility work.

## Implemented Slice: Background Pattern Metadata Consolidation

This slice consolidates theme/background metadata. It is the strongest match for the recovered plan and for the current codebase shape.

### Evidence and result

Before this slice, the background system spread one concept across `themes/patterns.ts`, `components/animatedPatterns.ts`, `themes/backgroundCategories.ts`, `components/Settings/sections/ThemeSection/iconMaps.ts`, `types/ui.ts`, seasonal defaults, and static CSS in `index.html`.

Before implementation:

- `themes/patterns.ts` had 66 registered global patterns.
- 56 registered patterns were animated.
- `components/animations` had 56 animation modules, and those matched the registered animated IDs by kebab-case to camelCase convention.
- `themes/backgroundCategories.ts` had 77 categorized IDs.
- 11 categorized IDs were not registered in `themes/patterns.ts`: `dots`, `cross`, `noise`, `triangles`, `aurora`, `mountains`, `brush-stroke-blossoms`, `ink-branch`, `calligraphy-wind`, `ink-on-water`, `enso-circles`.
- `types/ui.ts` also contained `wisteria`, which looked stale as a background ID.

After implementation:

- `themes/patterns.ts` registers 72 global patterns: 16 static and 56 animated.
- The six CSS-backed static IDs, `dots`, `cross`, `noise`, `triangles`, `aurora`, and `mountains`, are now registered and selectable.
- The stale IDs `brush-stroke-blossoms`, `ink-branch`, `calligraphy-wind`, `ink-on-water`, `enso-circles`, and `wisteria` are no longer part of the generated category/type surface.
- `components/animatedPatterns.ts` is now a compatibility re-export of registry-backed animated metadata instead of a separate hard-coded list.
- `BackgroundOption` is derived from registered global pattern IDs.
- Settings icons use registry `iconKey` metadata mapped to React icon components in one semantic icon map.
- Category helpers derive from registered pattern categories, and category counts in `BackgroundsPanel.tsx` are based on the visible pattern set.
- Future theme-specific patterns must include the same category and icon metadata before they can be registered on a theme, and Settings category filtering reads from the visible pattern metadata rather than the global-only category map.
- Tests now cover category/registry alignment, icon metadata coverage, and animated registry-to-loader alignment.

## Proposed Work Plan

### Phase 0: stabilize current frontend slices

Scope:

- Keep the route/sidebar and wallet tab registry changes as the completed first slices.
- Keep the login logo cleanup separate from the extensibility plan.
- Re-run the existing targeted tests before starting the background slice if the worktree has changed.

Verification:

- `npx vitest run tests/src/app/appRoutes.test.ts tests/components/WalletDetail/tabDefinitions.test.ts tests/components/WalletDetail/TabBar.test.tsx tests/components/WalletDetail.test.tsx tests/components/WalletDetail.wrapper.test.tsx`
- `git diff --check`

### Phase 1: make `themes/patterns.ts` the source of truth for registered background metadata - implemented

Scope:

- Extend `BackgroundPattern` metadata to carry category and icon information without coupling the theme registry directly to Lucide components. Prefer a string `iconKey` or similar field, then let the Settings UI map icon keys to components.
- Add all selectable CSS-backed static patterns to `globalPatterns`, or intentionally delete their stale `BackgroundOption` and category entries if they are no longer meant to be user-selectable.
- The likely static IDs to register are `dots`, `cross`, `noise`, `triangles`, `aurora`, and `mountains`, because their CSS already exists in `index.html`.
- Remove or explicitly quarantine stale IDs that do not have implementations: `brush-stroke-blossoms`, `ink-branch`, `calligraphy-wind`, `ink-on-water`, `enso-circles`, and `wisteria`.
- Avoid moving the long SVG/CSS implementations in the first pass. Let `index.html` continue owning static CSS while metadata moves into `themes/patterns.ts`.

Verification:

- Add a test that every category entry points to a registered pattern.
- Add a test that every registered pattern has at least one category except intentionally uncategorized special cases, if any.
- Add a test that every static CSS-backed pattern intended for selection is registered.

### Phase 2: derive animated pattern detection from registered pattern metadata - implemented

Scope:

- Replace the hand-maintained `components/animatedPatterns.ts` array with derived data from `globalPatterns` or a new helper exported from the theme layer.
- Keep the existing lazy loader naming convention in `AnimatedBackground.tsx` for now, since the current animation modules already match it.
- Expose a helper such as `isAnimatedBackgroundPattern(patternId, themeId?)` that checks registered metadata.
- Update `App.tsx` to use the registry-backed helper instead of importing `isAnimatedPattern` from a component-local list.
- Keep or re-export compatibility names from `components/AnimatedBackground.tsx` only if existing tests or imports need a transition path.

Verification:

- Keep a test that every `animated: true` registered pattern has a matching lazy-loadable module.
- Keep a test that every animation module maps back to an `animated: true` registered pattern, excluding `components/animations/index.ts`.
- Update `tests/components/AnimatedBackground.test.tsx` so it proves registry-to-loader consistency rather than list-to-registry consistency.

### Phase 3: make category filtering and counts use the visible pattern set - implemented

Scope:

- Update `BackgroundsPanel.tsx` so category counts are based on the actual `allBackgrounds` passed to the panel, not only on the global category map.
- Preserve `favorites` as user-preference driven.
- Keep `all` as the visible static plus animated list for the active theme.
- Update `getBackgroundsByCategory` or replace it with a helper that takes available backgrounds as input. This matters if theme-specific patterns are added later.
- Move search to a shared helper only if it removes duplication. Current search is local and simple enough to keep local.

Verification:

- Tests should cover that category counts do not include registered-missing or theme-hidden backgrounds.
- Tests should cover favorite filtering and search after the category helper change.

### Phase 4: clean up background and theme option types - implemented for backgrounds

Scope:

- Prefer deriving `BackgroundOption` from a literal `globalPatterns` definition if that can be done without introducing circular imports.
- If deriving the union is too invasive, keep the hand-written type for now but add tests that compare the type-adjacent list with the registered pattern IDs.
- Consider doing the same for `ThemeOption` later from registered theme IDs, but do not combine that with the background metadata slice unless it is mechanically straightforward.
- Keep user preference parsing tolerant of unknown strings from persisted data. The UI can be strongly typed, but persisted preferences should still degrade to a fallback pattern.

Verification:

- Tests should fail when `types/ui.ts` contains stale background IDs.
- Tests should fail when a registered pattern is missing from the accepted UI preference type or fallback validator.

### Phase 5: document the extension path - implemented

Scope:

- Update `themes/README.md` after the code changes so adding a background has a single checklist.
- The checklist should cover:
  - add a `globalPatterns` entry,
  - add static CSS in `index.html` or an animation hook in `components/animations`,
  - choose categories,
  - choose an `iconKey`,
  - update seasonal defaults only if needed,
  - run the focused theme/background tests.

Verification:

- Documentation should match the actual helper names after implementation.

## Acceptance Criteria

- Adding a new selectable background no longer requires separately editing `themes/patterns.ts`, `components/animatedPatterns.ts`, `themes/backgroundCategories.ts`, `components/Settings/sections/ThemeSection/iconMaps.ts`, and `types/ui.ts` without tests catching drift.
- `App.tsx` and Settings agree on whether a pattern is animated.
- Category counts only reflect backgrounds the user can select for the current theme.
- Registered animated patterns and animation modules remain in one-to-one alignment.
- Stale background IDs are either registered intentionally or removed from categories/types.
- Existing route/sidebar and wallet tab registry tests continue to pass.

## Next Track: Wallet And Device API Contracts

This is the next original-plan item after the frontend slices. The first pass should be intentionally small: align existing OpenAPI docs to the wallet/device route behavior that already exists, then add focused tests so the same drift does not come back.

Implemented first-pass result:

- `DELETE /wallets/{walletId}` now documents the implemented `204` empty response.
- `/devices/{deviceId}` now documents the implemented `GET`, `PATCH`, and `DELETE` routes.
- `POST /devices` now documents implemented `201`, merge `200`, validation `400`, and conflict `409` statuses.
- Device create/update/merge/conflict schema entries now cover the request and response surfaces used by these routes.
- `server/tests/unit/api/openapi.test.ts` now asserts the wallet delete status, device item path coverage, device create merge/conflict statuses, device delete status, and schema exports.

Drift fixed in the first pass:

- `DELETE /wallets/{walletId}` was documented as `200` with a `SuccessResponse` body, but the implemented route returns `204` with no body.
- `/devices/{deviceId}` was implemented for `GET`, `PATCH`, and `DELETE`, but those item routes were missing from the OpenAPI path map.
- `POST /devices` could return `201`, `200` for merge results, or `409` for duplicate/conflicting device accounts, but the docs only advertised `201`.
- The device request schema was missing current request fields such as `type`, `modelSlug`, `accounts`, and `merge`.

Met first-pass acceptance criteria:

- Wallet delete docs advertise `204` and no stale `200` body response.
- Device item docs include `GET`, `PATCH`, and `DELETE` for `/devices/{deviceId}`.
- Device delete docs advertise `204`, with documented not-found and in-use conflict errors.
- Device create docs include the currently implemented merge/conflict response statuses.
- A focused OpenAPI unit test fails when these paths or status codes drift.

Deferred work:

- Generating route handlers or clients directly from OpenAPI/Zod contracts.
- Converting all API domains to schema-first validation in one pass.
- Reconciling every historical device response field shape beyond the wallet/device drift above.

## Implemented Slice: Route Logic Services

Status: first pass implemented.

Implemented result:

- Device account comparison and normalization now live in `server/src/services/deviceAccountConflicts.ts`.
- `server/src/api/devices/accountConflicts.ts` remains as a compatibility re-export for existing imports and tests.
- Device registration, duplicate detection, merge conflict handling, account merge orchestration, model lookup, and create orchestration now live in `server/src/services/deviceRegistration.ts`.
- `POST /devices` in `server/src/api/devices/crud.ts` now maps service outcomes to HTTP status and response bodies instead of owning the registration flow directly.

Pilot scope:

- Extract the device registration and merge flow from `server/src/api/devices/crud.ts` into a device registration service.
- Keep the route responsible for HTTP concerns only: request body handoff, user ID lookup, status selection, and response serialization.
- Move validation, fingerprint normalization, account normalization, duplicate detection, merge conflict handling, model lookup, and create/merge orchestration into the service layer.

Why this is the best first candidate:

- `server/src/api/wallets/crud.ts` already delegates most business logic to `server/src/services/wallet`.
- `server/src/api/devices/crud.ts` still contains a high-churn multi-mode flow directly inside the POST route.
- The same domain was just covered by the OpenAPI guardrail slice, so focused regression coverage already exists nearby.

Met acceptance criteria:

- `POST /devices` keeps the same documented `201`, merge `200`, validation `400`, and conflict `409` behavior.
- Existing `server/tests/unit/api/devices.test.ts` coverage keeps passing for registration, merge, and conflict cases.
- The route file becomes mostly orchestration and status mapping instead of owning account merge business rules.
- No wallet/device OpenAPI contract tests regress.

## Implemented Slice: Job Queue Surfaces

Status: first-pass inventory implemented.

Pilot scope:

- Inventory the current sync/job queue entry points, retry surfaces, status endpoints, and dead-letter queue routes.
- Identify which queue operations are intended as public API, admin API, or service-internal behavior.
- Add a short contract map before refactoring, because this area crosses API routes, support package collectors, sync services, and worker queue helpers.

Current surface map:

- Public user sync API: `server/src/api/sync.ts`.
  - Direct immediate sync: `POST /api/v1/sync/wallet/:walletId` calls `getSyncService().syncNow(walletId)`.
  - In-process wallet queue: `POST /api/v1/sync/queue/:walletId`, `POST /api/v1/sync/user`, and `POST /api/v1/sync/resync/:walletId` call `getSyncService().queueSync(...)`.
  - Worker queue batch: `POST /api/v1/sync/network/:network` and `POST /api/v1/sync/network/:network/resync` call `enqueueWalletSyncBatch(...)` in `server/src/services/workerSyncQueue.ts`.
  - Read-only status/logs: `GET /api/v1/sync/status/:walletId`, `GET /api/v1/sync/logs/:walletId`, and `GET /api/v1/sync/network/:network/status`.
  - State reset: `POST /api/v1/sync/reset/:walletId` clears `syncInProgress` directly.
- Overlapping public Bitcoin sync API: `server/src/api/bitcoin/sync.ts`.
  - `POST /api/v1/bitcoin/wallet/:walletId/sync` calls the direct blockchain sync path.
  - `POST /api/v1/bitcoin/wallet/:walletId/update-confirmations` directly updates confirmations.
- Worker queue producers:
  - `server/src/services/workerSyncQueue.ts` is the API-side BullMQ producer for the worker `sync` queue.
  - `server/src/infrastructure/notificationDispatcher.ts` is the API/service-side BullMQ producer for the worker `notifications` queue.
  - `server/src/worker.ts` queues `sync`, `confirmations`, and recurring `maintenance` jobs from worker events and schedules.
- Worker queue ownership:
  - `server/src/worker/workerJobQueue/index.ts` owns BullMQ queues named `sync`, `notifications`, `confirmations`, and `maintenance`.
  - `server/src/worker/jobs/index.ts` registers handlers from `syncJobs`, `notificationJobs`, `maintenanceJobs`, `autopilotJobs`, and `intelligenceJobs`.
  - `server/src/worker/jobs/syncJobs.ts` owns `sync-wallet`, `check-stale-wallets`, `update-confirmations`, and `update-all-confirmations`.
- In-process sync queue ownership:
  - `server/src/services/sync/syncService.ts` is the in-process orchestrator and exposes `queueSync`, `syncNow`, `queueUserWallets`, and `getSyncStatus`.
  - `server/src/services/sync/syncQueue.ts` owns the in-memory priority queue and queue size policy.
  - `server/src/services/sync/walletSync.ts` owns in-process sync retries and records final failures through `recordSyncFailure(...)`.
- Dead-letter queue surfaces:
  - `server/src/services/deadLetterQueue.ts` owns the in-memory DLQ with best-effort Redis persistence.
  - `server/src/worker/workerJobQueue/eventHandlers.ts` records exhausted worker jobs into the DLQ.
  - `server/src/api/admin/infrastructure.ts` exposes admin DLQ list, delete, retry, and category-clear routes.
  - Admin DLQ retry currently only implements `sync` by calling `getSyncService().queueSync(walletId, 'normal')`.
- Health and diagnostics:
  - `server/src/worker/healthServer.ts` exposes worker-local `/health`, `/ready`, `/live`, `/metrics`, and `/metrics/prometheus`.
  - `server/src/api/health/serviceChecks.ts` treats the job queue as worker-owned when the API process has no local queue.
  - `server/src/services/supportPackage/collectors/jobQueue.ts` and `server/src/services/supportPackage/collectors/deadLetterQueue.ts` capture job queue and DLQ diagnostics for support packages.

Boundary issues to decide before queue refactoring:

- `server/src/api/sync.ts` mixes in-process sync queue calls and worker BullMQ producer calls. Decide whether worker BullMQ should become the canonical manual-sync path.
- `server/src/api/bitcoin/sync.ts` overlaps with `server/src/api/sync.ts` for direct wallet sync and confirmation updates. Decide whether these are legacy aliases, low-level Bitcoin operations, or still-supported public endpoints.
- Admin DLQ retry requeues sync failures into the in-process queue even though worker jobs can also enter the DLQ. Decide whether DLQ retry should dispatch by original queue metadata when present.
- `server/src/jobs/jobQueue.ts` remains as a general queue singleton, but health and support-package paths usually see it as unavailable in the API process. Decide whether this should remain a compatibility surface or be retired in favor of `worker/workerJobQueue`.

Met acceptance criteria:

- The plan or a new Extension Points Map section names the canonical queue surface files.
- Duplicate or ambiguous queue trigger/status paths are listed with owners and intended callers.
- Any implementation change is deferred until the public/admin/internal boundaries are clear.

## Implemented: Extension Points Map

The durable extension map now lives in `docs/EXTENSION_POINTS.md`.

It covers:

- Frontend route/sidebar manifest.
- Wallet detail tab definitions.
- Background and theme metadata.
- Wallet/device OpenAPI contracts.
- Device registration service ownership.
- Sync/job queue surfaces, DLQ boundaries, health, and diagnostics.
- Existing local registry patterns that future extension points should follow.

Use the map as the current code navigation and guardrail document. It intentionally does not declare a plugin API.

## Suggested Test Set

For the completed background slice, run the narrow tests first:

```bash
npx vitest run tests/components/AnimatedBackground.test.tsx tests/components/AnimatedBackground.lazyLoading.test.tsx tests/themes/backgroundCategories.test.ts tests/themes/index.test.ts tests/themes/registry.test.ts tests/components/Settings/sections/ThemeSection/AppearanceTab.branches.test.tsx tests/components/Settings/sections/ThemeSection/panels/BackgroundsPanel.branches.test.tsx
```

Then re-run the already-touched extensibility slices:

```bash
npx vitest run tests/src/app/appRoutes.test.ts tests/components/WalletDetail/tabDefinitions.test.ts tests/components/WalletDetail/TabBar.test.tsx tests/components/WalletDetail.test.tsx tests/components/WalletDetail.wrapper.test.tsx
```

Finish with:

```bash
git diff --check
```

For the completed API contract slice, run:

```bash
cd server && npx vitest run tests/unit/api/openapi.test.ts
```

For the route-service extraction slice, run:

```bash
cd server && npx vitest run tests/unit/api/devices.test.ts tests/unit/api/openapi.test.ts
```

For the job queue surface inventory slice, no runtime test is needed because it is documentation-only. Run `git diff --check`.
