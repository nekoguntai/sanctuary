# Plan: Sanctuary iOS Backend Enhancements

## Overview

Backend enhancements to support the Sanctuary iOS mobile application, including:
1. Gateway route whitelist additions
2. Mobile permissions system (per-wallet granular restrictions)
3. Enhanced push notification events
4. Mobile-specific rate limits
5. WebSocket relay for mobile (optional/future)

---

## 1. Gateway Route Whitelist Additions

**File:** `gateway/src/routes/proxy.ts`

Add the following routes to `ALLOWED_ROUTES`:

```typescript
// Transaction building & broadcasting
{ method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]{36}\/transactions\/create$/ },
{ method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]{36}\/transactions\/estimate$/ },
{ method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]{36}\/transactions\/broadcast$/ },
{ method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]{36}\/psbt\/create$/ },
{ method: 'POST', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]{36}\/psbt\/broadcast$/ },

// Hardware wallet device management
{ method: 'GET', pattern: /^\/api\/v1\/devices$/ },
{ method: 'POST', pattern: /^\/api\/v1\/devices$/ },
{ method: 'PATCH', pattern: /^\/api\/v1\/devices\/[a-f0-9-]{36}$/ },
{ method: 'DELETE', pattern: /^\/api\/v1\/devices\/[a-f0-9-]{36}$/ },

// Mobile permissions (new endpoints)
{ method: 'GET', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]{36}\/mobile-permissions$/ },
{ method: 'PATCH', pattern: /^\/api\/v1\/wallets\/[a-f0-9-]{36}\/mobile-permissions$/ },
{ method: 'GET', pattern: /^\/api\/v1\/mobile-permissions$/ },  // Get all user's mobile permissions
```

---

## 2. Mobile Permissions System

### Design Principles

1. **Additional restrictions model** - Mobile permissions LIMIT what users can do via mobile, even if their wallet role allows more
2. **Per-wallet granularity** - Each wallet can have different mobile permissions for the same user
3. **Self + owner override** - Users can restrict their own mobile access, owners can set maximum allowed
4. **Capability flags** - Granular boolean flags for each action

### Database Schema

**File:** `server/prisma/schema.prisma`

```prisma
model MobilePermission {
  id        String   @id @default(uuid())
  walletId  String
  userId    String

  // Capability flags (all default to true = wallet role's maximum)
  // View permissions
  canViewBalance       Boolean @default(true)
  canViewTransactions  Boolean @default(true)
  canViewUtxos         Boolean @default(true)

  // Transaction permissions
  canCreateTransaction Boolean @default(true)
  canBroadcast         Boolean @default(true)
  canSignPsbt          Boolean @default(true)

  // Address & label permissions
  canGenerateAddress   Boolean @default(true)
  canManageLabels      Boolean @default(true)

  // Administrative permissions
  canManageDevices     Boolean @default(true)
  canShareWallet       Boolean @default(true)
  canDeleteWallet      Boolean @default(true)

  // Owner-set maximum (if set, user cannot exceed these)
  ownerMaxPermissions  Json?   // Stores owner-defined caps

  // Metadata
  lastModifiedBy       String?  // userId who last modified
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  // Relations
  wallet    Wallet @relation(fields: [walletId], references: [id], onDelete: Cascade)
  user      User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([walletId, userId])
  @@index([userId])
  @@index([walletId])
}
```

### Permission Resolution Logic

```typescript
// Effective permission = MIN(walletRole, mobilePermission, ownerMax)
function getEffectiveMobilePermission(
  walletRole: 'viewer' | 'signer' | 'owner',
  mobilePermission: MobilePermission | null,
  action: MobileAction
): boolean {
  // 1. Get maximum allowed by wallet role
  const roleMax = ROLE_CAPABILITIES[walletRole][action];
  if (!roleMax) return false;  // Role doesn't allow this action

  // 2. If no mobile permission record, use role maximum
  if (!mobilePermission) return roleMax;

  // 3. Check owner-defined maximum
  const ownerMax = mobilePermission.ownerMaxPermissions?.[action] ?? true;
  if (!ownerMax) return false;

  // 4. Check user's self-set permission
  return mobilePermission[actionToField(action)] && ownerMax;
}
```

### Role Capability Mapping

```typescript
const ROLE_CAPABILITIES = {
  viewer: {
    viewBalance: true,
    viewTransactions: true,
    viewUtxos: true,
    createTransaction: false,
    broadcast: false,
    signPsbt: false,
    generateAddress: false,
    manageLabels: false,
    manageDevices: false,
    shareWallet: false,
    deleteWallet: false,
  },
  signer: {
    viewBalance: true,
    viewTransactions: true,
    viewUtxos: true,
    createTransaction: true,
    broadcast: true,
    signPsbt: true,
    generateAddress: true,
    manageLabels: true,
    manageDevices: false,
    shareWallet: false,
    deleteWallet: false,
  },
  owner: {
    // All true
  }
};
```

### Server Implementation

**New files to create:**

```
server/src/services/mobilePermissions/
├── types.ts                    # MobileAction enum, permission types
├── mobilePermissionService.ts  # CRUD + permission resolution
└── index.ts                    # Re-exports

server/src/repositories/
└── mobilePermissionRepository.ts  # Database operations

server/src/middleware/
└── mobilePermission.ts         # Middleware to check mobile permissions
```

**API Endpoints:**

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/api/v1/mobile-permissions` | Get all user's mobile permissions | Authenticated user |
| GET | `/api/v1/wallets/:id/mobile-permissions` | Get mobile permissions for wallet | Wallet access |
| PATCH | `/api/v1/wallets/:id/mobile-permissions` | Update own mobile permissions | Wallet access |
| PATCH | `/api/v1/wallets/:id/mobile-permissions/:userId` | Set user's max permissions | Wallet owner |

### Gateway Enforcement

**File:** `gateway/src/middleware/mobilePermission.ts` (new)

```typescript
// Middleware to enforce mobile permissions before proxying
export function requireMobilePermission(action: MobileAction) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const walletId = req.params.id || req.params.walletId;
    const userId = req.user?.userId;

    // Fetch effective permission from backend
    const response = await fetch(
      `${BACKEND_URL}/internal/mobile-permissions/check`,
      {
        method: 'POST',
        headers: { 'X-Gateway-Secret': config.gatewaySecret },
        body: JSON.stringify({ walletId, userId, action })
      }
    );

    if (!response.ok || !(await response.json()).allowed) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Mobile access denied for action: ${action}`
      });
    }

    next();
  };
}
```

**Route protection in proxy.ts:**

```typescript
// Apply mobile permission checks to sensitive routes
router.post('/wallets/:id/transactions/create',
  requireMobilePermission('createTransaction'), proxy);
router.post('/wallets/:id/transactions/broadcast',
  requireMobilePermission('broadcast'), proxy);
// etc.
```

---

## 3. Enhanced Push Notification Events

**File:** `gateway/src/services/backendEvents.ts`

Add new event types:

```typescript
interface BackendEvent {
  type:
    | 'transaction'           // Existing
    | 'confirmation'          // Existing
    | 'balance'               // Existing
    | 'sync'                  // Existing
    | 'broadcast_success'     // NEW: Transaction broadcast succeeded
    | 'broadcast_failed'      // NEW: Transaction broadcast failed
    | 'psbt_signing_required' // NEW: Multisig needs co-signer
    | 'draft_created'         // NEW: New draft for approval
    | 'draft_approved';       // NEW: Draft was approved by co-signer
  // ... rest of fields
}
```

**File:** `gateway/src/services/push/index.ts`

Add formatters for new notification types:

```typescript
export function formatBroadcastNotification(
  success: boolean,
  walletName: string,
  txid: string,
  error?: string
): PushNotification {
  return {
    title: success ? 'Transaction Broadcast' : 'Broadcast Failed',
    body: success
      ? `Transaction sent from ${walletName}`
      : `Failed to broadcast from ${walletName}: ${error}`,
    data: { type: success ? 'broadcast_success' : 'broadcast_failed', txid, walletName }
  };
}

export function formatPsbtSigningNotification(
  walletName: string,
  draftId: string,
  creatorName: string,
  amount: number
): PushNotification {
  return {
    title: 'Signature Required',
    body: `${creatorName} needs your signature on ${walletName} (${formatSats(amount)})`,
    data: { type: 'psbt_signing_required', draftId, walletName }
  };
}
```

**Server-side event emission:**

Add event emission in:
- `server/src/api/transactions.ts` - After broadcast success/failure
- `server/src/services/draftService.ts` - When draft is created/approved

---

## 4. Rate Limit Adjustments

**File:** `gateway/src/middleware/rateLimit.ts`

Add mobile-specific rate limiters:

```typescript
// Transaction creation - 10 per minute
export const transactionCreateRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.userId || req.ip || 'unknown',
  message: {
    error: 'Too Many Requests',
    message: 'Transaction creation rate limit exceeded (10/min)',
    retryAfter: 60
  }
});

// Transaction broadcast - 5 per minute
export const broadcastRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.userId || req.ip || 'unknown',
  message: {
    error: 'Too Many Requests',
    message: 'Broadcast rate limit exceeded (5/min)',
    retryAfter: 60
  }
});

// Device registration - 3 per hour
export const deviceRegistrationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.user?.userId || req.ip || 'unknown',
  message: {
    error: 'Too Many Requests',
    message: 'Device registration rate limit exceeded (3/hr)',
    retryAfter: 3600
  }
});
```

**Apply to routes:**

```typescript
router.post('/wallets/:id/transactions/create', transactionCreateRateLimiter, ...);
router.post('/wallets/:id/transactions/broadcast', broadcastRateLimiter, ...);
router.post('/devices', deviceRegistrationRateLimiter, ...);
```

---

## 5. WebSocket Relay (Future/Optional)

**File:** `gateway/src/services/websocketRelay.ts` (new)

Basic design for mobile WebSocket connections:

```typescript
// Authenticate mobile WebSocket connections via JWT
// Relay wallet-specific events to subscribed mobile clients
// Filter events based on mobile permissions

interface MobileWebSocketClient {
  userId: string;
  walletSubscriptions: Set<string>;
  socket: WebSocket;
}

// Event filtering based on mobile permissions
async function shouldRelayEvent(
  client: MobileWebSocketClient,
  event: BackendEvent
): Promise<boolean> {
  if (!client.walletSubscriptions.has(event.walletId)) return false;

  // Check mobile permission for the event type
  const permission = await getMobilePermission(event.walletId, client.userId);
  switch (event.type) {
    case 'transaction':
    case 'confirmation':
      return permission.canViewTransactions;
    case 'balance':
      return permission.canViewBalance;
    // etc.
  }
}
```

*Note: This is marked as optional/future. Implement if real-time updates are needed beyond push notifications.*

---

## Implementation Order

### Phase 1: Database & Core Service
1. Add `MobilePermission` model to Prisma schema
2. Run migration
3. Create `mobilePermissionRepository.ts`
4. Create `mobilePermissionService.ts` with permission resolution logic
5. Add API endpoints in server

### Phase 2: Gateway Integration
1. Add routes to whitelist in `proxy.ts`
2. Create `mobilePermission.ts` middleware
3. Apply mobile permission checks to protected routes
4. Add new rate limiters

### Phase 3: Push Notifications
1. Add new event types to `backendEvents.ts`
2. Add notification formatters
3. Add event emission in server transaction/draft services

### Phase 4: Testing
1. Unit tests for permission resolution
2. Integration tests for API endpoints
3. E2E tests for gateway permission enforcement

---

## Files to Modify

| File | Changes |
|------|---------|
| `server/prisma/schema.prisma` | Add MobilePermission model |
| `server/src/api/index.ts` | Register mobile permission routes |
| `gateway/src/routes/proxy.ts` | Add route whitelist entries |
| `gateway/src/middleware/rateLimit.ts` | Add mobile-specific rate limiters |
| `gateway/src/services/backendEvents.ts` | Add new event types |
| `gateway/src/services/push/index.ts` | Add notification formatters |

## Files to Create

| File | Purpose |
|------|---------|
| `server/src/services/mobilePermissions/types.ts` | Type definitions |
| `server/src/services/mobilePermissions/mobilePermissionService.ts` | Core service |
| `server/src/repositories/mobilePermissionRepository.ts` | Database operations |
| `server/src/api/mobilePermissions.ts` | API routes |
| `gateway/src/middleware/mobilePermission.ts` | Gateway enforcement |

---

## Verification

1. **Unit tests:** Permission resolution logic with all role/permission combinations
2. **Integration tests:** API endpoints for CRUD operations
3. **Gateway tests:** Middleware correctly blocks/allows requests
4. **Manual testing:**
   - Create wallet, set mobile permissions
   - Attempt blocked actions from gateway
   - Verify push notifications for new event types
   - Test rate limits hit expected thresholds
