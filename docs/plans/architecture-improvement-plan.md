# Architecture Improvement Plan

## Overview

This plan addresses 5 key architecture improvements identified during the extensibility analysis of the Sanctuary codebase. The improvements are ordered by dependency and risk, with foundational changes first.

---

## Current State Summary

### Findings from Exploration

1. **Direct Prisma Usage**: 44 files directly import `@prisma/client` with 381 total query operations
2. **Monolithic API Files**:
   - `admin.ts` (65K, 9 domains)
   - `transactions.ts` (60K, 8 domains)
   - `auth.ts` (43K, 6 domains)
3. **Unsafe WebSocket Types**: `data: any` in WebSocketEvent interface
4. **Scattered Configuration**: `process.env` accessed in 10+ files
5. **No Feature Flags**: All features always enabled, no runtime toggling

---

## Phase 1: Repository Pattern for Database Access

**Goal**: Abstract Prisma behind repository interfaces to enable testing, reduce coupling, and centralize query logic.

### Files to Create

| File | Purpose |
|------|---------|
| `server/src/repositories/index.ts` | Repository exports and factory |
| `server/src/repositories/types.ts` | Common repository interfaces |
| `server/src/repositories/walletRepository.ts` | Wallet CRUD operations |
| `server/src/repositories/transactionRepository.ts` | Transaction queries |
| `server/src/repositories/addressRepository.ts` | Address management |
| `server/src/repositories/userRepository.ts` | User operations |
| `server/src/repositories/utxoRepository.ts` | UTXO queries |

### Repository Interface Pattern

```typescript
// server/src/repositories/types.ts
export interface Repository<T, CreateInput, UpdateInput> {
  findById(id: string): Promise<T | null>;
  findMany(filter: Partial<T>): Promise<T[]>;
  create(data: CreateInput): Promise<T>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<void>;
}

export interface WalletRepository extends Repository<Wallet, CreateWalletInput, UpdateWalletInput> {
  findByUserId(userId: string): Promise<Wallet[]>;
  findByNetwork(userId: string, network: NetworkType): Promise<Wallet[]>;
  getWithAddresses(id: string): Promise<WalletWithAddresses | null>;
}
```

### Migration Strategy

1. Create repository interfaces and implementations
2. Add repositories to request context via middleware
3. Migrate one API file at a time, starting with smallest (`sync.ts`)
4. Keep Prisma client accessible during transition
5. Add integration tests for each repository

### Files to Modify

- `server/src/index.ts` - Add repository middleware
- `server/src/api/sync.ts` - First migration target (smallest)
- `server/src/api/wallets.ts` - Second target
- `server/src/api/transactions.ts` - Third target (largest)

---

## Phase 2: Split Large API Files

**Goal**: Break monolithic API files into focused domain routers for maintainability.

### Splitting Strategy

#### admin.ts (9 domains → 9 files)
| New File | Routes | Existing Lines |
|----------|--------|----------------|
| `admin/users.ts` | User management | ~200 |
| `admin/wallets.ts` | Wallet admin ops | ~150 |
| `admin/system.ts` | System status | ~100 |
| `admin/sync.ts` | Sync queue management | ~150 |
| `admin/security.ts` | Security settings | ~100 |
| `admin/logs.ts` | Audit logging | ~100 |
| `admin/backup.ts` | Backup operations | ~100 |
| `admin/config.ts` | Config management | ~100 |
| `admin/index.ts` | Router composition | ~50 |

#### transactions.ts (8 domains → 6 files)
| New File | Routes |
|----------|--------|
| `transactions/list.ts` | Transaction listing/filtering |
| `transactions/create.ts` | PSBT creation |
| `transactions/sign.ts` | Signing operations |
| `transactions/broadcast.ts` | Broadcasting |
| `transactions/labels.ts` | Labeling/notes |
| `transactions/index.ts` | Router composition |

#### auth.ts (6 domains → 4 files)
| New File | Routes |
|----------|--------|
| `auth/login.ts` | Login/logout |
| `auth/register.ts` | Registration |
| `auth/mfa.ts` | 2FA management |
| `auth/sessions.ts` | Session management |
| `auth/index.ts` | Router composition |

### Router Composition Pattern

```typescript
// server/src/api/admin/index.ts
import { Router } from 'express';
import usersRouter from './users';
import walletsRouter from './wallets';
import systemRouter from './system';

const router = Router();

router.use('/users', usersRouter);
router.use('/wallets', walletsRouter);
router.use('/system', systemRouter);

export default router;
```

### Migration Strategy

1. Create new directory structure
2. Extract one domain at a time
3. Update imports in main router
4. Run full test suite after each extraction
5. Delete original file only after all extractions complete

---

## Phase 3: Type WebSocket Events

**Goal**: Replace `data: any` with discriminated unions for type-safe event handling.

### Files to Create

| File | Purpose |
|------|---------|
| `server/src/websocket/events.ts` | Event type definitions |
| `server/src/websocket/handlers.ts` | Type-safe event handlers |
| `src/types/websocket.ts` | Frontend event types (shared) |

### Event Type Pattern

```typescript
// Shared event types
export type WebSocketEvent =
  | { type: 'wallet:synced'; data: { walletId: string; balance: number } }
  | { type: 'wallet:sync_started'; data: { walletId: string } }
  | { type: 'wallet:sync_failed'; data: { walletId: string; error: string } }
  | { type: 'transaction:confirmed'; data: { txid: string; confirmations: number } }
  | { type: 'transaction:received'; data: { txid: string; amount: number; walletId: string } }
  | { type: 'address:used'; data: { address: string; walletId: string } }
  | { type: 'price:updated'; data: { btcUsd: number } }
  | { type: 'system:notification'; data: { message: string; level: 'info' | 'warn' | 'error' } };

// Type guard
export function isWebSocketEvent(event: unknown): event is WebSocketEvent {
  return typeof event === 'object' && event !== null && 'type' in event && 'data' in event;
}
```

### Files to Modify

- `server/src/websocket/index.ts` - Use typed event emission
- `src/contexts/WebSocketContext.tsx` - Use typed event handling
- `src/types/index.ts` - Export WebSocket types

---

## Phase 4: Centralized Configuration

**Goal**: Replace scattered `process.env` access with typed configuration module.

### Files to Create

| File | Purpose |
|------|---------|
| `server/src/config/index.ts` | Config loading and validation |
| `server/src/config/types.ts` | Config type definitions |
| `server/src/config/defaults.ts` | Default values |

### Configuration Pattern

```typescript
// server/src/config/types.ts
export interface AppConfig {
  server: {
    port: number;
    host: string;
    httpsPort: number;
  };
  database: {
    url: string;
    poolSize: number;
  };
  bitcoin: {
    network: 'mainnet' | 'testnet' | 'signet' | 'regtest';
    electrumUrl: string;
  };
  security: {
    jwtSecret: string;
    encryptionKey: string;
    sessionTimeout: number;
  };
  features: FeatureFlags;
}

// server/src/config/index.ts
import { z } from 'zod';

const configSchema = z.object({
  server: z.object({
    port: z.number().default(3001),
    // ...
  }),
  // ...
});

let config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (config) return config;

  const rawConfig = {
    server: {
      port: parseInt(process.env.PORT || '3001'),
      // ...
    },
    // ...
  };

  config = configSchema.parse(rawConfig);
  return config;
}

export function getConfig(): AppConfig {
  if (!config) throw new Error('Config not loaded');
  return config;
}
```

### Files to Modify

- `server/src/index.ts` - Call `loadConfig()` at startup
- All files with `process.env` - Replace with `getConfig()`

---

## Phase 5: Feature Flags

**Goal**: Enable runtime feature toggling without redeployment.

### Files to Create

| File | Purpose |
|------|---------|
| `server/src/config/features.ts` | Feature flag definitions |
| `server/src/middleware/featureFlags.ts` | Request-level flag checking |
| `src/hooks/useFeatureFlag.ts` | Frontend flag hook |

### Feature Flag Pattern

```typescript
// server/src/config/features.ts
export interface FeatureFlags {
  hardwareWalletSigning: boolean;
  qrCodeSigning: boolean;
  multisigWallets: boolean;
  batchSync: boolean;
  priceAlerts: boolean;
  experimentalTaproot: boolean;
}

export const defaultFlags: FeatureFlags = {
  hardwareWalletSigning: true,
  qrCodeSigning: true,
  multisigWallets: true,
  batchSync: true,
  priceAlerts: false,
  experimentalTaproot: false,
};

// Load from environment or database
export function loadFeatureFlags(): FeatureFlags {
  return {
    ...defaultFlags,
    priceAlerts: process.env.FEATURE_PRICE_ALERTS === 'true',
    experimentalTaproot: process.env.FEATURE_TAPROOT === 'true',
  };
}
```

### Middleware Pattern

```typescript
// server/src/middleware/featureFlags.ts
export function requireFeature(flag: keyof FeatureFlags) {
  return (req: Request, res: Response, next: NextFunction) => {
    const flags = getConfig().features;
    if (!flags[flag]) {
      return res.status(403).json({ error: 'Feature not enabled' });
    }
    next();
  };
}

// Usage in routes
router.post('/sign/qr', requireFeature('qrCodeSigning'), signWithQRHandler);
```

---

## Implementation Order

```
Phase 1: Repository Pattern (Foundation)
    ↓
Phase 2: Split API Files (Depends on repos being in place)
    ↓
Phase 3: Type WebSocket Events (Independent, can parallel with 2)
    ↓
Phase 4: Centralized Config (Independent)
    ↓
Phase 5: Feature Flags (Depends on config)
```

### Recommended Sequence

1. **Phase 4 first** - Config centralization is low-risk, high-value
2. **Phase 1 second** - Repository pattern enables safer refactoring
3. **Phase 3 parallel** - WebSocket types can be done alongside Phase 1
4. **Phase 2 third** - API splitting uses repositories, biggest effort
5. **Phase 5 last** - Feature flags build on centralized config

---

## Testing Strategy

### Per-Phase Testing

| Phase | Test Type | Coverage Target |
|-------|-----------|-----------------|
| 1 | Integration tests for each repository | 90%+ |
| 2 | Existing API tests must pass unchanged | 100% |
| 3 | Type checking (no runtime tests needed) | Compile-time |
| 4 | Unit tests for config loading | 95% |
| 5 | Integration tests for flag behavior | 85% |

### Rollback Strategy

Each phase should be independently revertable:
- Repository pattern: Keep `prisma` directly accessible during migration
- API splitting: Maintain original files until extraction complete
- WebSocket types: Backward compatible with existing events
- Config: Environment variables still work as fallback
- Feature flags: All flags default to current behavior (enabled)

---

## Risk Assessment

| Phase | Risk Level | Mitigation |
|-------|------------|------------|
| 1 - Repository | Medium | Incremental migration, keep Prisma accessible |
| 2 - Split APIs | Low | Pure refactoring, no behavior change |
| 3 - WS Types | Low | Compile-time only, no runtime changes |
| 4 - Config | Low | Validation catches issues at startup |
| 5 - Flags | Low | Defaults preserve current behavior |

---

## Success Criteria

1. **Repository Pattern**: Zero direct Prisma imports outside repositories
2. **Split APIs**: No file > 500 lines, clear domain boundaries
3. **WebSocket Types**: No `any` in WebSocket code, discriminated unions
4. **Config**: Single config module, validated at startup
5. **Feature Flags**: At least 3 features flaggable, admin UI for toggles

---

## Files Summary

### New Files (21)
- `server/src/repositories/` (7 files)
- `server/src/api/admin/` (9 files)
- `server/src/api/transactions/` (6 files)
- `server/src/api/auth/` (5 files)
- `server/src/websocket/events.ts`
- `server/src/config/` (3 files)
- `src/types/websocket.ts`
- `src/hooks/useFeatureFlag.ts`

### Modified Files (15+)
- All API route files (gradual repository migration)
- `server/src/index.ts` (config loading, repository middleware)
- `server/src/websocket/index.ts` (typed events)
- `src/contexts/WebSocketContext.tsx` (typed handlers)
- Various files replacing `process.env` with `getConfig()`
