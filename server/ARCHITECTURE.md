# Server Architecture

This document describes the architectural patterns and infrastructure used in the Sanctuary server.

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      API Routes                              │
│                   src/api/*.ts                               │
│         (HTTP handling, validation, response formatting)     │
├─────────────────────────────────────────────────────────────┤
│                     Services                                 │
│                 src/services/*.ts                            │
│        (Business logic, orchestration, domain errors)        │
├─────────────────────────────────────────────────────────────┤
│                   Repositories                               │
│               src/repositories/*.ts                          │
│           (Data access, queries, transactions)               │
├─────────────────────────────────────────────────────────────┤
│                     Prisma                                   │
│                  (ORM / DB layer)                            │
└─────────────────────────────────────────────────────────────┘
```

**Key principles:**
- Routes handle HTTP concerns only (max ~50 lines of logic)
- Services contain business logic and throw domain errors
- Repositories abstract all database access
- Direct Prisma calls only in repositories

---

## Dependency Injection

The `ServiceRegistry` provides IoC container functionality.

**Location:** `src/services/registry.ts`

### Registration

```typescript
import { serviceRegistry, ServiceNames } from './services/registry';
import { syncService } from './services/syncService';

// Register at startup
serviceRegistry.register(ServiceNames.SYNC, syncService);
serviceRegistry.freeze(); // Prevent modifications after startup
```

### Retrieval

```typescript
import { serviceRegistry, ServiceNames } from '../services/registry';
import type { ISyncService } from '../services/interfaces';

const sync = serviceRegistry.get<ISyncService>(ServiceNames.SYNC);
await sync.triggerSync(walletId);
```

### Testing

```typescript
import { createTestRegistry } from '../services/registry';

const mockSync: ISyncService = {
  triggerSync: jest.fn(),
  // ...
};

const registry = createTestRegistry({ sync: mockSync });
// Use registry.get<ISyncService>('sync') in tests
```

### Features

| Feature | Description |
|---------|-------------|
| `register()` | Register service instance |
| `registerFactory()` | Lazy instantiation on first access |
| `mock()` / `unmock()` | Inject mocks for testing |
| `freeze()` | Lock registry after startup |
| `replace()` | Replace registration (testing only) |
| `reset()` | Clear all registrations |

---

## Repository Pattern

All data access goes through repositories. Never use Prisma directly in routes or services.

**Location:** `src/repositories/`

### Available Repositories

| Repository | Models |
|------------|--------|
| `walletRepository` | Wallet, WalletUser |
| `transactionRepository` | Transaction |
| `addressRepository` | Address |
| `utxoRepository` | Utxo |
| `userRepository` | User |
| `walletSharingRepository` | WalletSharing |
| `labelRepository` | Label, AddressLabel, TransactionLabel, OutputLabel, WalletLabel |
| `draftRepository` | TransactionDraft |
| `deviceRepository` | Device, DeviceUser |
| `pushDeviceRepository` | PushDevice |
| `sessionRepository` | RefreshToken |
| `auditLogRepository` | AuditLog |
| `systemSettingRepository` | SystemSetting |

### Usage

```typescript
import { walletRepository, transactionRepository } from '../repositories';

// Find wallet with access check
const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

// Delete transactions
const count = await transactionRepository.deleteByWalletId(walletId);
```

### Transactions

Repositories accept an optional Prisma transaction client:

```typescript
import { prisma } from '../lib/prisma';

await prisma.$transaction(async (tx) => {
  await walletRepository.delete(walletId, tx);
  await transactionRepository.deleteByWalletId(walletId, tx);
});
```

---

## Service Layer

Services contain business logic and domain operations.

**Location:** `src/services/`

### Key Services

| Service | Purpose |
|---------|---------|
| `syncService` | Wallet synchronization with blockchain |
| `labelService` | Label CRUD and associations |
| `draftService` | Transaction draft lifecycle |
| `accessControl` | Permission checking |
| `auditService` | Audit logging |
| `maintenanceService` | Periodic cleanup tasks |
| `walletLogBuffer` | Persistent logging ring buffer |
| `circuitBreaker` | Fault tolerance for external calls |
| `recoveryPolicy` | Retry strategies for operations |

### Error Handling

Services throw domain-specific errors defined in `src/errors/ApiError.ts`:

```typescript
import { WalletNotFoundError, ForbiddenError, InvalidInputError } from '../errors';

// In service — use domain-specific errors where available
if (!wallet) {
  throw new WalletNotFoundError(walletId);
}

if (!hasAccess) {
  throw new ForbiddenError('Cannot access this wallet');
}
```

The error handler middleware (`src/errors/errorHandler.ts`) automatically converts `ApiError` subclasses to HTTP responses using `error.toResponse()`.

### Error Types

| Error | HTTP Status | Usage |
|-------|-------------|-------|
| `NotFoundError` | 404 | Resource doesn't exist |
| `ForbiddenError` | 403 | No permission |
| `ConflictError` | 409 | Duplicate resource |
| `ValidationError` | 400 | Invalid input |

---

## Wallet Sync Pipeline

The wallet sync process uses a modular pipeline architecture where each phase is an independent, testable function. The pipeline orchestrator executes phases in sequence, passing a shared context object between them.

**Location:** `src/services/bitcoin/sync/`

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   executeSyncPipeline()                     │
│              (orchestrates phase execution)                 │
├─────────────────────────────────────────────────────────────┤
│    SyncContext (shared state between phases)                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ Phase 1 │→│ Phase 2 │→│ Phase 3 │→│   ...   │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/services/bitcoin/sync/
├── index.ts              # Public exports
├── pipeline.ts           # Pipeline executor
├── context.ts            # SyncContext factory
├── types.ts              # Type definitions
├── addressDiscovery.ts   # Gap limit (existing)
├── confirmations.ts      # Confirmation updates (existing)
└── phases/
    ├── index.ts          # Phase exports and default sequence
    ├── rbfCleanup.ts     # Mark RBF-replaced transactions
    ├── fetchHistories.ts # Batch fetch address histories
    ├── checkExisting.ts  # Filter already-processed txs
    ├── processTransactions.ts  # Main tx processing logic
    ├── fetchUtxos.ts     # Batch fetch UTXOs
    ├── reconcileUtxos.ts # Mark spent, update confirmations
    ├── insertUtxos.ts    # Insert new UTXOs
    ├── updateAddresses.ts # Mark addresses as used
    ├── gapLimit.ts       # Generate addresses for gap limit
    └── fixConsolidations.ts # Correct misclassified txs
```

### Sync Phases

| Phase | Name | File | Purpose |
|-------|------|------|---------|
| 0 | RBF Cleanup | `rbfCleanup.ts` | Mark pending txs as replaced if confirmed tx shares inputs |
| 1 | Fetch Histories | `fetchHistories.ts` | Batch fetch transaction history for all addresses |
| 2 | Check Existing | `checkExisting.ts` | Filter out already-processed transactions |
| 3 | Process Transactions | `processTransactions.ts` | Fetch details, classify, insert transactions |
| 4 | Fetch UTXOs | `fetchUtxos.ts` | Batch fetch unspent outputs |
| 5 | Reconcile UTXOs | `reconcileUtxos.ts` | Mark spent UTXOs, update confirmations |
| 6 | Insert UTXOs | `insertUtxos.ts` | Insert new UTXOs into database |
| 7 | Update Addresses | `updateAddresses.ts` | Mark addresses with history as "used" |
| 8 | Gap Limit | `gapLimit.ts` | Derive new addresses per BIP-44 gap limit |
| 9 | Fix Consolidations | `fixConsolidations.ts` | Correct misclassified consolidation txs |

### Usage

```typescript
import {
  executeSyncPipeline,
  defaultSyncPhases,
  quickSyncPhases,
  createPhase,
} from './sync';

// Standard sync with all phases
const result = await executeSyncPipeline(walletId, defaultSyncPhases);

// Quick sync (skips gap limit and consolidation correction)
const result = await executeSyncPipeline(walletId, quickSyncPhases);

// Custom phase selection
const result = await executeSyncPipeline(walletId, defaultSyncPhases, {
  skipPhases: ['fixConsolidations'],
  onPhaseComplete: (phaseName, ctx) => console.log(`Completed: ${phaseName}`),
});
```

### Creating Custom Phases

```typescript
import { createPhase, type SyncContext } from './sync';

// Phase function signature
async function myCustomPhase(ctx: SyncContext): Promise<SyncContext> {
  // Access shared context
  const { walletId, addresses, client } = ctx;

  // Do work...

  // Update stats
  ctx.stats.customMetric = 42;

  // Return modified context
  return ctx;
}

// Register as a phase
const customPhase = createPhase('myCustomPhase', myCustomPhase);

// Use in pipeline
const phases = [...defaultSyncPhases, customPhase];
```

### SyncContext

The `SyncContext` object carries state between phases:

```typescript
interface SyncContext {
  // Identifiers
  walletId: string;
  wallet: Wallet;
  network: BitcoinNetwork;

  // Services
  client: NodeClientInterface;

  // Input data
  addresses: Address[];
  walletAddressSet: Set<string>;

  // Phase outputs (accumulated)
  historyResults: Map<string, TxHistoryEntry[]>;
  allTxids: Set<string>;
  newTxids: string[];
  txDetailsCache: Map<string, RawTransaction>;
  utxoResults: Array<{ address: string; utxos: ElectrumUTXO[] }>;
  newTransactions: TransactionCreateData[];
  newAddresses: Array<{ address: string; derivationPath: string }>;

  // Tracking
  stats: SyncStats;
  completedPhases: string[];
}
```

### Transaction Classification

Transactions are classified during the `processTransactions` phase:

| Type | Condition | Amount |
|------|-----------|--------|
| `received` | External inputs, outputs to wallet | `+value` |
| `sent` | Wallet inputs, outputs to external | `-(value + fee)` |
| `consolidation` | Wallet inputs, ALL outputs to wallet | `-fee` |

### Consolidation Correction

**Problem**: During sync, a consolidation can be misclassified as "sent" if the output address wasn't in the wallet's address set yet. This happens because:
1. Addresses are derived incrementally via BIP-44 gap limit
2. Transaction classification happens before new addresses exist
3. An output to a not-yet-derived address appears "external"

**Solution**: The `fixConsolidations` phase runs after all addresses are synced and checks every "sent" transaction. If ALL outputs now belong to wallet addresses, the transaction is reclassified as a consolidation.

### Testing Phases

Each phase can be tested independently:

```typescript
import { createTestContext, fetchHistoriesPhase } from './sync';

describe('fetchHistoriesPhase', () => {
  it('should fetch histories for all addresses', async () => {
    const ctx = createTestContext({
      addresses: [mockAddress1, mockAddress2],
      client: mockClient,
    });

    const result = await fetchHistoriesPhase(ctx);

    expect(result.historyResults.size).toBe(2);
  });
});
```

---

## Infrastructure

**Location:** `src/infrastructure/`

### Redis

Provides distributed cache, event bus, and locking.

```typescript
import {
  initializeRedis,
  getDistributedCache,
  getDistributedEventBus,
  isRedisConnected,
} from '../infrastructure';

// Cache with automatic fallback to in-memory
const cache = getDistributedCache();
await cache.set('key', value, 300); // 5 min TTL
const value = await cache.get('key');

// Cross-instance events
const bus = getDistributedEventBus();
bus.subscribe('wallet:synced', handler);
bus.publish('wallet:synced', { walletId });
```

### Distributed Locking

Prevents race conditions in multi-instance deployments.

```typescript
import { acquireLock, releaseLock, withLock } from '../infrastructure';

// Manual lock management
const lock = await acquireLock('sync:wallet:123', { ttlMs: 60000 });
if (lock) {
  try {
    await doWork();
  } finally {
    await releaseLock(lock);
  }
}

// Automatic lock management
const result = await withLock('sync:wallet:123', 60000, async () => {
  return await doWork();
});

if (result.success) {
  console.log(result.result);
} else {
  console.log('Lock held by another process');
}
```

**Features:**
- Redis-based with automatic fallback to in-memory
- TTL-based expiration (prevents deadlocks)
- Token-based ownership (safe release)
- Lock extension for long operations

---

## Configuration

All configuration is centralized in `src/config/`.

**Location:** `src/config/index.ts`

### Structure

```typescript
import { getConfig, getSyncConfig, getElectrumClientConfig } from '../config';

const config = getConfig();
config.server.port          // Server settings
config.database.url         // Database connection
config.redis.url            // Redis connection
config.security.jwt.secret  // Auth settings
config.bitcoin.network      // Bitcoin network
config.bitcoin.electrum     // Electrum settings
```

### Specialized Configs

```typescript
// Sync timing configuration
const syncConfig = getSyncConfig();
syncConfig.syncIntervalMs        // 30000 (30s)
syncConfig.fullSyncIntervalMs    // 300000 (5min)
syncConfig.maxSyncDurationMs     // 180000 (3min)

// Electrum client configuration
const electrumConfig = getElectrumClientConfig();
electrumConfig.connectionTimeoutMs  // 30000
electrumConfig.requestTimeoutMs     // 10000
electrumConfig.maxRetries           // 3
```

### Environment Variables

See `.env.example` for all available configuration options.

---

## Async Utilities

**Location:** `src/utils/async.ts`

### Retry Logic

```typescript
import { withRetry } from '../utils/async';

const result = await withRetry(
  async () => fetchFromAPI(),
  {
    maxRetries: 3,
    delayMs: 1000,
    backoffMultiplier: 2,
    shouldRetry: (err) => err.code === 'ECONNRESET',
    onRetry: (err, attempt) => log.warn(`Retry ${attempt}`, err),
  }
);
```

### Concurrency Control

```typescript
import { mapWithConcurrency, batchProcess } from '../utils/async';

// Process with max 5 concurrent operations
const results = await mapWithConcurrency(items, async (item) => {
  return await processItem(item);
}, 5);

// Process in batches
const results = await batchProcess(items, 100, async (batch) => {
  return await processBatch(batch);
});
```

### Timeout

```typescript
import { withTimeout } from '../utils/async';

const result = await withTimeout(
  longRunningOperation(),
  30000,
  'Operation timed out after 30s'
);
```

---

## Recovery Policies

Pre-defined retry strategies for different operations.

**Location:** `src/services/recoveryPolicy.ts`

```typescript
import { executeWithRecovery, electrumConnectionPolicy } from '../services/recoveryPolicy';

const result = await executeWithRecovery(electrumConnectionPolicy, async () => {
  return await connectToElectrum();
});
```

### Available Policies

| Policy | Max Retries | Backoff | Use Case |
|--------|-------------|---------|----------|
| `electrumConnectionPolicy` | 3 | 1s, 2s, 4s | Electrum connections |
| `syncSubscriptionPolicy` | 5 | 500ms-4s | WebSocket subscriptions |
| `priceFetchPolicy` | 3 | 2s, 4s, 8s | Price API calls |
| `transactionBroadcastPolicy` | 2 | 1s, 3s | TX broadcast |
| `databaseQueryPolicy` | 2 | 100ms, 200ms | DB operations |
| `walletSyncPolicy` | 3 | 5s-20s | Full wallet sync |

---

## Circuit Breaker

Prevents cascade failures when external services are down.

**Location:** `src/services/circuitBreaker.ts`

```typescript
import { CircuitBreaker } from '../services/circuitBreaker';

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenRequests: 1,
});

const result = await breaker.execute(async () => {
  return await callExternalService();
});
```

**States:**
- **Closed**: Normal operation, failures counted
- **Open**: All calls fail fast (after threshold)
- **Half-Open**: Testing if service recovered

---

## Testing Patterns

### Mocking Services

```typescript
import { serviceRegistry } from '../services/registry';

beforeEach(() => {
  serviceRegistry.mock('sync', {
    triggerSync: jest.fn().mockResolvedValue({ success: true }),
  });
});

afterEach(() => {
  serviceRegistry.clearMocks();
});
```

### Isolated Registry

```typescript
import { createTestRegistry } from '../services/registry';

const registry = createTestRegistry({
  sync: mockSyncService,
  audit: mockAuditService,
});

// Inject registry into code under test
```

### Repository Mocking

```typescript
jest.mock('../repositories', () => ({
  walletRepository: {
    findById: jest.fn(),
    findByIdWithAccess: jest.fn(),
  },
}));
```

---

## File Organization

```
src/
├── api/                 # Route handlers (HTTP layer)
├── config/              # Centralized configuration
├── infrastructure/      # Redis, distributed locking
├── lib/                 # Prisma client, external libs
├── middleware/          # Express middleware
├── repositories/        # Data access layer
├── services/            # Business logic layer
│   ├── bitcoin/         # Bitcoin-specific services
│   │   ├── sync/        # Modular sync pipeline
│   │   │   ├── phases/  # Individual sync phases
│   │   │   ├── pipeline.ts
│   │   │   ├── context.ts
│   │   │   └── types.ts
│   │   └── *.ts         # Other bitcoin services
│   └── *.ts             # Domain services
├── utils/               # Shared utilities
│   ├── async.ts         # Concurrency, retry, timeout
│   └── logger.ts        # Logging
└── index.ts             # Application entry point
```
