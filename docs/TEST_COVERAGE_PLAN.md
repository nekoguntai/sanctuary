# Sanctuary Test Coverage Plan

Last updated: 2026-01-11

## Executive Summary

**Current Status**: Phase 1 (Gateway) and Phase 2 (Server) coverage improvements complete.

| Package | Statements | Branches | Functions | Lines | Status |
|---------|------------|----------|-----------|-------|--------|
| **Server** | 45.74% / 45% | 41.01% / 40% | 46.80% / 45% | 45.67% / 45% | ✅ Passing |
| **Gateway** | 75%+ / 70% | 75%+ / 60% | 66%+ / 60% | 80%+ / 75% | ✅ Passing |
| **Frontend** | 54% / 50% | 48% / 45% | 52% / 50% | 54% / 50% | ✅ Passing |

**Total Tests**: ~4,000+ across all packages

---

## Test Inventory

### Server Tests (122+ files, ~3,300 tests)

#### Unit Tests - API Routes (14 files)
| File | Description |
|------|-------------|
| `admin.test.ts` | Admin user management endpoints |
| `ai.test.ts` | AI assistant endpoints |
| `ai-internal.test.ts` | Internal AI data endpoints |
| `auth.test.ts` | Authentication flows |
| `bitcoin.test.ts` | Bitcoin network info endpoints |
| `devices.test.ts` | Device management |
| `drafts.test.ts` | Transaction draft management |
| `electrumServers.test.ts` | Electrum server config |
| `health.test.ts` | Health check endpoints |
| `payjoin.test.ts` | BIP78 PayJoin support |
| `sync.test.ts` | Wallet synchronization |
| `transactions.test.ts` | Transaction operations |
| `transfers.test.ts` | Wallet ownership transfers |
| `wallets.test.ts` | Wallet CRUD operations |

#### Unit Tests - Services (51+ files)
| Category | Files |
|----------|-------|
| **Bitcoin** | addressDerivation, advancedTx, blockchain, descriptorBuilder, descriptorParser, electrum, electrumPool, nodeClient, plugin, psbtValidation, transactionService, utils, sync/phases, sync/pipeline |
| **Core** | accessControl, aiService, auditService, authorization, backupService, blockchainService, cacheInvalidation, circuitBreaker, deviceAccess, draftLockService, draftService, labelService, notifications, payjoinService, price, privacyService, recoveryPolicy, refreshTokenService, registry, startupManager, syncService, tokenRevocation, transferService, twoFactorService, utxoSelectionService, wallet, walletImport |
| **i18n** | i18nService (NEW - 94.44% coverage) |
| **Feature Flags** | featureFlagService (NEW - behavioral tests) |
| **Export/Import** | coldcardHandler, exportRegistry, importRegistry |
| **Hooks** | hookRegistry, hooksDefaults |
| **Lightning** | beaconClient |
| **Push** | pushService |
| **Cache** | warmCaches |
| **Script Types** | scriptTypeRegistry |

#### Unit Tests - Middleware (12 files)
| File | Coverage | Description |
|------|----------|-------------|
| `apiVersion.test.ts` | High | API versioning |
| `auth.test.ts` | High | JWT authentication |
| `deviceAccess.test.ts` | High | Device permission checks |
| `featureGate.test.ts` | High | Feature flag middleware |
| `gatewayAuth.test.ts` | High | Gateway authentication |
| `i18n.test.ts` (NEW) | 100% | Internationalization |
| `metrics.test.ts` (NEW) | 100% | Prometheus metrics |
| `pagination.test.ts` | High | Request pagination |
| `rateLimit.test.ts` | High | Rate limiting |
| `requestLogger.test.ts` (NEW) | 96.77% | Request logging |
| `requestTimeout.test.ts` (NEW) | 100% | Request timeouts |
| `walletAccess.test.ts` | High | Wallet permission checks |

#### Unit Tests - Utils (7 files)
| File | Coverage | Description |
|------|----------|-------------|
| `async.test.ts` | 97.43% | Async utilities |
| `encryption.test.ts` | 100% | Encryption helpers |
| `logger.test.ts` | 77.01% | Logging utilities |
| `redact.test.ts` | 100% | Data redaction |
| `requestContext.test.ts` | 100% | Request context |
| `apiResponse.test.ts` (NEW) | 100% | API response formatting |
| `errors.test.ts` (NEW) | 87.5% | Error handling |

#### Unit Tests - Infrastructure (5 files)
- distributedLock, jobQueue, memoryMonitor, readReplica, redisCircuitBreaker

#### Unit Tests - Repositories (7 files)
- addressRepository, cache, deviceRepository, sessionRepository, transactionRepository, userRepository, walletRepository

#### Unit Tests - WebSocket (5 files)
- broadcast, eventVersioning, redisBridge, schemas, server

#### Integration Tests (20 files)
| Category | Files |
|----------|-------|
| **Flows** | admin, auth, coinControl, payjoin, security, transactions, wallet |
| **Repositories** | address, auditLog, device, draft, label, pushDevice, session, systemSetting, transaction, user, utxo, wallet, walletSharing |

#### Contract Tests (1 file)
- `api.contract.test.ts` - API contract validation

---

### Gateway Tests (9 files, ~150 tests)

| File | Tests | Coverage | Description |
|------|-------|----------|-------------|
| `middleware/auth.test.ts` | 15 | High | JWT token validation |
| `middleware/rateLimit.test.ts` | 8 | High | Rate limiting |
| `middleware/validateRequest.test.ts` | 31 | High | Request validation |
| `middleware/requestLogger.test.ts` (NEW) | 17 | High | Request logging |
| `routes/proxy.test.ts` | 31 | High | Route whitelist patterns |
| `services/push.test.ts` | 18 | High | Push notification service |
| `services/backendEvents.test.ts` (NEW) | 25+ | High | WebSocket/SSE events |
| `services/push/fcm.test.ts` (NEW) | 15 | High | Firebase Cloud Messaging |
| `services/push/apns.test.ts` (NEW) | 15 | High | Apple Push Notifications |

---

### Frontend Tests (107+ files, ~2,800 tests)

#### Components (65+ files)
| Category | Components |
|----------|------------|
| **Core UI** | Account, Dashboard, Layout, Login, Settings |
| **Wallet** | WalletDetail, WalletList, WalletStats, CreateWallet, ImportWallet |
| **Transactions** | TransactionList, TransactionActions, TransactionExportModal, BatchSend |
| **Send Flow** | SendTransactionPage, SendTransactionWizard, OutputsStep, ReviewStep, FeeSelector, OutputRow, AdvancedOptions, TypeSelection, WizardNavigation |
| **Devices** | DeviceList, DeviceDetail, DeviceSharing, ConnectDevice, HardwareWalletConnect |
| **QR/Signing** | AnimatedQRCode, QRSigningModal |
| **Privacy** | PrivacyBadge, PrivacyDetailPanel, PrivacyWarnings, SpendPrivacyCard, CoinControlPanel |
| **AI** | AILabelSuggestion, AIQueryInput, AISettings |
| **Admin** | UsersGroups, AuditLogs, Monitoring, SystemSettings, Variables |
| **Network** | NetworkTabs, NetworkConnectionCard, NetworkSyncActions, NodeConfig, ElectrumServerSettings |
| **Labels** | LabelManager, LabelSelector |
| **Notifications** | NotificationBadge, NotificationPanel |
| **Transfers** | TransferOwnershipModal, PendingTransfersPanel |

#### Contexts (11 files)
- AppNotificationContext, CurrencyContext, NotificationContext, ServiceContext, SidebarContext, SlotContext, UserContext
- send/SendTransactionContext, send/reducer, sendTypes, stepValidation

#### Hooks (11 files)
- useAIStatus, useCopyToClipboard, useDelayedRender, useErrorHandler, useHardwareWallet, useNotificationSound, useSendTransactionActions, useWallets, useWebSocket
- queries/useBitcoin, queries/useDevices

#### Utils (10 files)
- bip21Parser, clipboard, errorHandler, explorer, feeCalculation, formatters, logger, urPsbt, utxoAge, validateAddress

---

## Phase 1 Complete: Gateway Coverage (2026-01-11)

**Improvement**: 15-20% → 75-80%

### New Test Files Created
1. `gateway/tests/unit/services/backendEvents.test.ts` - WebSocket and SSE event handling
2. `gateway/tests/unit/middleware/requestLogger.test.ts` - Request logging middleware
3. `gateway/tests/unit/services/push/fcm.test.ts` - Firebase Cloud Messaging
4. `gateway/tests/unit/services/push/apns.test.ts` - Apple Push Notifications

### Updated Thresholds
```typescript
// gateway/vitest.config.ts
thresholds: {
  branches: 70,
  functions: 60,
  lines: 75,
  statements: 75,
}
```

---

## Phase 2 Complete: Server Coverage (2026-01-11)

**Improvement**: 40% → 45%+

### New Test Files Created
1. `server/tests/unit/middleware/requestTimeout.test.ts` - 22 tests, 100% coverage
2. `server/tests/unit/middleware/requestLogger.test.ts` - 17 tests, 96.77% coverage
3. `server/tests/unit/middleware/metrics.test.ts` - 18 tests, 100% coverage
4. `server/tests/unit/middleware/i18n.test.ts` - 13 tests, 100% coverage
5. `server/tests/unit/services/i18nService.test.ts` - 23 tests, 94.44% coverage
6. `server/tests/unit/services/featureFlagService.test.ts` - 24 tests
7. `server/tests/unit/utils/apiResponse.test.ts` - 36 tests, 100% coverage
8. `server/tests/unit/utils/errors.test.ts` - 46 tests, 87.5% coverage

### Updated Thresholds
```typescript
// server/vitest.config.ts
thresholds: {
  branches: 40,
  functions: 45,
  lines: 45,
  statements: 45,
}
```

---

## Priority Areas for Future Improvement

### Priority 1: Critical Gaps

| Area | Current Coverage | Risk | Effort |
|------|------------------|------|--------|
| Bitcoin Sync Pipeline | 28% | Data corruption | Large |
| WebSocket Server | 24% | Connection leaks | Medium |
| Admin API | 14% | Security | Medium |

### Priority 2: High Impact

| Area | Current Coverage | Impact |
|------|------------------|--------|
| RBF Transactions | ~37% | Stuck funds |
| Multisig Flow | Medium | Signing failures |
| Electrum Pool | 77 tests | Connection resilience |

### Priority 3: Medium

- Hardware Wallet Integration (Frontend)
- Labels API
- Push Notification Providers
- Event Bus Redis Integration

---

## Testing Patterns Reference

### Vitest Mock Hoisting Pattern
```typescript
// Always use vi.hoisted() for mocks that need to be available during module loading
const { mockFunction, mockService } = vi.hoisted(() => {
  const mockFunction = vi.fn();
  const mockService = {
    method: vi.fn(),
  };
  return { mockFunction, mockService };
});

vi.mock('../path/to/module', () => ({
  someFunction: mockFunction,
  someService: mockService,
}));
```

### Express Middleware Testing
```typescript
let req: any;
let res: any;
let next: ReturnType<typeof vi.fn>;

beforeEach(() => {
  req = { method: 'GET', path: '/api/test', headers: {} };
  res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  };
  next = vi.fn();
});
```

### Fake Timers for Timeout Testing
```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('should timeout after duration', () => {
  middleware(req, res, next);
  vi.advanceTimersByTime(31000);
  expect(res.status).toHaveBeenCalledWith(408);
});
```

---

## Running Tests

```bash
# Server tests
cd server && npm run test
cd server && npm run test:coverage

# Gateway tests
cd gateway && npm run test
cd gateway && npm run test:coverage

# Frontend tests
npm run test
npm run test:coverage

# Run specific test file
npm run test -- path/to/test.ts

# Run with pattern matching
npm run test -- --grep "middleware"
```

---

## CI/CD Integration

Tests run automatically on:
- Pull request creation
- Push to main branch
- Scheduled nightly builds

Coverage reports are generated and uploaded to the CI artifacts.
